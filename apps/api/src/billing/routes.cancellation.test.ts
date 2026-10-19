import { beforeEach, describe, expect, it, mock, vi } from "bun:test";
import express from "express";

const authMocks = { getSession: vi.fn() };

mock.module("../auth/better-auth", () => ({
  auth: { api: { getSession: authMocks.getSession } },
}));

mock.module("../auth/middleware", () => ({
  requireAuth: (req: any, _res: any, next: () => void) => {
    req.authKind = req.headers["x-test-auth-kind"] ?? "session";
    req.userId = req.headers["x-test-user"] ?? "owner-1";
    next();
  },
}));

mock.module("../db/client", async () => {
  const { makeTestDb } = await import("../test/db.js");
  return { db: await makeTestDb() };
});

const { eq } = await import("drizzle-orm");
const { db } = await import("../db/client");
const {
  billingReconciliationJobs,
  billingSubscriptions,
  organizationAuditEvents,
  organizationMembers,
  user,
} = await import("../db/schema");
const { seedTeamAndContact, truncateAll } = await import("../test/db");
const { activateFakeCatalog, seedPaidSubscription, useCloudFakeBillingEnv } =
  await import("../test/billing");
const { requestApp } = await import("../test/http");
type TestDb = import("../test/db").TestDb;
const { default: billingRoutes } = await import("./routes");

const tdb = db as unknown as TestDb;

function app() {
  const server = express();
  server.use(express.json());
  server.use(billingRoutes);
  return server;
}

const browser = {
  origin: "http://localhost:3000",
  cookie: "sendlit_csrf=csrf-value",
  "x-sendlit-csrf": "csrf-value",
  "content-type": "application/json",
};

async function seed(options: { cancelAtPeriodEnd?: boolean } = {}) {
  const { account, organization } = await seedTeamAndContact(tdb, {
    account: { id: "owner-1" },
  });
  const paid = await seedPaidSubscription(tdb, {
    organizationId: organization.id,
    payerId: account.id,
    cancelAtPeriodEnd: options.cancelAtPeriodEnd,
  });
  return { account, organization, ...paid };
}

async function token(
  action: "cancellation" | "portal",
  target: string,
  headers: Record<string, string> = {},
) {
  const response = await requestApp(app(), "/billing/action-token", {
    method: "POST",
    headers: { ...browser, ...headers },
    body: JSON.stringify({ action, target }),
  });
  if (response.status !== 201)
    throw new Error(`token ${response.status} ${response.body}`);
  return response.json<{ token: string }>().token;
}

function post(path: string, headers: Record<string, string> = {}) {
  return requestApp(app(), path, {
    method: "POST",
    headers: { ...browser, ...headers },
  });
}

beforeEach(async () => {
  useCloudFakeBillingEnv();
  authMocks.getSession.mockReset();
  authMocks.getSession.mockImplementation(
    async ({ headers }: { headers: Headers }) => ({
      user: { id: headers.get("x-test-user") ?? "owner-1" },
      session: { id: "session-1", createdAt: new Date(), updatedAt: new Date() },
    }),
  );
  await truncateAll(tdb);
  await activateFakeCatalog();
});

describe("cancel and resume at period end", () => {
  it("schedules cancellation, keeps paid access, and resumes", async () => {
    const { organization, subscription } = await seed();
    const publicId = organization.organizationId;

    const cancelled = await post(`/organizations/${publicId}/billing/cancel`, {
      "x-sendlit-billing-action-token": await token("cancellation", publicId),
    });
    expect(cancelled.status).toBe(200);
    expect(cancelled.json<unknown>()).toEqual({
      accepted: true,
      subscriptionId: subscription.id,
    });

    let billing = (
      await requestApp(app(), `/organizations/${publicId}/billing`)
    ).json();
    expect(billing).toMatchObject({
      plan: "pro",
      paymentStatus: "cancel_at_period_end",
      cancelAtPeriodEnd: true,
      paidThroughAt: subscription.paidThroughAt!.toISOString(),
    });

    const resumed = await post(`/organizations/${publicId}/billing/resume`, {
      "x-sendlit-billing-action-token": await token("cancellation", publicId),
    });
    expect(resumed.status).toBe(200);
    billing = (await requestApp(app(), `/organizations/${publicId}/billing`)).json();
    expect(billing).toMatchObject({
      plan: "pro",
      paymentStatus: "active",
      cancelAtPeriodEnd: false,
    });
    // Engine audits carry only the subscription ID; they still land in the
    // organization's audit log.
    const actions = (
      await tdb
        .select({ action: organizationAuditEvents.action })
        .from(organizationAuditEvents)
        .where(eq(organizationAuditEvents.organizationId, organization.id))
    ).map((row) => row.action);
    expect(actions).toEqual(expect.arrayContaining(["cancellation", "resumption"]));
  });

  it("asks the caller to retry a resume while the cancellation is being sent", async () => {
    const { organization, subscription } = await seed({ cancelAtPeriodEnd: true });
    await tdb.insert(billingReconciliationJobs).values({
      provider: "fake",
      subscriptionId: subscription.id,
      operation: "cancellation",
      status: "processing",
      workerId: "other-worker",
      lockedAt: new Date(),
      leaseExpiresAt: new Date(Date.now() + 60_000),
    });
    const publicId = organization.organizationId;
    const response = await post(`/organizations/${publicId}/billing/resume`, {
      "x-sendlit-billing-action-token": await token("cancellation", publicId),
    });
    expect(response.status).toBe(409);
    expect(response.json<unknown>()).toEqual({
      error: "operation_conflicted",
      retryable: true,
    });
    const [row] = await tdb
      .select({ cancelAtPeriodEnd: billingSubscriptions.cancelAtPeriodEnd })
      .from(billingSubscriptions)
      .where(eq(billingSubscriptions.id, subscription.id));
    expect(row?.cancelAtPeriodEnd).toBe(true);
  });

  it("answers billing_subscription_required without a paid subscription", async () => {
    const { organization } = await seedTeamAndContact(tdb, {
      account: { id: "owner-1" },
    });
    const publicId = organization.organizationId;
    const response = await post(`/organizations/${publicId}/billing/cancel`, {
      "x-sendlit-billing-action-token": await token("cancellation", publicId),
    });
    expect(response.status).toBe(402);
    expect(response.json<unknown>()).toEqual({
      error: "billing_subscription_required",
    });
  });
});

describe("cancel and resume security boundaries", () => {
  it("rejects a mutation without an Origin, with a foreign Origin, or without CSRF", async () => {
    const { organization } = await seed();
    const path = `/organizations/${organization.organizationId}/billing/cancel`;
    const noOrigin = await requestApp(app(), path, {
      method: "POST",
      headers: { cookie: browser.cookie, "x-sendlit-csrf": "csrf-value" },
    });
    expect(noOrigin.status).toBe(403);
    expect(noOrigin.json<unknown>()).toEqual({ error: "csrf_origin_invalid" });
    const foreign = await post(path, { origin: "https://evil.example" });
    expect(foreign.json<unknown>()).toEqual({ error: "csrf_origin_invalid" });
    const noCsrf = await requestApp(
      app(),
      `/organizations/${organization.organizationId}/billing/resume`,
      { method: "POST", headers: { origin: browser.origin } },
    );
    expect(noCsrf.status).toBe(403);
    expect(noCsrf.json<unknown>()).toEqual({ error: "csrf_token_invalid" });
  });

  it("requires a human session and a token", async () => {
    const { organization } = await seed();
    const path = `/organizations/${organization.organizationId}/billing/cancel`;
    // Bearer/OAuth callers never pass the browser-origin boundary.
    const oauth = await post(path, { "x-test-auth-kind": "oauth" });
    expect(oauth.status).toBe(403);
    expect(oauth.json<unknown>()).toEqual({ error: "csrf_origin_invalid" });
    const missing = await post(path);
    expect(missing.status).toBe(401);
    expect(missing.json<unknown>()).toEqual({ error: "billing_action_token_required" });
  });

  it("rejects a token issued for another action, and a non-owner", async () => {
    const { organization } = await seed();
    const publicId = organization.organizationId;
    const wrongAction = await post(`/organizations/${publicId}/billing/cancel`, {
      "x-sendlit-billing-action-token": await token("portal", publicId),
    });
    expect(wrongAction.status).toBe(403);
    expect(wrongAction.json<unknown>()).toEqual({ error: "billing_owner_required" });

    await tdb.insert(user).values({
      id: "admin-1",
      name: "Admin",
      email: "admin@example.com",
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await tdb
      .insert(organizationMembers)
      .values({ organizationId: organization.id, userId: "admin-1", role: "admin" });
    const asAdmin = await post(`/organizations/${publicId}/billing/cancel`, {
      "x-test-user": "admin-1",
      "x-sendlit-billing-action-token": "not-a-real-token",
    });
    expect(asAdmin.status).toBe(403);
    expect(asAdmin.json<unknown>()).toEqual({ error: "billing_owner_required" });
    const adminToken = await requestApp(app(), "/billing/action-token", {
      method: "POST",
      headers: { ...browser, "x-test-user": "admin-1" },
      body: JSON.stringify({ action: "cancellation", target: publicId }),
    });
    expect(adminToken.status).toBe(403);
  });
});
