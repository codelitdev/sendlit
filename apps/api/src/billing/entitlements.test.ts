import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db/client", async () => {
    const { makeTestDb } = await import("../test/db.js");
    return { db: await makeTestDb() };
});

import { eq } from "drizzle-orm";
import { db } from "../db/client";
import {
    billingProviderCustomers,
    billingPriceEntries,
    billingPlanStates,
    billingSubscriptions,
    outboundMessages,
    planSendReservations,
    planSendUsageBuckets,
} from "../db/schema";
import { seedTeamAndContact, truncateAll, type TestDb } from "../test/db";
import { expireCancelledSubscriptionEntitlements } from "./webhooks/processor";
import {
    commitSendReservation,
    reserveSend,
    settleExpiredSendReservation,
} from "./entitlements";

const tdb = db as unknown as TestDb;

beforeEach(async () => {
    process.env.SENDLIT_DEPLOYMENT_MODE = "cloud";
    await truncateAll(tdb);
});

async function fixture() {
    const { organization, team } = await seedTeamAndContact(tdb);
    const [outbound] = await tdb
        .insert(outboundMessages)
        .values({
            teamId: team.id,
            deliverySourceType: "team",
            sourceType: "campaign",
            recipientEmail: "reader@example.com",
            normalizedRecipient: "reader@example.com",
            deliveryStatus: "prepared",
        })
        .returning();
    return { organization, outbound };
}

describe("send usage reservations", () => {
    it("is idempotent for live and committed reservation retries", async () => {
        const { organization, outbound } = await fixture();
        const reserve = () =>
            tdb.transaction((tx) =>
                reserveSend(tx as any, {
                    organizationId: organization.id,
                    outboundMessageId: outbound.id,
                    purpose: "marketing",
                }),
            );

        await reserve();
        await reserve();
        let [bucket] = await tdb.select().from(planSendUsageBuckets);
        expect(bucket.reserved).toBe(1);

        await commitSendReservation(outbound.id);
        await reserve();
        [bucket] = await tdb.select().from(planSendUsageBuckets);
        expect(bucket).toMatchObject({ reserved: 0, committed: 1 });
    });

    it("releases an expired reservation before reopening it", async () => {
        const { organization, outbound } = await fixture();
        const reserve = () =>
            tdb.transaction((tx) =>
                reserveSend(tx as any, {
                    organizationId: organization.id,
                    outboundMessageId: outbound.id,
                    purpose: "marketing",
                }),
            );

        await reserve();
        await tdb
            .update(planSendReservations)
            .set({ expiresAt: new Date(Date.now() - 1_000) })
            .where(eq(planSendReservations.outboundMessageId, outbound.id));
        await reserve();

        const [bucket] = await tdb.select().from(planSendUsageBuckets);
        const [reservation] = await tdb.select().from(planSendReservations);
        expect(bucket.reserved).toBe(1);
        expect(reservation.state).toBe("reserved");
        expect(reservation.expiresAt.getTime()).toBeGreaterThan(Date.now());
    });

    it("commits expired quota when the provider acceptance was already recorded", async () => {
        const { organization, outbound } = await fixture();
        await tdb.transaction((tx) =>
            reserveSend(tx as any, {
                organizationId: organization.id,
                outboundMessageId: outbound.id,
                purpose: "marketing",
            }),
        );
        await tdb
            .update(outboundMessages)
            .set({ deliveryStatus: "accepted", acceptedAt: new Date() })
            .where(eq(outboundMessages.id, outbound.id));
        await tdb
            .update(planSendReservations)
            .set({ expiresAt: new Date(Date.now() - 1_000) })
            .where(eq(planSendReservations.outboundMessageId, outbound.id));

        await settleExpiredSendReservation(outbound.id);

        const [bucket] = await tdb.select().from(planSendUsageBuckets);
        const [reservation] = await tdb.select().from(planSendReservations);
        expect(bucket).toMatchObject({ reserved: 0, committed: 1 });
        expect(reservation.state).toBe("committed");
    });

    it("releases an expired reservation when the outbound was not accepted", async () => {
        const { organization, outbound } = await fixture();
        await tdb.transaction((tx) =>
            reserveSend(tx as any, {
                organizationId: organization.id,
                outboundMessageId: outbound.id,
                purpose: "marketing",
            }),
        );
        await tdb
            .update(planSendReservations)
            .set({ expiresAt: new Date(Date.now() - 1_000) })
            .where(eq(planSendReservations.outboundMessageId, outbound.id));

        await settleExpiredSendReservation(outbound.id);

        const [bucket] = await tdb.select().from(planSendUsageBuckets);
        const [reservation] = await tdb.select().from(planSendReservations);
        expect(bucket).toMatchObject({ reserved: 0, committed: 0 });
        expect(reservation.state).toBe("released");
    });
});

describe("scheduled cancellation expiry", () => {
    async function seedSubscription(status: {
        cancelAtPeriodEnd: boolean;
        paidThroughAt: Date;
        isEntitlementSource?: boolean;
    }) {
        const { account, organization } = await seedTeamAndContact(tdb);
        const [price] = await tdb
            .insert(billingPriceEntries)
            .values({
                offerKey: "pro_month",
                plan: "pro",
                billingInterval: "month",
                currency: "USD",
                amountMinor: 4900,
                provider: "dodo",
                providerProductId: `pdt_${crypto.randomUUID()}`,
            })
            .returning();
        const [customer] = await tdb
            .insert(billingProviderCustomers)
            .values({
                provider: "dodo",
                payerId: account.id,
                providerCustomerId: `cus_${crypto.randomUUID()}`,
                idempotencyKey: `customer:dodo:${account.id}`,
                status: "active",
            })
            .returning();
        const [subscription] = await tdb
            .insert(billingSubscriptions)
            .values({
                billableEntityId: organization.id,
                billingCustomerId: customer.id,
                payerId: account.id,
                provider: "dodo",
                providerSubscriptionId: `sub_${crypto.randomUUID()}`,
                providerProductId: price.providerProductId,
                billingPriceEntryId: price.id,
                catalogRevision: 1,
                offerKey: "pro_month",
                plan: "pro",
                billingInterval: "month",
                status: "cancelled",
                paidThroughAt: status.paidThroughAt,
                cancelAtPeriodEnd: status.cancelAtPeriodEnd,
                isEntitlementSource: status.isEntitlementSource ?? true,
            })
            .returning();
        await tdb
            .update(billingPlanStates)
            .set({
                plan: "pro",
                activeSubscriptionId: subscription.id,
            })
            .where(eq(billingPlanStates.billableEntityId, organization.id));
        return { organization, subscription };
    }

    it("keeps scheduled cancellation paid until the verified paid-through time", async () => {
        const { organization } = await seedSubscription({
            cancelAtPeriodEnd: true,
            paidThroughAt: new Date(Date.now() + 60_000),
        });
        expect(await expireCancelledSubscriptionEntitlements()).toBe(0);
        const [state] = await tdb
            .select()
            .from(billingPlanStates)
            .where(eq(billingPlanStates.billableEntityId, organization.id));
        expect(state).toMatchObject({
            plan: "pro",
            activeSubscriptionId: expect.any(String),
        });
    });

    it("projects elapsed scheduled cancellation to Free", async () => {
        const { organization, subscription } = await seedSubscription({
            cancelAtPeriodEnd: true,
            paidThroughAt: new Date(Date.now() - 60_000),
        });
        expect(await expireCancelledSubscriptionEntitlements()).toBe(1);
        const [state] = await tdb
            .select()
            .from(billingPlanStates)
            .where(eq(billingPlanStates.billableEntityId, organization.id));
        const [row] = await tdb
            .select()
            .from(billingSubscriptions)
            .where(eq(billingSubscriptions.id, subscription.id));
        expect(state).toMatchObject({
            plan: "free",
            activeSubscriptionId: null,
        });
        expect(row.isEntitlementSource).toBe(false);
    });
});
