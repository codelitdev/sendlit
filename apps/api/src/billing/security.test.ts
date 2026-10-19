import { beforeEach, describe, expect, it, mock, vi } from "bun:test";

const authMocks = { getSession: vi.fn() };

mock.module("../auth/better-auth", () => ({
  auth: { api: { getSession: authMocks.getSession } },
}));

mock.module("../db/client", async () => {
  const { makeTestDb } = await import("../test/db.js");
  return { db: await makeTestDb() };
});

const { db } = await import("../db/client");
const { organizationMembers, organizations, user, verification } = await import(
  "../db/schema"
);
const { truncateAll } = await import("../test/db");
const { useCloudFakeBillingEnv } = await import("../test/billing");
type TestDb = import("../test/db").TestDb;
const {
  NEW_ORGANIZATION_TARGET,
  billingGrantFromToken,
  consumeNewOrganizationCheckoutToken,
  issueBillingActionToken,
  requireBillingAction,
} = await import("./security");
const { getBillingActionGrants } = await import("./engine");

const tdb = db as unknown as TestDb;

async function seedOrganization(
  publicId: string,
  status: "active" | "pending_payment",
  role: "owner" | "admin" = "owner",
) {
  await tdb
    .insert(user)
    .values({
      id: "user-1",
      name: "Owner",
      email: "owner@example.com",
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .onConflictDoNothing();
  const [organization] = await tdb
    .insert(organizations)
    .values({ organizationId: publicId, name: publicId, status })
    .returning();
  await tdb
    .insert(organizationMembers)
    .values({ organizationId: organization!.id, userId: "user-1", role });
  return organization!;
}

function session(createdAt: Date) {
  authMocks.getSession.mockResolvedValue({
    user: { id: "user-1" },
    session: { id: "session-1", createdAt, updatedAt: new Date() },
  });
}

function request(headers: Record<string, string> = {}) {
  return {
    authKind: "session",
    userId: "user-1",
    headers: {
      origin: "http://localhost:3000",
      cookie: "sendlit_csrf=csrf-value",
      "x-sendlit-csrf": "csrf-value",
      ...headers,
    },
  };
}

const response = { append: vi.fn() };

beforeEach(async () => {
  useCloudFakeBillingEnv();
  response.append.mockClear();
  authMocks.getSession.mockReset();
  await truncateAll(tdb);
});

describe("billing action authorization", () => {
  it("issues a legacy SendLit-only token that can be consumed only once", async () => {
    session(new Date());
    const issued = await issueBillingActionToken(
      request(),
      response,
      "organization_close",
      "org_1",
    );
    expect("token" in issued).toBe(true);
    if (!("token" in issued)) throw new Error("token_not_issued");

    const authorizedRequest = request({
      "x-sendlit-billing-action-token": issued.token,
    });
    await expect(
      requireBillingAction(authorizedRequest, response, "organization_close", "org_1"),
    ).resolves.toBeNull();
    await expect(
      requireBillingAction(authorizedRequest, response, "organization_close", "org_1"),
    ).resolves.toMatchObject({
      status: 401,
      body: { error: "billing_action_token_invalid" },
    });
  });

  it("binds an engine grant to the internal organization, action and session", async () => {
    const organization = await seedOrganization("org_active", "active");
    session(new Date());
    const issued = await issueBillingActionToken(
      request(),
      response,
      "cancellation",
      "org_active",
    );
    if (!("token" in issued)) throw new Error("token_not_issued");
    const [row] = await tdb.select().from(verification);
    expect(JSON.parse(row!.value)).toEqual({
      actorId: "user-1",
      sessionId: "session-1",
      action: "cancellation",
      target: { kind: "organization", id: organization.id },
    });
    const target = { kind: "organization", id: organization.id };
    const ready = { token: issued.token, sessionId: "session-1" };
    const grants = getBillingActionGrants();
    // Wrong session or wrong action is rejected (and burns the token).
    await expect(
      grants.authorization.consume(
        billingGrantFromToken(ready, "user-1", "portal", target),
        "portal",
        target,
        new Date(),
      ),
    ).rejects.toMatchObject({ code: "grant_invalid" });

    const again = await issueBillingActionToken(
      request(),
      response,
      "cancellation",
      "org_active",
    );
    if (!("token" in again)) throw new Error("token_not_issued");
    const grant = billingGrantFromToken(
      { token: again.token, sessionId: "session-1" },
      "user-1",
      "cancellation",
      target,
    );
    await expect(
      grants.authorization.consume(grant, "cancellation", target, new Date()),
    ).resolves.toBeUndefined();
    await expect(
      grants.authorization.consume(grant, "cancellation", target, new Date()),
    ).rejects.toMatchObject({ code: "grant_invalid" });
  });

  it("issues engine grants only to an organization owner", async () => {
    await seedOrganization("org_admin", "active", "admin");
    session(new Date());
    await expect(
      issueBillingActionToken(request(), response, "portal", "org_admin"),
    ).resolves.toEqual({ status: 403, body: { error: "billing_owner_required" } });
    await expect(
      issueBillingActionToken(request(), response, "portal", "org_missing"),
    ).resolves.toEqual({ status: 403, body: { error: "billing_action_invalid" } });
  });

  it("does not treat an ordinary session refresh as recent authentication", async () => {
    await seedOrganization("org_active", "active");
    session(new Date(Date.now() - 60 * 60 * 1000));

    await expect(
      issueBillingActionToken(request(), response, "checkout", "org_active"),
    ).resolves.toEqual({
      status: 401,
      body: { error: "recent_authentication_required" },
    });
    await expect(
      issueBillingActionToken(request(), response, "cancellation", "org_active"),
    ).resolves.toEqual({
      status: 401,
      body: { error: "recent_authentication_required" },
    });
    await expect(
      issueBillingActionToken(request(), response, "organization_checkout", "new"),
    ).resolves.toEqual({
      status: 401,
      body: { error: "recent_authentication_required" },
    });
  });

  it("lets resume checkout finish a pending organization without recent authentication", async () => {
    await seedOrganization("org_pending", "pending_payment");
    session(new Date(Date.now() - 60 * 60 * 1000));

    const issued = await issueBillingActionToken(
      request(),
      response,
      "checkout",
      "org_pending",
    );
    expect("token" in issued).toBe(true);
    // The exemption is for checkout only.
    await expect(
      issueBillingActionToken(request(), response, "portal", "org_pending"),
    ).resolves.toEqual({
      status: 401,
      body: { error: "recent_authentication_required" },
    });
  });

  it("consumes the paid-organization token at the route, once", async () => {
    session(new Date());
    const issued = await issueBillingActionToken(
      request(),
      response,
      "organization_checkout",
      "new",
    );
    if (!("token" in issued)) throw new Error("token_not_issued");
    const [row] = await tdb.select().from(verification);
    expect(JSON.parse(row!.value).target).toEqual(NEW_ORGANIZATION_TARGET);
    const withToken = request({ "x-sendlit-billing-action-token": issued.token });
    await expect(
      consumeNewOrganizationCheckoutToken({ ...withToken }, response),
    ).resolves.toMatchObject({ sessionId: "session-1" });
    await expect(
      consumeNewOrganizationCheckoutToken({ ...withToken }, response),
    ).resolves.toEqual({
      status: 401,
      body: { error: "billing_action_token_invalid" },
    });
  });

  it("enforces the session, Origin and CSRF boundary before issuing", async () => {
    session(new Date());
    await expect(
      issueBillingActionToken(
        { ...request(), authKind: "oauth" },
        response,
        "checkout",
        "org_1",
      ),
    ).resolves.toEqual({
      status: 403,
      body: { error: "billing_human_session_required" },
    });
    await expect(
      issueBillingActionToken(
        request({ origin: "https://evil.example" }),
        response,
        "checkout",
        "org_1",
      ),
    ).resolves.toEqual({ status: 403, body: { error: "csrf_origin_invalid" } });
    await expect(
      issueBillingActionToken(
        request({ "x-sendlit-csrf": "other" }),
        response,
        "checkout",
        "org_1",
      ),
    ).resolves.toEqual({ status: 403, body: { error: "csrf_token_invalid" } });
  });
});
