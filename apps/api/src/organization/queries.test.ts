import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db/client", async () => {
    const { makeTestDb } = await import("../test/db.js");
    return { db: await makeTestDb() };
});

import { db } from "../db/client";
import { eq } from "drizzle-orm";
import {
    billingCheckoutAttempts,
    billingPriceEntries,
    billingProviderCustomers,
    espConfigTeamGrants,
    espConfigs,
    organizationEspQuotaReservations,
    organizationEspUsageBuckets,
    billingPlanStates,
    billingSubscriptions,
    organizations,
    outboundMessages,
    sequences,
    teams,
    user,
} from "../db/schema";
import {
    addOrganizationMemberByEmail,
    closeOrganization,
    getOrganizationMembership,
    listOrganizationsForUser,
    createOrganization,
} from "./queries";
import { createTeam } from "../team/queries";
import {
    getTeamDeliverySettingView,
    resolveDeliverySource,
    transitionEspGrant,
    upsertEspGrant,
} from "../delivery/queries";
import { createOrganizationEspConfig } from "../settings/esp/queries";
import { reserveOrganizationQuotaForOutbound } from "../delivery/quota";
import { getOrganizationQuotaUsage } from "../delivery/quota";
import { listOrganizationAuditEvents } from "./audit";
import { truncateAll, type TestDb } from "../test/db";

const tdb = db as unknown as TestDb;

beforeEach(async () => {
    await truncateAll(tdb);
});

describe("organizations", () => {
    it("names an automatically-created initial team from its organization", async () => {
        const [owner] = await tdb
            .insert(user)
            .values({
                id: crypto.randomUUID(),
                name: "Owner",
                email: `owner-${crypto.randomUUID()}@example.com`,
                emailVerified: true,
                createdAt: new Date(),
                updatedAt: new Date(),
            })
            .returning();

        const organization = await createOrganization(owner.id, "Acme", {
            createInitialTeam: true,
        });
        const [team] = await tdb
            .select({ name: teams.name })
            .from(teams)
            .where(eq(teams.organizationId, organization.id))
            .limit(1);

        expect(team?.name).toBe("Acme Team");
    });

    it("rejects case-only duplicate organization names for the same owner", async () => {
        const [owner, otherOwner] = await tdb
            .insert(user)
            .values([
                {
                    id: crypto.randomUUID(),
                    name: "Owner",
                    email: `owner-${crypto.randomUUID()}@example.com`,
                    emailVerified: true,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                },
                {
                    id: crypto.randomUUID(),
                    name: "Other Owner",
                    email: `other-owner-${crypto.randomUUID()}@example.com`,
                    emailVerified: true,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                },
            ])
            .returning();

        await createOrganization(owner.id, "Acme");
        await expect(createOrganization(owner.id, " acME ")).rejects.toThrow(
            "organization_name_already_exists",
        );
        await expect(
            createOrganization(otherOwner.id, "ACME"),
        ).resolves.toBeTruthy();
    });

    it("owns teams through a Better Auth user membership", async () => {
        const [member] = await tdb
            .insert(user)
            .values({
                id: crypto.randomUUID(),
                name: "Owner",
                email: `owner-${crypto.randomUUID()}@example.com`,
                emailVerified: true,
                createdAt: new Date(),
                updatedAt: new Date(),
            })
            .returning();
        const organization = await createOrganization(member.id, "Acme");
        const team = await createTeam({
            organizationId: organization.id,
            creatorUserId: member.id,
            name: "School A",
        });

        expect(
            await getOrganizationMembership(organization.id, member.id),
        ).toMatchObject({ role: "owner" });
        expect(await listOrganizationsForUser(member.id)).toEqual([
            expect.objectContaining({ id: organization.id }),
        ]);
        expect(team.organizationId).toBe(organization.id);
    });

    it("adds an existing Better Auth user by normalized email", async () => {
        const [owner, member] = await tdb
            .insert(user)
            .values([
                {
                    id: crypto.randomUUID(),
                    name: "Owner",
                    email: `owner-${crypto.randomUUID()}@example.com`,
                    emailVerified: true,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                },
                {
                    id: crypto.randomUUID(),
                    name: "Member",
                    email: `member-${crypto.randomUUID()}@example.com`,
                    emailVerified: true,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                },
            ])
            .returning();
        const organization = await createOrganization(owner.id, "Acme");

        await expect(
            addOrganizationMemberByEmail(
                organization.id,
                member.email.toUpperCase(),
                "member",
            ),
        ).resolves.toMatchObject({ userId: member.id, email: member.email });
        await expect(
            addOrganizationMemberByEmail(
                organization.id,
                "missing@example.com",
                "member",
            ),
        ).resolves.toBeNull();
    });

    it("allows a team to pin an organization-owned ESP without exposing it as a team ESP", async () => {
        const [member] = await tdb
            .insert(user)
            .values({
                id: crypto.randomUUID(),
                name: "Owner",
                email: `owner-${crypto.randomUUID()}@example.com`,
                emailVerified: true,
                createdAt: new Date(),
                updatedAt: new Date(),
            })
            .returning();
        const organization = await createOrganization(member.id, "Acme");
        const team = await createTeam({
            organizationId: organization.id,
            creatorUserId: member.id,
            name: "School A",
        });
        const esp = await createOrganizationEspConfig(organization.id, {
            name: "Shared SMTP",
            provider: "smtp",
            host: "smtp.example.com",
            port: 587,
            secure: false,
            fromEmail: "no-reply@example.com",
        });
        await tdb
            .update(espConfigs)
            .set({ status: "active", activatedAt: new Date() })
            .where(eq(espConfigs.id, esp.id));
        await upsertEspGrant(
            organization.id,
            team.id,
            { espId: esp.espId, dailyLimit: 10, monthlyLimit: 100 },
            { type: "user", id: member.id },
        );

        await expect(
            resolveDeliverySource(team.id, { type: "organization" }),
        ).resolves.toMatchObject({
            type: "organization",
            espConfigId: esp.id,
            fromEmail: "no-reply@example.com",
        });

        const [grantBeforeCancel] = await tdb
            .select()
            .from(espConfigTeamGrants)
            .where(eq(espConfigTeamGrants.teamId, team.id));
        const [outbound] = await tdb
            .insert(outboundMessages)
            .values({
                teamId: team.id,
                deliverySourceType: "organization",
                espConfigId: esp.id,
                espGrantId: grantBeforeCancel.id,
                sourceType: "campaign",
                submissionKey: `test-${crypto.randomUUID()}`,
                recipientEmail: "student@example.com",
                normalizedRecipient: "student@example.com",
                provider: "smtp",
                rfcMessageId: `<${crypto.randomUUID()}@example.com>`,
            })
            .returning();
        await reserveOrganizationQuotaForOutbound({
            outboundMessageId: outbound.id,
            grantId: grantBeforeCancel.id,
        });
        const [pausedSequence] = await tdb
            .insert(sequences)
            .values({
                teamId: team.id,
                type: "sequence",
                title: "Paused sequence",
                status: "paused",
                deliverySourceType: "organization",
                outboxId: esp.id,
                espGrantId: grantBeforeCancel.id,
            })
            .returning();
        await expect(
            getOrganizationQuotaUsage(organization.id),
        ).resolves.toMatchObject({
            day: { accepted: 0, reserved: 1 },
            month: { accepted: 0, reserved: 1 },
        });

        await transitionEspGrant(
            organization.id,
            team.id,
            "cancel",
            undefined,
            { type: "user", id: member.id },
        );
        const [grant] = await tdb
            .select()
            .from(espConfigTeamGrants)
            .where(eq(espConfigTeamGrants.teamId, team.id));
        expect(grant.status).toBe("revoked");
        const [detachedSequence] = await tdb
            .select()
            .from(sequences)
            .where(eq(sequences.id, pausedSequence.id));
        expect(detachedSequence).toMatchObject({
            deliverySourceIntent: null,
            deliverySourceType: null,
            outboxId: null,
            espGrantId: null,
            report: { deliverySourceDeleted: true },
        });
        const [reservation] = await tdb
            .select()
            .from(organizationEspQuotaReservations)
            .where(
                eq(
                    organizationEspQuotaReservations.outboundMessageId,
                    outbound.id,
                ),
            );
        expect(reservation.state).toBe("released");
        const buckets = await tdb
            .select()
            .from(organizationEspUsageBuckets)
            .where(eq(organizationEspUsageBuckets.grantId, grant.id));
        expect(buckets.every((bucket) => bucket.reservedCount === 0)).toBe(
            true,
        );
        await expect(
            resolveDeliverySource(team.id, { type: "organization" }),
        ).rejects.toThrow("organization_delivery_disabled");
        await expect(
            listOrganizationAuditEvents(organization.id),
        ).resolves.toContainEqual(
            expect.objectContaining({
                action: "delivery_grant.cancel",
                teamId: team.teamId,
                espId: esp.espId,
                grantId: grant.grantId,
                actorType: "user",
            }),
        );
    });

    it("lets an organization grant select the shared ESP as the team default", async () => {
        const [member] = await tdb
            .insert(user)
            .values({
                id: crypto.randomUUID(),
                name: "Owner",
                email: `owner-${crypto.randomUUID()}@example.com`,
                emailVerified: true,
                createdAt: new Date(),
                updatedAt: new Date(),
            })
            .returning();
        const organization = await createOrganization(member.id, "Acme");
        const team = await createTeam({
            organizationId: organization.id,
            creatorUserId: member.id,
            name: "School A",
        });
        const esp = await createOrganizationEspConfig(organization.id, {
            name: "Shared SMTP",
            provider: "smtp",
            host: "smtp.example.com",
            port: 587,
            secure: false,
            fromEmail: "no-reply@example.com",
        });
        await tdb
            .update(espConfigs)
            .set({ status: "active", activatedAt: new Date() })
            .where(eq(espConfigs.id, esp.id));

        await upsertEspGrant(
            organization.id,
            team.id,
            { espId: esp.espId, makeDefault: true },
            { type: "user", id: member.id },
        );

        await expect(
            getTeamDeliverySettingView(team.id),
        ).resolves.toMatchObject({
            setting: { defaultSource: "organization" },
            defaultTeamEspId: null,
        });
        await expect(resolveDeliverySource(team.id)).resolves.toMatchObject({
            type: "organization",
            espConfigId: esp.id,
        });
    });

    it("blocks organization close while a live checkout attempt exists", async () => {
        const [owner] = await tdb
            .insert(user)
            .values({
                id: crypto.randomUUID(),
                name: "Owner",
                email: `owner-${crypto.randomUUID()}@example.com`,
                emailVerified: true,
                createdAt: new Date(),
                updatedAt: new Date(),
            })
            .returning();
        const organization = await createOrganization(owner.id, "Acme");
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
        await tdb.insert(billingCheckoutAttempts).values({
            attemptId: `bca_${crypto.randomUUID().replace(/-/g, "").slice(0, 24)}`,
            billableEntityId: organization.id,
            payerId: owner.id,
            provider: "dodo",
            catalogRevision: 1,
            offerKey: "pro_month",
            requestedPlan: "pro",
            requestedInterval: "month",
            billingPriceEntryId: price.id,
            quotedAmountMinor: 4900,
            quotedCurrency: "USD",
            idempotencyKey: `checkout:${organization.id}`,
            status: "open",
            expiresAt: new Date(Date.now() + 60_000),
        });

        await expect(closeOrganization(organization.id)).rejects.toThrow(
            "billing_checkout_pending",
        );
        const [row] = await tdb
            .select({ status: organizations.status })
            .from(organizations)
            .where(eq(organizations.id, organization.id));
        expect(row?.status).toBe("active");
    });
});

describe("one owned Free organization", () => {
    const originalMode = process.env.SENDLIT_DEPLOYMENT_MODE;
    afterEach(() => {
        if (originalMode === undefined)
            delete process.env.SENDLIT_DEPLOYMENT_MODE;
        else process.env.SENDLIT_DEPLOYMENT_MODE = originalMode;
    });

    async function seedOwner() {
        const [owner] = await tdb
            .insert(user)
            .values({
                id: crypto.randomUUID(),
                name: "Owner",
                email: `owner-${crypto.randomUUID()}@example.com`,
                emailVerified: true,
                createdAt: new Date(),
                updatedAt: new Date(),
            })
            .returning();
        return owner;
    }

    async function attachSubscription(
        organizationId: string,
        ownerId: string,
        input: {
            status: "active" | "cancelled";
            cancelAtPeriodEnd: boolean;
            paidThroughAt: Date;
        },
    ) {
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
                payerId: ownerId,
                providerCustomerId: `cus_${crypto.randomUUID()}`,
                idempotencyKey: `customer:dodo:${ownerId}`,
                status: "active",
            })
            .returning();
        const [subscription] = await tdb
            .insert(billingSubscriptions)
            .values({
                billableEntityId: organizationId,
                billingCustomerId: customer.id,
                payerId: ownerId,
                provider: "dodo",
                providerSubscriptionId: `sub_${crypto.randomUUID()}`,
                providerProductId: price.providerProductId,
                billingPriceEntryId: price.id,
                catalogRevision: 1,
                offerKey: "pro_month",
                plan: "pro",
                billingInterval: "month",
                status: input.status,
                paidThroughAt: input.paidThroughAt,
                cancelAtPeriodEnd: input.cancelAtPeriodEnd,
                isEntitlementSource: true,
            })
            .returning();
        await tdb
            .update(billingPlanStates)
            .set({
                plan: "pro",
                activeSubscriptionId: subscription.id,
            })
            .where(eq(billingPlanStates.billableEntityId, organizationId));
        return subscription;
    }

    it("treats an elapsed scheduled cancellation as Free even if the plan projection is stale", async () => {
        process.env.SENDLIT_DEPLOYMENT_MODE = "cloud";
        const owner = await seedOwner();
        const paid = await createOrganization(owner.id, "Paid");
        await attachSubscription(paid.id, owner.id, {
            status: "cancelled",
            cancelAtPeriodEnd: true,
            paidThroughAt: new Date(Date.now() - 60_000),
        });

        await expect(createOrganization(owner.id, "Second")).rejects.toThrow(
            "free_organization_already_owned",
        );
    });

    it("allows another Free organization while scheduled cancellation still has paid access", async () => {
        process.env.SENDLIT_DEPLOYMENT_MODE = "cloud";
        const owner = await seedOwner();
        const paid = await createOrganization(owner.id, "Paid");
        await attachSubscription(paid.id, owner.id, {
            status: "cancelled",
            cancelAtPeriodEnd: true,
            paidThroughAt: new Date(Date.now() + 60_000),
        });

        await expect(
            createOrganization(owner.id, "Second"),
        ).resolves.toMatchObject({ name: "Second" });
    });
});
