import { beforeEach, describe, expect, it, mock, vi } from "bun:test";
import { eq } from "drizzle-orm";
import express from "express";

const authState = {
  userId: "",
  authKind: "organization_key" as string,
  organizationId: "",
  organizationApiKeyId: "org-key-test",
  organizationScopes: [] as string[],
};
const espTestMock = { testEspConfig: vi.fn() };

mock.module("../db/client", async () => {
  const { makeTestDb } = await import("../test/db");
  return { db: await makeTestDb() };
});
mock.module("../auth/middleware", () => ({
  requireAuth: (req: any, _res: any, next: () => void) => {
    req.userId = authState.userId;
    req.authKind = authState.authKind;
    req.organizationId = authState.organizationId;
    req.organizationApiKeyId = authState.organizationApiKeyId;
    req.organizationScopes = authState.organizationScopes;
    next();
  },
}));
mock.module("../settings/esp/test", () => ({
  testEspConfig: espTestMock.testEspConfig,
}));

const { db } = await import("../db/client");
const {
  espConfigs,
  espConfigTeamGrants,
  organizationApiKeys,
  organizationAuditEvents,
  organizationDeliveryPolicies,
  organizationMembers,
  outboundMessages,
  sharedEspSendingControls,
  teamDeliverySettings,
  teams,
  user,
} = await import("../db/schema");
const { createOrganization } = await import("../organization/queries");
const { default: organizationRoutes } = await import("../organization/routes");
const { createOrganizationEspConfig } = await import("../settings/esp/queries");
const { truncateAll } = await import("../test/db");
type TestDb = import("../test/db").TestDb;
const { requestApp } = await import("../test/http");
const { default: provisioningRoutes } = await import("./routes");

const tdb = db as unknown as TestDb;

function app() {
  const instance = express();
  instance.use(express.json());
  instance.use(organizationRoutes);
  instance.use(provisioningRoutes);
  return instance;
}

async function insertUser(name: string) {
  const [account] = await tdb
    .insert(user)
    .values({
      id: crypto.randomUUID(),
      name,
      email: `${name.toLowerCase()}-${crypto.randomUUID()}@example.com`,
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .returning();
  return account;
}

async function createActiveOrganizationEsp(organizationId: string) {
  const esp = await createOrganizationEspConfig(organizationId, {
    name: "Shared SMTP",
    provider: "smtp",
    host: "smtp.example.com",
    port: 587,
    secure: false,
    fromEmail: "mail@example.com",
  });
  await tdb
    .update(espConfigs)
    .set({ status: "active" })
    .where(eq(espConfigs.id, esp.id));
  return esp;
}

function policyPath(organizationId: string) {
  return `/organizations/${organizationId}/delivery-policy`;
}

beforeEach(async () => {
  await truncateAll(tdb);
  authState.userId = "";
  authState.authKind = "organization_key";
  authState.organizationId = "";
  authState.organizationApiKeyId = "org-key-test";
  authState.organizationScopes = [];
  espTestMock.testEspConfig.mockReset().mockResolvedValue({ success: true });
});

describe("headless organization provisioning", () => {
  it("discovers only the organization bound to the calling key", async () => {
    const owner = await insertUser("Owner");
    const org = await createOrganization(owner.id, "Acme");
    const otherOwner = await insertUser("Other");
    const otherOrg = await createOrganization(otherOwner.id, "Other Org");
    authState.organizationId = org.id;
    authState.organizationScopes = ["organization:read"];

    const response = await requestApp(app(), "/provisioning/organization");
    expect(response.status).toBe(200);
    expect(response.json()).toMatchObject({
      organizationId: org.organizationId,
      name: "Acme",
    });
    expect(response.json().organizationId).not.toBe(otherOrg.organizationId);

    authState.organizationScopes = [];
    const denied = await requestApp(app(), "/provisioning/organization");
    expect(denied.status).toBe(403);
  });

  it("requires delivery-specific scopes and enforces the key organization binding", async () => {
    const owner = await insertUser("Owner");
    const org = await createOrganization(owner.id, "Acme");
    const otherOwner = await insertUser("Other");
    const otherOrg = await createOrganization(otherOwner.id, "Other Org");
    authState.organizationId = org.id;
    authState.organizationScopes = ["esps:manage", "grants:manage"];

    expect((await requestApp(app(), policyPath(org.organizationId))).status).toBe(403);
    const deniedWrite = await requestApp(app(), policyPath(org.organizationId), {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ autoGrantDefaultEsp: true }),
    });
    expect(deniedWrite.status).toBe(403);

    authState.organizationScopes = ["delivery:read"];
    expect((await requestApp(app(), policyPath(org.organizationId))).status).toBe(200);
    const deniedReadOnlyWrite = await requestApp(
      app(),
      policyPath(org.organizationId),
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ autoGrantDefaultEsp: true }),
      },
    );
    expect(deniedReadOnlyWrite.status).toBe(403);

    authState.organizationScopes = ["delivery:manage"];
    const foreignBinding = await requestApp(
      app(),
      policyPath(otherOrg.organizationId),
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ autoGrantDefaultEsp: true }),
      },
    );
    expect(foreignBinding.status).toBe(404);
  });

  it("allows an organization key to test an ESP with an explicit recipient", async () => {
    const owner = await insertUser("Owner");
    const org = await createOrganization(owner.id, "Acme");
    const esp = await createOrganizationEspConfig(org.id, {
      name: "Shared SMTP",
      provider: "smtp",
      host: "smtp.example.com",
      port: 587,
      secure: false,
      fromEmail: "mail@example.com",
    });
    authState.organizationId = org.id;
    authState.organizationScopes = ["esps:manage"];

    const response = await requestApp(
      app(),
      `/organizations/${org.organizationId}/esps/${esp.espId}/test`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ to: "operator@example.com" }),
      },
    );

    expect(response.status).toBe(200);
    expect(espTestMock.testEspConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        config: expect.objectContaining({ espId: esp.espId }),
        to: "operator@example.com",
        account: undefined,
      }),
    );
  });

  it("sets policy as an organization key and grants the default to a newly provisioned team", async () => {
    const owner = await insertUser("Owner");
    const org = await createOrganization(owner.id, "Acme");
    const esp = await createActiveOrganizationEsp(org.id);
    authState.organizationId = org.id;
    authState.organizationScopes = ["delivery:manage"];

    const updated = await requestApp(app(), policyPath(org.organizationId), {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        defaultEspId: esp.espId,
        autoGrantDefaultEsp: true,
      }),
    });
    expect(updated.status).toBe(200);
    expect(updated.json()).toMatchObject({
      defaultEspId: esp.espId,
      autoGrantDefaultEsp: true,
    });
    expect(
      await tdb
        .select()
        .from(organizationApiKeys)
        .where(eq(organizationApiKeys.organizationId, org.id)),
    ).toHaveLength(0);

    const provisioned = await requestApp(app(), "/provisioning/teams", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        externalId: "courselit:school-123",
        name: "School 123",
      }),
    });
    // Team provisioning remains a separate authority from delivery policy.
    expect(provisioned.status).toBe(403);

    authState.organizationScopes = ["delivery:manage", "teams:provision"];
    const created = await requestApp(app(), "/provisioning/teams", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        externalId: "courselit:school-123",
        name: "School 123",
      }),
    });
    expect(created.status).toBe(200);
    expect(created.json()).toMatchObject({
      created: true,
      name: "School 123",
    });

    const [policy] = await tdb
      .select()
      .from(organizationDeliveryPolicies)
      .where(eq(organizationDeliveryPolicies.organizationId, org.id));
    expect(policy.defaultEspConfigId).toBe(esp.id);

    const [team] = await tdb
      .select({ id: teams.id })
      .from(teams)
      .where(eq(teams.teamId, created.json().teamId));
    expect(team).toBeDefined();
    const [teamDelivery] = await tdb
      .select({ settings: teamDeliverySettings })
      .from(teamDeliverySettings)
      .where(eq(teamDeliverySettings.teamId, team.id));
    expect(teamDelivery.settings.defaultSource).toBe("organization");

    const [grant] = await tdb
      .select()
      .from(espConfigTeamGrants)
      .where(eq(espConfigTeamGrants.teamId, team.id));
    expect(grant).toMatchObject({
      organizationId: org.id,
      espConfigId: esp.id,
      status: "active",
    });

    const audit = await tdb
      .select()
      .from(organizationAuditEvents)
      .where(
        eq(organizationAuditEvents.action, "organization_delivery_policy.updated"),
      );
    expect(audit).toEqual([
      expect.objectContaining({
        actorType: "organization_key",
        actorId: authState.organizationApiKeyId,
      }),
    ]);
  });

  it("keeps owner/admin session access and rejects inactive or foreign ESP defaults", async () => {
    const owner = await insertUser("Owner");
    const org = await createOrganization(owner.id, "Acme");
    const esp = await createActiveOrganizationEsp(org.id);
    const otherOwner = await insertUser("Other");
    const otherOrg = await createOrganization(otherOwner.id, "Other Org");
    const foreignEsp = await createActiveOrganizationEsp(otherOrg.id);

    authState.authKind = "session";
    authState.userId = owner.id;
    authState.organizationId = "";
    authState.organizationScopes = [];
    expect((await requestApp(app(), policyPath(org.organizationId))).status).toBe(200);
    const ownerUpdate = await requestApp(app(), policyPath(org.organizationId), {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ autoGrantDefaultEsp: true }),
    });
    expect(ownerUpdate.status).toBe(200);

    const admin = await insertUser("Admin");
    await tdb.insert(organizationMembers).values({
      organizationId: org.id,
      userId: admin.id,
      role: "admin",
    });
    authState.userId = admin.id;
    expect((await requestApp(app(), policyPath(org.organizationId))).status).toBe(200);
    const adminUpdate = await requestApp(app(), policyPath(org.organizationId), {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ teamEspEnabledByDefault: false }),
    });
    expect(adminUpdate.status).toBe(200);

    authState.authKind = "organization_key";
    authState.organizationId = org.id;
    authState.organizationScopes = ["delivery:manage"];
    const foreignUpdate = await requestApp(app(), policyPath(org.organizationId), {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ defaultEspId: foreignEsp.espId }),
    });
    expect(foreignUpdate.status).toBe(422);

    await tdb
      .update(espConfigs)
      .set({ status: "draft" })
      .where(eq(espConfigs.id, esp.id));
    const inactiveUpdate = await requestApp(app(), policyPath(org.organizationId), {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ defaultEspId: esp.espId }),
    });
    expect(inactiveUpdate.status).toBe(422);
  });

  it("provisions and updates a team's postal address", async () => {
    const owner = await insertUser("Owner");
    const org = await createOrganization(owner.id, "Acme");
    authState.organizationId = org.id;
    authState.organizationScopes = ["teams:provision", "teams:read", "teams:manage"];
    const bristol = {
      line1: "18 Harbour Lane",
      city: "Bristol",
      postalCode: "BS1 4RN",
      country: "GB",
    };
    const send = (method: string, path: string, body?: unknown) =>
      requestApp(app(), path, {
        method,
        headers: { "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });

    const invalid = await send("POST", "/provisioning/teams", {
      externalId: "courselit:school-1",
      name: "School 1",
      postalAddress: { ...bristol, country: "UK" },
    });
    expect(invalid.status).toBe(400);
    expect(invalid.json()).toEqual({ error: "postal_country_invalid" });
    expect(await tdb.select().from(teams)).toHaveLength(0);

    const created = await send("POST", "/provisioning/teams", {
      externalId: "courselit:school-1",
      name: "School 1",
      postalAddress: { ...bristol, line2: " " },
    });
    expect(created.status).toBe(200);
    const path = `/provisioning/teams/${created.json().teamId}`;
    const team = await send("GET", path);
    expect(team.json()).toMatchObject({ postalAddress: bristol });
    expect(team.json()).not.toHaveProperty("mailingAddress");

    const badUpdate = await send("PATCH", path, {
      postalAddress: { ...bristol, country: "XK" },
    });
    expect(badUpdate.status).toBe(400);
    expect(badUpdate.json()).toEqual({ error: "postal_country_invalid" });

    const moved = { line1: "1 Main St", city: "Springfield", country: "US" };
    expect((await send("PATCH", path, { postalAddress: moved })).json()).toMatchObject({
      postalAddress: moved,
    });
    expect((await send("PATCH", path, { postalAddress: null })).json()).toMatchObject({
      postalAddress: null,
    });
  });

  it("shows a team's health on the team and usage responses", async () => {
    const owner = await insertUser("Owner");
    const org = await createOrganization(owner.id, "Acme");
    authState.organizationId = org.id;
    authState.organizationScopes = ["teams:provision", "teams:read", "usage:read"];
    const esp = await createActiveOrganizationEsp(org.id);
    const created = await requestApp(app(), "/provisioning/teams", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ externalId: "courselit:school-1", name: "School 1" }),
    });
    const [team] = await tdb
      .select()
      .from(teams)
      .where(eq(teams.teamId, created.json().teamId));
    const [grant] = await tdb
      .insert(espConfigTeamGrants)
      .values({
        organizationId: org.id,
        espConfigId: esp.id,
        teamId: team.id,
        dailyLimit: 100,
        createdByType: "user",
      })
      .returning();
    const acceptedAt = new Date(Date.now() - 60 * 60 * 1000);
    await tdb.insert(outboundMessages).values(
      Array.from({ length: 10 }, (_, i) => ({
        teamId: team.id,
        deliverySourceType: "organization",
        espConfigId: esp.id,
        espGrantId: grant.id,
        sourceType: "campaign",
        recipientEmail: `r${i}@example.com`,
        normalizedRecipient: `r${i}@example.com`,
        provider: "smtp",
        deliveryStatus: i < 3 ? "bounced" : "delivered",
        feedbackStatus: i === 9 ? "complained" : "none",
        acceptedAt,
      })),
    );
    await tdb.insert(sharedEspSendingControls).values({
      organizationId: org.id,
      espConfigId: esp.id,
      teamId: team.id,
      status: "marketing_paused",
      reasonCode: "shared_esp_team_breach",
    });
    const path = `/provisioning/teams/${team.teamId}`;
    const last7Days = { sent: 10, bounced: 3, complained: 1 };

    // The shared-mailbox pause only counts while its guard is on.
    const off = await requestApp(app(), path);
    expect(off.json().health).toEqual({
      status: "normal",
      reason: null,
      scope: null,
      last7Days,
    });

    process.env.SHARED_ESP_GUARD = "on";
    try {
      const paused = {
        status: "marketing_paused",
        reason: "shared_esp_team_breach",
        scope: "team",
        last7Days,
      };
      expect((await requestApp(app(), path)).json().health).toEqual(paused);
      const usage = await requestApp(app(), `${path}/usage`);
      expect(usage.status).toBe(200);
      expect(usage.json()).toMatchObject({
        health: paused,
        day: { limit: 100, accepted: 0, remaining: 100 },
      });
    } finally {
      delete process.env.SHARED_ESP_GUARD;
    }
  });
});
