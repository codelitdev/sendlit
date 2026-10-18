import { beforeEach, describe, expect, it, mock } from "bun:test";

import { eq } from "drizzle-orm";

mock.module("../db/client", async () => {
  const { makeTestDb } = await import("../test/db.js");
  return { db: await makeTestDb() };
});

const { db } = await import("../db/client");
const { billingPlanStates, billingSubscriptions, verification } = await import(
  "../db/schema"
);
const { seedTeamAndContact, truncateAll } = await import("../test/db");
const { activateFakeCatalog, seedPaidSubscription, useCloudFakeBillingEnv } =
  await import("../test/billing");
type TestDb = import("../test/db").TestDb;
const { createOrganizationPlanChange } = await import("./plan-change");
const { getBillingActionGrants } = await import("./engine");

const tdb = db as unknown as TestDb;

beforeEach(async () => {
  useCloudFakeBillingEnv();
  await truncateAll(tdb);
  await activateFakeCatalog();
});

async function seedActiveSubscription() {
  const { account, organization } = await seedTeamAndContact(tdb);
  const { subscription } = await seedPaidSubscription(tdb, {
    organizationId: organization.id,
    payerId: account.id,
  });
  const grants = getBillingActionGrants();
  const target = { kind: "organization", id: organization.id };
  const issued = await grants.issue({
    actorId: account.id,
    sessionId: "session-1",
    sessionCreatedAt: new Date(),
    action: "plan_change",
    target,
  });
  if (!issued.ok) throw new Error("grant_not_issued");
  const grant = grants.grant({
    token: issued.token,
    actorId: account.id,
    sessionId: "session-1",
    action: "plan_change",
    target,
  });
  return { account, organization, subscription, grant };
}

async function grantRows() {
  return tdb.select().from(verification);
}

describe("plan-change pre-checks on the engine's commercial state", () => {
  it("rejects a plan change when the active subscription pointer has been cleared", async () => {
    const { account, organization, grant } = await seedActiveSubscription();
    await tdb
      .update(billingPlanStates)
      .set({ activeSubscriptionId: null })
      .where(eq(billingPlanStates.billableEntityId, organization.id));

    await expect(
      createOrganizationPlanChange({
        organizationId: organization.id,
        actorId: account.id,
        plan: "business",
        interval: "month",
        catalogRevision: 1,
        grant,
      }),
    ).rejects.toMatchObject({
      code: "billing_subscription_required",
      status: 402,
    });
    // The single-use grant is not spent on a request that cannot succeed.
    expect(await grantRows()).toHaveLength(1);
  });

  it("rejects a plan change when the subscription is no longer changeable", async () => {
    const { account, organization, subscription, grant } =
      await seedActiveSubscription();
    await tdb
      .update(billingSubscriptions)
      .set({ status: "cancelled", cancelAtPeriodEnd: true })
      .where(eq(billingSubscriptions.id, subscription.id));

    await expect(
      createOrganizationPlanChange({
        organizationId: organization.id,
        actorId: account.id,
        plan: "business",
        interval: "month",
        catalogRevision: 1,
        grant,
      }),
    ).rejects.toMatchObject({
      code: "billing_subscription_not_changeable",
      status: 409,
    });
  });

  it("rejects the current offer as the same plan", async () => {
    const { account, organization, grant } = await seedActiveSubscription();
    await expect(
      createOrganizationPlanChange({
        organizationId: organization.id,
        actorId: account.id,
        plan: "pro",
        interval: "month",
        catalogRevision: 1,
        grant,
      }),
    ).rejects.toMatchObject({ code: "billing_plan_change_same_plan", status: 409 });
  });

  it("starts an upgrade through the engine and consumes the grant", async () => {
    const { account, organization, grant } = await seedActiveSubscription();
    const result = await createOrganizationPlanChange({
      organizationId: organization.id,
      actorId: account.id,
      plan: "business",
      interval: "month",
      catalogRevision: 1,
      grant,
    });
    expect(result).toMatchObject({
      targetPlan: "business",
      targetInterval: "month",
      effectiveAt: "immediately",
    });
    expect(await grantRows()).toHaveLength(0);
  });

  it("maps a payer mismatch to billing_owner_required", async () => {
    const { organization, grant } = await seedActiveSubscription();
    const { account: other } = await seedTeamAndContact(tdb);
    await expect(
      createOrganizationPlanChange({
        organizationId: organization.id,
        actorId: other.id,
        plan: "business",
        interval: "month",
        catalogRevision: 1,
        grant: { ...grant, actorId: other.id },
      }),
    ).rejects.toMatchObject({ code: "billing_owner_required", status: 403 });
  });
});
