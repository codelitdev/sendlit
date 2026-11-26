import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";

const dmarc = { published: false };
process.env.BILLING_DOMAIN_VERIFICATION_KEY ||= "test-domain-verification-key";

mock.module("../db/client", async () => {
  const { makeTestDb } = await import("../test/db");
  return { db: await makeTestDb() };
});
mock.module("../utils/dns", () => ({
  DNS_ATTEMPT_TIMEOUT_MS: 6_000,
  freshDnsLookups: () => ({
    resolveTxt: async (name: string) => {
      if (dmarc.published && name.startsWith("_dmarc.")) return [["v=DMARC1; p=none;"]];
      throw Object.assign(new Error("not found"), { code: "ENOTFOUND" });
    },
    resolveMx: async () => [],
    resolveCname: async () => [],
  }),
  resolveTxtWithTimeout: async () => [],
}));

const { db } = await import("../db/client");
const schema = await import("../db/schema");
const { eq } = await import("drizzle-orm");
const { seedTeamAndContact, truncateAll } = await import("../test/db");
const providers = await import("./domain-providers");
const domains = await import("./team-sending-domain");
const { resolveDeliverySource } = await import("./queries");
const orgDomains = await import("../billing/domains");
type TestDb = import("../test/db").TestDb;

const tdb = db as unknown as TestDb;
const HOUR = 60 * 60 * 1000;

/** The fake SES account: identities by domain. */
let identities: Map<
  string,
  { verified: boolean; dkim: "pending" | "verified" | "failed" }
>;
let removed: string[];

beforeEach(async () => {
  await truncateAll(tdb);
  identities = new Map();
  removed = [];
  dmarc.published = false;
  providers.setDomainAdapterForTests(() => ({
    provider: "ses",
    async register(domain) {
      if (!identities.has(domain))
        identities.set(domain, { verified: false, dkim: "pending" });
      return this.status(domain) as never;
    },
    async status(domain) {
      const identity = identities.get(domain);
      if (!identity) return null;
      return {
        ...identity,
        records: ["a", "b", "c"].map((token) => ({
          type: "CNAME" as const,
          name: `${token}._domainkey.${domain}`,
          value: `${token}.dkim.amazonses.com`,
          purpose: "dkim" as const,
        })),
      };
    },
    async remove(domain) {
      identities.delete(domain);
      removed.push(domain);
    },
  }));
});

afterEach(() => {
  providers.setDomainAdapterForTests(null);
});

async function setup() {
  const { organization, team } = await seedTeamAndContact(tdb);
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
  const [grant] = await tdb
    .insert(schema.espConfigTeamGrants)
    .values({
      organizationId: organization.id,
      espConfigId: esp.id,
      teamId: team.id,
      createdByType: "user",
    })
    .returning();
  return { organization, team, esp, grant };
}

const actor = { type: "system" as const };

async function fromFor(teamId: string, purpose: "marketing" | "transactional") {
  return (await resolveDeliverySource(teamId, { type: "organization" }, purpose))
    .fromEmail;
}

async function domainRow(teamId: string) {
  const [row] = await tdb
    .select()
    .from(schema.sendingDomains)
    .where(eq(schema.sendingDomains.teamId, teamId));
  return row;
}

describe("team sending domains", () => {
  it("registers the domain and switches the From address once DKIM and DMARC pass", async () => {
    const ctx = await setup();

    const view = await domains.setTeamSendingDomain(
      ctx.organization.id,
      ctx.team.id,
      { fromEmail: "Office@School-A.example.org" },
      actor,
    );

    expect(view).toMatchObject({
      domain: "school-a.example.org",
      fromEmail: "office@school-a.example.org",
      status: "pending",
      dkim: "pending",
      dmarc: "missing",
      inUse: false,
    });
    expect(view.records.map((record) => `${record.type} ${record.name}`)).toEqual([
      "CNAME a._domainkey.school-a.example.org",
      "CNAME b._domainkey.school-a.example.org",
      "CNAME c._domainkey.school-a.example.org",
      "TXT _dmarc.school-a.example.org",
    ]);
    // Not verified yet: still the shared domain.
    expect(await fromFor(ctx.team.id, "marketing")).toBe("news@district.example.org");

    identities.set("school-a.example.org", { verified: true, dkim: "verified" });
    expect((await domains.refreshTeamSendingDomain(ctx.team.id))?.status).toBe(
      "pending",
    );
    dmarc.published = true;
    const verified = await domains.refreshTeamSendingDomain(ctx.team.id);

    expect(verified).toMatchObject({ status: "verified", inUse: true, dmarc: "pass" });
    expect(await fromFor(ctx.team.id, "marketing")).toBe("office@school-a.example.org");
    expect(await fromFor(ctx.team.id, "transactional")).toBe(
      "office@school-a.example.org",
    );
  });

  it("keeps the team's domain through a grace period, then pauses marketing", async () => {
    const ctx = await setup();
    identities.set("school-a.example.org", { verified: true, dkim: "verified" });
    dmarc.published = true;
    await domains.setTeamSendingDomain(
      ctx.organization.id,
      ctx.team.id,
      { fromEmail: "office@school-a.example.org" },
      actor,
    );

    dmarc.published = false;
    const failing = await domains.refreshTeamSendingDomain(ctx.team.id);
    expect(failing).toMatchObject({ status: "failing", inUse: true });
    expect(failing?.graceEndsAt).not.toBeNull();
    // Within the grace period it still sends from its own domain.
    expect(await fromFor(ctx.team.id, "marketing")).toBe("office@school-a.example.org");

    await tdb
      .update(schema.sendingDomains)
      .set({ authFailingSince: new Date(Date.now() - 73 * HOUR) })
      .where(eq(schema.sendingDomains.teamId, ctx.team.id));

    // Never quietly back to the shared domain: marketing pauses instead.
    await expect(fromFor(ctx.team.id, "marketing")).rejects.toMatchObject({
      code: "sending_paused",
      details: expect.objectContaining({ reason: "team_sending_domain_failing" }),
    });
    expect(await fromFor(ctx.team.id, "transactional")).toBe(
      "office@school-a.example.org",
    );

    dmarc.published = true;
    expect((await domains.refreshTeamSendingDomain(ctx.team.id))?.status).toBe(
      "verified",
    );
    expect(await fromFor(ctx.team.id, "marketing")).toBe("office@school-a.example.org");
  });

  it("applies the organization's policy to teams still on the shared domain", async () => {
    const ctx = await setup();
    const policy = (
      values: Partial<typeof schema.organizationDeliveryPolicies.$inferInsert>,
    ) =>
      tdb
        .update(schema.organizationDeliveryPolicies)
        .set(values)
        .where(
          eq(schema.organizationDeliveryPolicies.organizationId, ctx.organization.id),
        );

    await policy({ requireTeamSendingDomain: "marketing" });
    await expect(fromFor(ctx.team.id, "marketing")).rejects.toMatchObject({
      code: "domain_verification_required",
    });
    expect(await fromFor(ctx.team.id, "transactional")).toBe(
      "news@district.example.org",
    );

    await policy({ requireTeamSendingDomain: "all" });
    await expect(fromFor(ctx.team.id, "transactional")).rejects.toMatchObject({
      code: "domain_verification_required",
    });

    await policy({ requireTeamSendingDomain: "off", sharedDomainMonthlyLimit: 10 });
    const month = new Date(
      Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1),
    );
    await tdb.insert(schema.organizationEspUsageBuckets).values({
      bucketScope: "grant",
      organizationId: ctx.organization.id,
      grantId: ctx.grant.id,
      periodType: "month",
      periodStart: month,
      acceptedCount: 10,
    });
    await expect(fromFor(ctx.team.id, "marketing")).rejects.toMatchObject({
      code: "plan_limit_reached",
      details: expect.objectContaining({ capability: "shared_domain_monthly_limit" }),
    });
    expect(await fromFor(ctx.team.id, "transactional")).toBe(
      "news@district.example.org",
    );
  });

  it("refuses a domain another team uses and removes a domain from the ESP", async () => {
    const ctx = await setup();
    const [other] = await tdb
      .insert(schema.teams)
      .values({ name: "School B", organizationId: ctx.organization.id })
      .returning();
    await tdb.insert(schema.espConfigTeamGrants).values({
      organizationId: ctx.organization.id,
      espConfigId: ctx.esp.id,
      teamId: other.id,
      createdByType: "user",
    });
    await domains.setTeamSendingDomain(
      ctx.organization.id,
      ctx.team.id,
      { fromEmail: "office@school-a.example.org" },
      actor,
    );

    await expect(
      domains.setTeamSendingDomain(
        ctx.organization.id,
        other.id,
        { fromEmail: "hello@school-a.example.org" },
        actor,
      ),
    ).rejects.toThrow("domain_in_use");

    expect(
      await domains.removeTeamSendingDomain(ctx.organization.id, ctx.team.id, actor),
    ).toBe(true);
    expect(removed).toEqual(["school-a.example.org"]);
    expect((await domainRow(ctx.team.id)).status).toBe("revoked");
    const [grant] = await tdb
      .select()
      .from(schema.espConfigTeamGrants)
      .where(eq(schema.espConfigTeamGrants.id, ctx.grant.id));
    expect(grant).toMatchObject({ fromEmail: null, sendingDomainId: null });
    expect(await domains.getTeamSendingDomain(ctx.team.id)).toBeNull();

    // The other team can now use it, reusing the revoked row.
    const view = await domains.setTeamSendingDomain(
      ctx.organization.id,
      other.id,
      { fromEmail: "hello@school-a.example.org" },
      actor,
    );
    expect(view.domain).toBe("school-a.example.org");
  });

  it("keeps team domains out of the organization's own domain list, verify and revoke", async () => {
    const ctx = await setup();
    const own = await orgDomains.createSendingDomain(
      ctx.organization.id,
      "district.example.org",
    );
    await domains.setTeamSendingDomain(
      ctx.organization.id,
      ctx.team.id,
      { fromEmail: "office@school-a.example.org" },
      actor,
    );
    const team = await domainRow(ctx.team.id);

    expect(
      (await orgDomains.listSendingDomains(ctx.organization.id)).map(
        (row) => row.domain,
      ),
    ).toEqual(["district.example.org"]);
    expect(
      await orgDomains.verifySendingDomain(ctx.organization.id, team.domainId),
    ).toBeNull();
    expect(
      await orgDomains.revokeSendingDomain(ctx.organization.id, team.domainId),
    ).toBe(false);
    expect((await domainRow(ctx.team.id)).status).toBe("pending");
    // The organization's own domain is unaffected.
    expect(
      await orgDomains.revokeSendingDomain(ctx.organization.id, own.row.domainId),
    ).toBe(true);
  });

  it("needs a management credential on a supported provider", async () => {
    const ctx = await setup();
    await tdb
      .update(schema.espConfigs)
      .set({ encryptedManagementSecret: null })
      .where(eq(schema.espConfigs.id, ctx.esp.id));
    await expect(
      domains.setTeamSendingDomain(
        ctx.organization.id,
        ctx.team.id,
        { fromEmail: "office@school-a.example.org" },
        actor,
      ),
    ).rejects.toThrow("esp_management_credentials_required");

    const saved = await domains.setEspManagementCredentials(
      ctx.organization.id,
      ctx.esp.espId,
      { accessKeyId: "AKIA-NEW", secretAccessKey: "secret" },
      actor,
    );
    expect(saved.encryptedManagementSecret).toBeTruthy();
    expect(saved.encryptedManagementSecret).not.toContain("AKIA-NEW");

    providers.setDomainAdapterForTests(() => ({
      provider: "ses",
      register: async () => {
        throw new Error("unused");
      },
      status: async () => {
        throw new Error("The security token included in the request is invalid.");
      },
      remove: async () => undefined,
    }));
    await expect(
      domains.setEspManagementCredentials(
        ctx.organization.id,
        ctx.esp.espId,
        { accessKeyId: "AKIA-BAD", secretAccessKey: "wrong" },
        actor,
      ),
    ).rejects.toThrow("esp_management_credentials_invalid");

    await tdb
      .update(schema.espConfigs)
      .set({ provider: "smtp" })
      .where(eq(schema.espConfigs.id, ctx.esp.id));
    await expect(
      domains.setTeamSendingDomain(
        ctx.organization.id,
        ctx.team.id,
        { fromEmail: "office@school-a.example.org" },
        actor,
      ),
    ).rejects.toThrow("provider_domain_unsupported");
  });
});
