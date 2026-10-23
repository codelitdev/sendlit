import { beforeEach, describe, expect, it, mock, vi } from "bun:test";

mock.module("../db/client", async () => {
  const { makeTestDb } = await import("../test/db.js");
  return { db: await makeTestDb() };
});

const { eq } = await import("drizzle-orm");
const { db } = await import("../db/client");
const { billingReconciliationJobs, billingSubscriptions } = await import(
  "../db/schema"
);
const { seedTeamAndContact, truncateAll } = await import("../test/db");
const {
  activateFakeCatalog,
  fakeProvider,
  seedPaidSubscription,
  useCloudFakeBillingEnv,
} = await import("../test/billing");
type TestDb = import("../test/db").TestDb;
const { runBillingCli } = await import("./operator-cli");
const { getBillingEngine } = await import("./engine");
const { getOrganizationEntitlements } = await import("./entitlements");

const tdb = db as unknown as TestDb;

function io(operations?: () => any) {
  const out: string[] = [];
  const err: string[] = [];
  return {
    out,
    err,
    io: {
      out: (line: string) => out.push(line),
      err: (line: string) => err.push(line),
      ...(operations ? { operations } : {}),
    },
  };
}

beforeEach(async () => {
  useCloudFakeBillingEnv();
  await truncateAll(tdb);
  await activateFakeCatalog();
});

async function seedScheduled() {
  const lapsed = await seedTeamAndContact(tdb);
  const lapsedSub = await seedPaidSubscription(tdb, {
    organizationId: lapsed.organization.id,
    payerId: lapsed.account.id,
    status: "active",
    cancelAtPeriodEnd: true,
    paidThroughAt: new Date(Date.now() - 60 * 60 * 1000),
  });
  const upcoming = await seedTeamAndContact(tdb);
  const upcomingSub = await seedPaidSubscription(tdb, {
    organizationId: upcoming.organization.id,
    payerId: upcoming.account.id,
    cancelAtPeriodEnd: true,
    paidThroughAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
  });
  const unaffected = await seedTeamAndContact(tdb);
  await seedPaidSubscription(tdb, {
    organizationId: unaffected.organization.id,
    payerId: unaffected.account.id,
  });
  await tdb.insert(billingReconciliationJobs).values({
    provider: "fake",
    subscriptionId: upcomingSub.subscription.id,
    operation: "cancellation",
    status: "failed",
    attemptCount: 2,
  });
  return { lapsed, lapsedSub, upcoming, upcomingSub };
}

describe("billing reconcile-cancellations", () => {
  it("reports scheduled cancellations and queued cancellation jobs without changing anything", async () => {
    const { lapsed, lapsedSub, upcomingSub } = await seedScheduled();
    const operations = vi.fn();
    const run = io(operations);

    const code = await runBillingCli(["reconcile-cancellations"], run.io);

    expect(code).toBe(0);
    expect(operations).not.toHaveBeenCalled();
    const report = JSON.parse(run.out[0]!);
    expect(report).toMatchObject({
      mode: "dry-run",
      scheduledCancellations: 2,
      paidThroughPassed: 1,
    });
    expect(report.subscriptions[0]).toMatchObject({
      subscriptionId: lapsedSub.subscription.id,
      organizationId: lapsed.organization.organizationId,
      paidThroughPassed: true,
    });
    expect(report.queuedCancellationJobs).toEqual([
      expect.objectContaining({
        subscriptionId: upcomingSub.subscription.id,
        status: "failed",
      }),
    ]);
    expect(run.out[1]).toContain("Dry run");
    const rows = await tdb.select().from(billingSubscriptions);
    expect(rows.filter((row) => row.cancelAtPeriodEnd)).toHaveLength(2);
    // --dry-run is the same as the default.
    expect(await runBillingCli(["reconcile-cancellations", "--dry-run"], io().io)).toBe(
      0,
    );
  });

  it("applies only with --apply and an operator", async () => {
    await seedScheduled();
    const run = io();
    expect(await runBillingCli(["reconcile-cancellations", "--apply"], run.io)).toBe(2);
    expect(run.err[0]).toContain("reconcile-cancellations --apply --operator");
  });

  it("re-reads each row from the provider so a missed resume keeps paid access", async () => {
    const { lapsed, lapsedSub, upcomingSub } = await seedScheduled();
    // The customer resumed at the provider; SendLit missed the webhook.
    const provider = await fakeProvider();
    await provider.resumeSubscription(
      lapsedSub.remote.providerSubscriptionId,
      "resume:missed",
    );
    const run = io();

    const code = await runBillingCli(
      ["reconcile-cancellations", "--apply", "--operator", "ops-1"],
      run.io,
    );

    expect(code).toBe(0);
    const report = JSON.parse(run.out[0]!);
    expect(report.results).toEqual([
      { subscriptionId: lapsedSub.subscription.id, ok: true },
      { subscriptionId: upcomingSub.subscription.id, ok: true },
    ]);
    const [row] = await tdb
      .select()
      .from(billingSubscriptions)
      .where(eq(billingSubscriptions.id, lapsedSub.subscription.id));
    expect(row?.cancelAtPeriodEnd).toBe(false);
    // The first deadline batch after deploy no longer downgrades it.
    await getBillingEngine().runDeadlineBatch();
    expect((await getOrganizationEntitlements(lapsed.organization.id)).plan).toBe(
      "pro",
    );
  });
});
