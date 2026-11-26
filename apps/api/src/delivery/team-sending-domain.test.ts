import { beforeEach, describe, expect, it, mock } from "bun:test";

const dmarc = { published: false };

/** The fake SES account: identities by domain, and every call made. */
let identities: Map<
  string,
  { verified: boolean; dkim: "pending" | "verified" | "failed" }
>;
let calls: string[];
let sesFails = false;
const sdk = await import("@aws-sdk/client-sesv2");
const SES_DKIM = { pending: "PENDING", verified: "SUCCESS", failed: "FAILED" };
mock.module("@aws-sdk/client-sesv2", () => ({
  ...sdk,
  SESv2Client: class {
    async send(command: { input: { EmailIdentity: string } }) {
      const domain = command.input.EmailIdentity;
      calls.push(`${command.constructor.name} ${domain}`);
      if (sesFails)
        throw new Error("The security token included in the request is invalid.");
      const meta = { $metadata: {} };
      if (command instanceof sdk.CreateEmailIdentityCommand) {
        if (identities.has(domain)) {
          throw new sdk.AlreadyExistsException({ message: "exists", ...meta });
        }
        identities.set(domain, { verified: false, dkim: "pending" });
      }
      if (command instanceof sdk.DeleteEmailIdentityCommand) {
        identities.delete(domain);
        return {};
      }
      const identity = identities.get(domain);
      if (!identity) throw new sdk.NotFoundException({ message: "missing", ...meta });
      return {
        VerifiedForSendingStatus: identity.verified,
        DkimAttributes: { Status: SES_DKIM[identity.dkim], Tokens: ["a", "b", "c"] },
      };
    }
  },
}));
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

beforeEach(async () => {
  await truncateAll(tdb);
  identities = new Map();
  calls = [];
  sesFails = false;
  dmarc.published = false;
});

const removed = () =>
  calls.filter((call) => call.startsWith("DeleteEmailIdentityCommand"));
const registered = () =>
  calls.filter((call) => call.startsWith("CreateEmailIdentityCommand"));

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

async function ledger(
  ctx: Awaited<ReturnType<typeof setup>>,
  sourceType: "campaign" | "transactional",
  count: number,
  deliveryStatus = "delivered",
) {
  await tdb.insert(schema.outboundMessages).values(
    Array.from({ length: count }, (_, i) => ({
      teamId: ctx.team.id,
      deliverySourceType: "organization",
      espConfigId: ctx.esp.id,
      espGrantId: ctx.grant.id,
      sourceType,
      recipientEmail: `r${i}-${crypto.randomUUID()}@example.com`,
      normalizedRecipient: `r${i}@example.com`,
      provider: "ses",
      deliveryStatus,
    })) as any,
  );
}

/** Re-checks now, past the window in which reads reuse the last check. */
async function recheck(teamId: string) {
  await tdb
    .update(schema.sendingDomains)
    .set({ lastCheckedAt: null })
    .where(eq(schema.sendingDomains.teamId, teamId));
  return domains.refreshTeamSendingDomain(teamId);
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
    expect((await recheck(ctx.team.id))?.status).toBe("pending");
    dmarc.published = true;
    const verified = await recheck(ctx.team.id);

    expect(verified).toMatchObject({ status: "verified", inUse: true, dmarc: "pass" });
    expect(await fromFor(ctx.team.id, "marketing")).toBe("office@school-a.example.org");
    expect(await fromFor(ctx.team.id, "transactional")).toBe(
      "office@school-a.example.org",
    );
  });

  it("keeps the team's domain through a grace period, then pauses marketing", async () => {
    const ctx = await setup();
    await domains.setTeamSendingDomain(
      ctx.organization.id,
      ctx.team.id,
      { fromEmail: "office@school-a.example.org" },
      actor,
    );
    identities.set("school-a.example.org", { verified: true, dkim: "verified" });
    dmarc.published = true;
    await recheck(ctx.team.id);

    dmarc.published = false;
    const failing = await recheck(ctx.team.id);
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
    expect((await recheck(ctx.team.id))?.status).toBe("verified");
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
    // Transactional email doesn't count towards the shared-domain cap.
    await ledger(ctx, "transactional", 50);
    await ledger(ctx, "campaign", 9);
    expect(await fromFor(ctx.team.id, "marketing")).toBe("news@district.example.org");
    // Queued sends count, so a broadcast can't overshoot it.
    await ledger(ctx, "campaign", 1, "queued");
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
    expect(removed()).toEqual(["DeleteEmailIdentityCommand school-a.example.org"]);
    expect((await domainRow(ctx.team.id)).status).toBe("revoked");
    const [grant] = await tdb
      .select()
      .from(schema.espConfigTeamGrants)
      .where(eq(schema.espConfigTeamGrants.id, ctx.grant.id));
    expect(grant).toMatchObject({ fromEmail: null, sendingDomainId: null });
    expect(await domains.refreshTeamSendingDomain(ctx.team.id)).toBeNull();

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

    sesFails = true;
    await expect(
      domains.setEspManagementCredentials(
        ctx.organization.id,
        ctx.esp.espId,
        { accessKeyId: "AKIA-BAD", secretAccessKey: "wrong" },
        actor,
      ),
    ).rejects.toThrow("esp_management_credentials_invalid");
    sesFails = false;

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

  it("never takes over a domain SendLit didn't register, nor the shared mailbox's own", async () => {
    const ctx = await setup();
    const set = (fromEmail: string) =>
      domains.setTeamSendingDomain(
        ctx.organization.id,
        ctx.team.id,
        { fromEmail },
        actor,
      );
    // Verified in the AWS account by someone else.
    identities.set("school-a.example.org", { verified: true, dkim: "verified" });

    await expect(set("office@school-a.example.org")).rejects.toThrow(
      "domain_exists_at_provider",
    );
    await expect(set("office@District.example.org")).rejects.toThrow("domain_in_use");
    expect(registered()).toEqual(["CreateEmailIdentityCommand school-a.example.org"]);
    expect(removed()).toEqual([]);
    expect(identities.has("school-a.example.org")).toBe(true);
    expect(await domainRow(ctx.team.id)).toBeUndefined();
  });

  it("re-setting the same domain only refreshes it, without registering again", async () => {
    const ctx = await setup();
    const set = (fromEmail: string) =>
      domains.setTeamSendingDomain(
        ctx.organization.id,
        ctx.team.id,
        { fromEmail },
        actor,
      );
    await set("office@school-a.example.org");

    const view = await set("hello@school-a.example.org");
    expect(view).toMatchObject({
      domain: "school-a.example.org",
      fromEmail: "hello@school-a.example.org",
    });
    expect(registered()).toHaveLength(1);
    expect(removed()).toEqual([]);
  });

  it("switches domains by registering the new one before removing the old one", async () => {
    const ctx = await setup();
    const set = (fromEmail: string) =>
      domains.setTeamSendingDomain(
        ctx.organization.id,
        ctx.team.id,
        { fromEmail },
        actor,
      );
    await set("office@school-a.example.org");
    identities.set("school-b.example.org", { verified: true, dkim: "verified" });

    // The new domain fails at the provider: the old one stays, untouched.
    await expect(set("office@school-b.example.org")).rejects.toThrow(
      "domain_exists_at_provider",
    );
    expect(removed()).toEqual([]);
    expect(identities.has("school-a.example.org")).toBe(true);
    expect((await domainRow(ctx.team.id)).domain).toBe("school-a.example.org");

    calls = [];
    const view = await set("office@school-c.example.org");
    expect(view.domain).toBe("school-c.example.org");
    expect(
      calls.indexOf("CreateEmailIdentityCommand school-c.example.org"),
    ).toBeLessThan(calls.indexOf("DeleteEmailIdentityCommand school-a.example.org"));
    expect(identities.has("school-a.example.org")).toBe(false);
  });

  it("checks each due domain once across concurrent sweeps", async () => {
    const ctx = await setup();
    await domains.setTeamSendingDomain(
      ctx.organization.id,
      ctx.team.id,
      { fromEmail: "office@school-a.example.org" },
      actor,
    );
    await tdb
      .update(schema.sendingDomains)
      .set({ nextCheckAt: new Date(Date.now() - HOUR) })
      .where(eq(schema.sendingDomains.teamId, ctx.team.id));
    calls = [];

    await Promise.all([
      domains.checkDueTeamSendingDomains(),
      domains.checkDueTeamSendingDomains(),
    ]);
    expect(calls).toEqual(["GetEmailIdentityCommand school-a.example.org"]);
  });

  it("shows no From address when the grant no longer points at the domain", async () => {
    const ctx = await setup();
    await domains.setTeamSendingDomain(
      ctx.organization.id,
      ctx.team.id,
      { fromEmail: "office@school-a.example.org" },
      actor,
    );
    await tdb
      .update(schema.espConfigTeamGrants)
      .set({ sendingDomainId: null })
      .where(eq(schema.espConfigTeamGrants.id, ctx.grant.id));

    expect((await domains.refreshTeamSendingDomain(ctx.team.id))?.fromEmail).toBeNull();
  });

  it("removes the team's domain when its grant is cancelled or the mailbox retired", async () => {
    const ctx = await setup();
    const { transitionEspGrant } = await import("./queries");
    await domains.setTeamSendingDomain(
      ctx.organization.id,
      ctx.team.id,
      { fromEmail: "office@school-a.example.org" },
      actor,
    );
    await transitionEspGrant(ctx.organization.id, ctx.team.id, "cancel");
    expect((await domainRow(ctx.team.id)).status).toBe("revoked");
    expect(removed()).toEqual(["DeleteEmailIdentityCommand school-a.example.org"]);

    // Retiring the mailbox removes its other teams' domains and its API key.
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
      other.id,
      { fromEmail: "office@school-b.example.org" },
      actor,
    );
    const { transitionEspConfig } = await import("../settings/esp/queries");
    const retired = await transitionEspConfig(ctx.esp, "retire", { cancel: true });
    expect((await domainRow(other.id)).status).toBe("revoked");
    expect(removed()).toContain("DeleteEmailIdentityCommand school-b.example.org");
    expect(retired.encryptedManagementSecret).toBeNull();
  });

  it("registers the domain again when the team was moved to another mailbox", async () => {
    const ctx = await setup();
    await domains.setTeamSendingDomain(
      ctx.organization.id,
      ctx.team.id,
      { fromEmail: "office@school-a.example.org" },
      actor,
    );
    const [esp2] = await tdb
      .insert(schema.espConfigs)
      .values({
        ...ctx.esp,
        id: undefined,
        espId: undefined,
        name: "Second SES",
      } as any)
      .returning();
    await tdb
      .update(schema.espConfigTeamGrants)
      .set({ espConfigId: esp2.id })
      .where(eq(schema.espConfigTeamGrants.id, ctx.grant.id));
    // A stale row on the old mailbox is never used to send.
    expect(await fromFor(ctx.team.id, "transactional")).toBe(
      "news@district.example.org",
    );

    identities.delete("school-a.example.org"); // the second SES account
    await domains.setTeamSendingDomain(
      ctx.organization.id,
      ctx.team.id,
      { fromEmail: "office@school-a.example.org" },
      actor,
    );
    expect(registered()).toHaveLength(2);
    expect((await domainRow(ctx.team.id)).espConfigId).toBe(esp2.id);
  });

  it("keeps the API key while team domains need it", async () => {
    const ctx = await setup();
    await domains.setTeamSendingDomain(
      ctx.organization.id,
      ctx.team.id,
      { fromEmail: "office@school-a.example.org" },
      actor,
    );
    await expect(
      domains.removeEspManagementCredentials(ctx.organization.id, ctx.esp.espId, actor),
    ).rejects.toThrow("esp_management_credentials_in_use");
    await domains.removeTeamSendingDomain(ctx.organization.id, ctx.team.id, actor);
    const saved = await domains.removeEspManagementCredentials(
      ctx.organization.id,
      ctx.esp.espId,
      actor,
    );
    expect(saved.encryptedManagementSecret).toBeNull();
  });

  it("reuses a recent check instead of calling the provider on every read", async () => {
    const ctx = await setup();
    await domains.setTeamSendingDomain(
      ctx.organization.id,
      ctx.team.id,
      { fromEmail: "office@school-a.example.org" },
      actor,
    );
    const before = calls.length;
    await domains.refreshTeamSendingDomain(ctx.team.id);
    expect(calls.length).toBe(before);
    await tdb
      .update(schema.sendingDomains)
      .set({ lastCheckedAt: new Date(Date.now() - 60_000) })
      .where(eq(schema.sendingDomains.teamId, ctx.team.id));
    await domains.refreshTeamSendingDomain(ctx.team.id);
    expect(calls.length).toBe(before + 1);
  });

  it("lets the organization add a domain a team used before, not one it uses", async () => {
    const ctx = await setup();
    await domains.setTeamSendingDomain(
      ctx.organization.id,
      ctx.team.id,
      { fromEmail: "office@school-a.example.org" },
      actor,
    );
    await expect(
      orgDomains.createSendingDomain(ctx.organization.id, "school-a.example.org"),
    ).rejects.toThrow("domain_in_use");
    await domains.removeTeamSendingDomain(ctx.organization.id, ctx.team.id, actor);
    const { row } = await orgDomains.createSendingDomain(
      ctx.organization.id,
      "school-a.example.org",
    );
    expect(row).toMatchObject({ teamId: null, status: "pending", espConfigId: null });
    expect(
      (await orgDomains.listSendingDomains(ctx.organization.id)).map((r) => r.domain),
    ).toEqual(["school-a.example.org"]);
  });

  it("maps provider errors to 422 and an identity SendLit didn't create to 409", () => {
    expect(
      domains.teamDomainErrorHttp(
        Object.assign(new Error("throttled"), { $metadata: { httpStatusCode: 429 } }),
      ),
    ).toEqual({ status: 422, body: { error: "esp_provider_error" } });
    expect(domains.teamDomainErrorHttp(new Error("domain_exists_at_provider"))).toEqual(
      {
        status: 409,
        body: { error: "domain_exists_at_provider" },
      },
    );
    expect(domains.teamDomainErrorHttp(new Error("boom"))).toBeNull();
  });
});
