import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import express from "express";

const authState = {
  authKind: "organization_key",
  organizationId: "",
  organizationApiKeyId: "org-key-test",
  organizationScopes: [] as string[],
};

mock.module("../db/client", async () => {
  const { makeTestDb } = await import("../test/db");
  return { db: await makeTestDb() };
});
mock.module("../auth/middleware", () => ({
  requireAuth: (req: any, _res: any, next: () => void) => {
    Object.assign(req, authState);
    next();
  },
}));
mock.module("../utils/dns", () => ({
  DNS_ATTEMPT_TIMEOUT_MS: 6_000,
  freshDnsLookups: () => ({
    resolveTxt: async () => {
      throw Object.assign(new Error("not found"), { code: "ENOTFOUND" });
    },
    resolveMx: async () => [],
    resolveCname: async () => [],
  }),
  resolveTxtWithTimeout: async () => [],
}));

const { db } = await import("../db/client");
const schema = await import("../db/schema");
const { seedTeamAndContact, truncateAll } = await import("../test/db");
const providers = await import("../delivery/domain-providers");
const { requestApp } = await import("../test/http");
const { default: provisioningRoutes } = await import("./routes");
type TestDb = import("../test/db").TestDb;

const tdb = db as unknown as TestDb;

function app() {
  const instance = express();
  instance.use(express.json());
  instance.use(provisioningRoutes);
  return instance;
}

const send = (method: string, path: string, body?: unknown) =>
  requestApp(app(), path, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

beforeEach(async () => {
  await truncateAll(tdb);
  const state = (domain: string) => ({
    verified: false,
    dkim: "pending" as const,
    records: [
      {
        type: "CNAME" as const,
        name: `tok._domainkey.${domain}`,
        value: "tok.dkim.amazonses.com",
        purpose: "dkim" as const,
      },
    ],
  });
  providers.setDomainAdapterForTests(() => ({
    provider: "ses",
    register: async (domain) => state(domain),
    status: async (domain) => state(domain),
    remove: async () => undefined,
  }));
});

afterEach(() => providers.setDomainAdapterForTests(null));

describe("provisioning: team sending domain", () => {
  it("sets, reads and removes a provisioned team's own domain", async () => {
    const { organization, team } = await seedTeamAndContact(tdb, {
      team: { externalId: "courselit:school-a" },
    });
    const [esp] = await tdb
      .insert(schema.espConfigs)
      .values({
        ownerScope: "organization",
        organizationId: organization.id,
        name: "District SES",
        provider: "ses",
        host: "email-smtp.eu-west-1.amazonaws.com",
        fromEmail: "news@district.example.org",
        status: "active",
        encryptedManagementSecret: providers.encryptManagementCredentials({
          accessKeyId: "AKIA-TEST",
          secretAccessKey: "secret",
        }),
      })
      .returning();
    await tdb.insert(schema.espConfigTeamGrants).values({
      organizationId: organization.id,
      espConfigId: esp.id,
      teamId: team.id,
      createdByType: "organization_key",
    });
    authState.organizationId = organization.id;
    const path = `/provisioning/teams/${team.teamId}/sending-domain`;

    authState.organizationScopes = ["teams:read"];
    expect(
      (await send("PUT", path, { fromEmail: "office@school-a.example.org" })).status,
    ).toBe(403);
    expect((await send("GET", path)).json()).toBeNull();

    authState.organizationScopes = ["teams:read", "teams:manage"];
    const bad = await send("PUT", path, { fromEmail: "office@localhost" });
    expect(bad.status).toBe(400);
    const set = await send("PUT", path, { fromEmail: "office@school-a.example.org" });
    expect(set.status).toBe(200);
    expect(set.json()).toMatchObject({
      domain: "school-a.example.org",
      fromEmail: "office@school-a.example.org",
      status: "pending",
      inUse: false,
      records: [
        { type: "CNAME", name: "tok._domainkey.school-a.example.org", purpose: "dkim" },
        { type: "TXT", name: "_dmarc.school-a.example.org", purpose: "dmarc" },
      ],
    });
    expect((await send("GET", path)).json()).toMatchObject({ status: "pending" });

    expect((await send("DELETE", path)).status).toBe(204);
    expect((await send("GET", path)).json()).toBeNull();
    expect((await send("DELETE", path)).status).toBe(404);
  });
});
