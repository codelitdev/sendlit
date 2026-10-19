import { beforeEach, describe, expect, it, mock } from "bun:test";

mock.module("../db/client", async () => {
  const { makeTestDb } = await import("../test/db.js");
  return { db: await makeTestDb() };
});

const { and, eq } = await import("drizzle-orm");
const { db } = await import("../db/client");
const {
  billingCheckoutAttempts,
  organizationAuditEvents,
  organizationMembers,
  organizationPlanPolicies,
  organizations,
  teams,
  trialClaims,
  user,
} = await import("../db/schema");
const { truncateAll } = await import("../test/db");
const { activateFakeCatalog, fakeProvider, useCloudFakeBillingEnv } = await import(
  "../test/billing"
);
type TestDb = import("../test/db").TestDb;
const { createOrganizationCheckout } = await import("./checkout");
const { getBillingActionGrants, getBillingEngine } = await import("./engine");
const { getOrganizationEntitlements } = await import("./entitlements");
const { applySendLitProjectionEffects } = await import("./product-effects");
const { PAST_DUE_GRACE_MS } = await import("./policies");
const { abandonPendingOrganization } = await import("../organization/queries");

const tdb = db as unknown as TestDb;

beforeEach(async () => {
  useCloudFakeBillingEnv();
  await truncateAll(tdb);
  await activateFakeCatalog();
});

async function pendingOrganization() {
  const userId = crypto.randomUUID();
  await tdb.insert(user).values({
    id: userId,
    name: "Owner",
    email: `${userId}@example.com`,
    emailVerified: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  const [organization] = await tdb
    .insert(organizations)
    .values({
      name: "Pending org",
      status: "pending_payment",
      pendingTeamName: "Launch team",
    })
    .returning();
  await tdb
    .insert(organizationMembers)
    .values({ organizationId: organization!.id, userId, role: "owner" });
  return { userId, organization: organization! };
}

async function checkout(
  userId: string,
  organizationId: string,
  plan: "pro" | "business" = "pro",
) {
  const grants = getBillingActionGrants();
  const target = { kind: "organization", id: organizationId };
  const issued = await grants.issue({
    actorId: userId,
    sessionId: "session-1",
    sessionCreatedAt: new Date(),
    action: "checkout",
    target,
  });
  if (!issued.ok) throw new Error("grant_not_issued");
  await createOrganizationCheckout({
    organizationId,
    payerId: userId,
    plan,
    interval: "month",
    catalogRevision: 1,
    grant: grants.grant({
      token: issued.token,
      actorId: userId,
      sessionId: "session-1",
      action: "checkout",
      target,
    }),
  });
  const [attempt] = await tdb
    .select()
    .from(billingCheckoutAttempts)
    .where(eq(billingCheckoutAttempts.billableEntityId, organizationId))
    .orderBy(billingCheckoutAttempts.createdAt);
  return attempt!;
}

/** The provider takes the payment and its webhook reaches the engine. */
async function payAndDeliverWebhook(sessionId: string) {
  const provider = await fakeProvider();
  const snapshot = await provider.simulatePayment(sessionId);
  const body = JSON.stringify({
    type: "subscription.active",
    data: {
      subscription_id: snapshot.providerSubscriptionId,
      metadata: snapshot.metadata,
    },
  });
  const billing = getBillingEngine();
  await billing.ingestWebhook({ provider: "fake", raw: provider.signWebhook(body) });
  await billing.runWebhookInboxBatch({ workerId: "test" });
}

async function status(organizationId: string) {
  const [row] = await tdb
    .select({ status: organizations.status })
    .from(organizations)
    .where(eq(organizations.id, organizationId));
  return row?.status;
}

describe("SendLit projection effects", () => {
  it("activates a pending organization and creates its first team on payment", async () => {
    const { userId, organization } = await pendingOrganization();
    const attempt = await checkout(userId, organization.id);
    await payAndDeliverWebhook(attempt.providerCheckoutSessionId!);

    expect(await status(organization.id)).toBe("active");
    const created = await tdb
      .select({ name: teams.name })
      .from(teams)
      .where(eq(teams.organizationId, organization.id));
    expect(created).toEqual([{ name: "Launch team" }]);
    const [activated] = await tdb
      .select({ pendingTeamName: organizations.pendingTeamName })
      .from(organizations)
      .where(eq(organizations.id, organization.id));
    expect(activated?.pendingTeamName).toBeNull();
    const [claim] = await tdb.select().from(trialClaims);
    expect(claim?.status).toBe("redeemed");
    expect((await getOrganizationEntitlements(organization.id)).plan).toBe("pro");
  });

  it("does not reactivate an abandoned organization on a late paid webhook", async () => {
    const { userId, organization } = await pendingOrganization();
    const attempt = await checkout(userId, organization.id);
    await abandonPendingOrganization(organization.id, userId);
    // Abandoning the checkout released the reserved trial.
    const [released] = await tdb.select().from(trialClaims);
    expect(released?.status).toBe("released");

    await payAndDeliverWebhook(attempt.providerCheckoutSessionId!);

    expect(await status(organization.id)).toBe("abandoned");
    expect(
      await tdb.select().from(teams).where(eq(teams.organizationId, organization.id)),
    ).toHaveLength(0);
    const audits = await tdb
      .select({ action: organizationAuditEvents.action })
      .from(organizationAuditEvents)
      .where(
        and(
          eq(organizationAuditEvents.organizationId, organization.id),
          eq(organizationAuditEvents.action, "billing.paid_for_inactive_organization"),
        ),
      );
    expect(audits).toHaveLength(1);
  });

  it("does not reactivate a closed or suspended organization", async () => {
    for (const terminal of ["closed", "suspended"] as const) {
      const { userId, organization } = await pendingOrganization();
      const attempt = await checkout(userId, organization.id);
      await tdb
        .update(organizations)
        .set({ status: terminal })
        .where(eq(organizations.id, organization.id));

      await payAndDeliverWebhook(attempt.providerCheckoutSessionId!);

      expect(await status(organization.id)).toBe(terminal);
    }
  });

  it("releases the trial when its checkout is replaced, so switching back keeps the trial", async () => {
    const { userId, organization } = await pendingOrganization();
    const provider = await fakeProvider();
    const first = await checkout(userId, organization.id, "pro");
    expect(provider.lastCreateCheckoutInput?.trialDays).toBe(14);
    let [claim] = await tdb.select().from(trialClaims);
    expect(claim).toMatchObject({ status: "reserved", checkoutAttemptId: first.id });

    await checkout(userId, organization.id, "business");
    [claim] = await tdb.select().from(trialClaims);
    expect(claim?.status).toBe("released");

    await checkout(userId, organization.id, "pro");
    expect(provider.lastCreateCheckoutInput?.trialDays).toBe(14);
    [claim] = await tdb.select().from(trialClaims);
    expect(claim?.status).toBe("reserved");
    expect(claim?.checkoutAttemptId).not.toBe(first.id);
  });

  it("records when the entitlement subscription goes past due and clears it on recovery", async () => {
    const { organization } = await pendingOrganization();
    const subscription = {
      id: crypto.randomUUID(),
      billableEntityId: organization.id,
      payerId: "payer",
      status: "active",
      isEntitlementSource: true,
      originCheckoutAttemptId: null,
      providerOccurredAt: null,
    };
    const project = (previous: string, next: string) =>
      applySendLitProjectionEffects(
        {
          material: true,
          previous: { ...subscription, status: previous } as never,
          next: { ...subscription, status: next } as never,
          planState: {} as never,
        },
        tdb as never,
      );
    const pastDueSince = async () =>
      (
        await tdb
          .select({ pastDueSince: organizationPlanPolicies.pastDueSince })
          .from(organizationPlanPolicies)
          .where(eq(organizationPlanPolicies.organizationId, organization.id))
      )[0]?.pastDueSince ?? null;

    const before = Date.now();
    await project("active", "past_due");
    const since = await pastDueSince();
    expect(since?.getTime()).toBeGreaterThanOrEqual(before);

    // Staying past due keeps the original start, so the grace does not reset.
    await project("past_due", "past_due");
    expect((await pastDueSince())?.getTime()).toBe(since?.getTime());
    expect(PAST_DUE_GRACE_MS).toBe(7 * 24 * 60 * 60 * 1000);

    await project("past_due", "active");
    expect(await pastDueSince()).toBeNull();
  });
});
