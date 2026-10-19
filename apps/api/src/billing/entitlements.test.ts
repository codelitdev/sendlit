import { beforeEach, describe, expect, it, mock } from "bun:test";

import { eq } from "drizzle-orm";

mock.module("../db/client", async () => {
  const { makeTestDb } = await import("../test/db.js");
  return { db: await makeTestDb() };
});

const { getTableName } = await import("drizzle-orm");
const { db } = await import("../db/client");
const {
  billingPlanStates,
  billingSubscriptions,
  outboundMessages,
  planSendReservations,
  planSendUsageBuckets,
} = await import("../db/schema");
const { seedTeamAndContact, truncateAll } = await import("../test/db");
const { activateFakeCatalog, seedPaidSubscription, useCloudFakeBillingEnv } =
  await import("../test/billing");
type TestDb = import("../test/db").TestDb;
const {
  commitSendReservation,
  getOrganizationEntitlements,
  getOrganizationEntitlementsInTransaction,
  reserveSend,
  settleExpiredSendReservation,
} = await import("./entitlements");
const { getBillingEngine } = await import("./engine");
const { PAST_DUE_GRACE_MS } = await import("./policies");

const tdb = db as unknown as TestDb;

beforeEach(async () => {
  useCloudFakeBillingEnv();
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

/** Wraps a transaction so every `SELECT ... FOR UPDATE` records its table,
 * in order. Everything else passes through unchanged. */
function recordLocks(tx: any, locks: string[]) {
  const wrap = (builder: any, state: { table?: string }): any =>
    new Proxy(builder, {
      get(target, prop, receiver) {
        const value = Reflect.get(target, prop, receiver);
        if (typeof value !== "function" || prop === "then") {
          return typeof value === "function" ? value.bind(target) : value;
        }
        return (...args: unknown[]) => {
          if (prop === "from") state.table = getTableName(args[0] as never);
          if (prop === "for" && args[0] === "update" && state.table) {
            locks.push(state.table);
          }
          const result = value.apply(target, args);
          if (result === target) return receiver;
          return result && typeof result === "object" && !(result instanceof Promise)
            ? wrap(result, state)
            : result;
        };
      },
    });
  return new Proxy(tx, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (prop === "select") {
        return (...args: unknown[]) => wrap(value.apply(target, args), {});
      }
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

describe("entitlements from the engine's commercial state", () => {
  beforeEach(async () => {
    await activateFakeCatalog();
  });

  it("reads paid access, a scheduled cancellation and its paid-through date", async () => {
    const { account, organization } = await seedTeamAndContact(tdb);
    const paidThroughAt = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000);
    await seedPaidSubscription(tdb, {
      organizationId: organization.id,
      payerId: account.id,
      offerKey: "business_year",
      cancelAtPeriodEnd: true,
      paidThroughAt,
    });
    const entitlements = await getOrganizationEntitlements(organization.id);
    expect(entitlements).toMatchObject({
      plan: "business",
      interval: "year",
      paymentStatus: "cancel_at_period_end",
      cancelAtPeriodEnd: true,
      teamsLimit: 15,
    });
    expect(entitlements.paidThroughAt?.toISOString()).toBe(paidThroughAt.toISOString());
  });

  it("grants Starter's limits to a Starter subscription", async () => {
    const { account, organization } = await seedTeamAndContact(tdb);
    await seedPaidSubscription(tdb, {
      organizationId: organization.id,
      payerId: account.id,
      offerKey: "starter_month",
    });
    expect(await getOrganizationEntitlements(organization.id)).toMatchObject({
      plan: "starter",
      interval: "month",
      paymentStatus: "active",
      teamsLimit: 1,
      monthlySendsLimit: 25_000,
      subscribedContactsLimit: null,
      marketingBranding: true,
      sharedOrganizationMailbox: false,
    });
  });

  it("drops paid access once a scheduled cancellation's paid-through date passes", async () => {
    const { account, organization } = await seedTeamAndContact(tdb);
    // alpha.3 kept this paid because the provider still says active.
    await seedPaidSubscription(tdb, {
      organizationId: organization.id,
      payerId: account.id,
      status: "active",
      cancelAtPeriodEnd: true,
      paidThroughAt: new Date(Date.now() - 60_000),
    });
    expect(await getOrganizationEntitlements(organization.id)).toMatchObject({
      plan: "free",
      paymentStatus: "free",
      teamsLimit: 1,
    });
  });

  it("applies the past-due grace from SendLit's plan policy", async () => {
    const { account, organization } = await seedTeamAndContact(tdb);
    const pastDueSince = new Date(Date.now() - PAST_DUE_GRACE_MS - 1_000);
    const graceEndsAt = new Date(pastDueSince.getTime() + PAST_DUE_GRACE_MS);
    await seedPaidSubscription(tdb, {
      organizationId: organization.id,
      payerId: account.id,
      status: "past_due",
      pastDueSince,
    });
    const entitlements = await getOrganizationEntitlements(organization.id);
    expect(entitlements).toMatchObject({
      plan: "pro",
      paymentStatus: "past_due",
      canSend: false,
    });
    expect(entitlements.graceEndsAt?.toISOString()).toBe(graceEndsAt.toISOString());
  });

  it("locks subscriptions, then the plan state, then the plan policy inside a quota transaction", async () => {
    const { account, organization } = await seedTeamAndContact(tdb);
    await seedPaidSubscription(tdb, {
      organizationId: organization.id,
      payerId: account.id,
    });
    const locks: string[] = [];
    const entitlements = await tdb.transaction((tx) =>
      getOrganizationEntitlementsInTransaction(
        recordLocks(tx, locks) as never,
        organization.id,
      ),
    );
    expect(entitlements.plan).toBe("pro");
    // Same order as the engine's projection: subscription, plan state, then
    // SendLit's plan policy (which the afterProjection hook writes).
    expect(locks[0]).toBe("billing_subscriptions");
    expect(locks.indexOf("billing_plan_states")).toBeGreaterThan(0);
    expect(locks.indexOf("organization_plan_policies")).toBeGreaterThan(
      locks.indexOf("billing_plan_states"),
    );
    // commercialState read its rows in this transaction (locked).
    expect(locks).toContain("billing_checkout_attempts");
  });
});

describe("scheduled cancellation expiry", () => {
  beforeEach(async () => {
    await activateFakeCatalog();
  });

  it("keeps scheduled cancellation paid until the verified paid-through time", async () => {
    const { account, organization } = await seedTeamAndContact(tdb);
    await seedPaidSubscription(tdb, {
      organizationId: organization.id,
      payerId: account.id,
      cancelAtPeriodEnd: true,
      paidThroughAt: new Date(Date.now() + 60_000),
    });
    expect(await getBillingEngine().runDeadlineBatch()).toBe(0);
    const [state] = await tdb
      .select()
      .from(billingPlanStates)
      .where(eq(billingPlanStates.billableEntityId, organization.id));
    expect(state?.activeSubscriptionId).toEqual(expect.any(String));
    expect((await getOrganizationEntitlements(organization.id)).plan).toBe("pro");
  });

  it("releases an elapsed scheduled cancellation through the engine", async () => {
    const { account, organization } = await seedTeamAndContact(tdb);
    const { subscription } = await seedPaidSubscription(tdb, {
      organizationId: organization.id,
      payerId: account.id,
      cancelAtPeriodEnd: true,
      paidThroughAt: new Date(Date.now() - 60_000),
    });
    expect(await getBillingEngine().runDeadlineBatch()).toBe(1);
    const [state] = await tdb
      .select()
      .from(billingPlanStates)
      .where(eq(billingPlanStates.billableEntityId, organization.id));
    const [row] = await tdb
      .select()
      .from(billingSubscriptions)
      .where(eq(billingSubscriptions.id, subscription.id));
    expect(state).toMatchObject({ activeSubscriptionId: null });
    expect(row?.isEntitlementSource).toBe(false);
    expect((await getOrganizationEntitlements(organization.id)).plan).toBe("free");
  });
});
