import { beforeEach, describe, expect, it, mock } from "bun:test";
import { eq, inArray } from "drizzle-orm";

mock.module("../../db/client", async () => {
  const { makeTestDb } = await import("../../test/db");
  return { db: await makeTestDb() };
});

const { db } = await import("../../db/client");
const {
  espConfigs,
  outboundMessages,
  sequences,
  teamDeliverySettings,
  transactionalEmails,
} = await import("../../db/schema");
const { seedTeamAndContact, truncateAll } = await import("../../test/db");
type TestDb = import("../../test/db").TestDb;
const { seedSequence } = await import("../../test/fixtures");
const {
  createEspConfig,
  createOrganizationEspConfig,
  deleteEspConfig,
  deleteOrganizationEspConfig,
  getDecryptedEspCredentials,
  getEspConfigByEspId,
  listEspConfigs,
  recordEspTestResult,
  transitionEspConfig,
  upsertEspConfig,
  checkAndRememberDomainAuthentication,
} = await import("./queries");

const tdb = db as unknown as TestDb;

beforeEach(async () => {
  await truncateAll(tdb);
});

describe("ESP config queries", () => {
  it("stores multiple team-owned configurations", async () => {
    const { team } = await seedTeamAndContact(tdb);
    const second = await createEspConfig(team.id, {
      name: "Transactional",
      provider: "smtp",
      host: "transactional.example.com",
      port: 587,
      secure: false,
    });

    const configs = await listEspConfigs(team.id);
    expect(configs).toHaveLength(2);
    expect(second.espId).toMatch(/^esp_/);
    expect(configs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          espId: second.espId,
          ownerScope: "team",
        }),
      ]),
    );
  });

  it("encrypts, preserves, and clears SMTP passwords", async () => {
    const { team } = await seedTeamAndContact(tdb);
    const initial = await upsertEspConfig(team.id, {
      provider: "smtp",
      host: "smtp.example.com",
      port: 587,
      secure: false,
      username: "user",
      password: "first-secret",
      fromName: "Sender",
      fromEmail: "sender@example.com",
    });
    expect(initial.encryptedSecret).not.toContain("first-secret");
    await expect(getDecryptedEspCredentials(team.id)).resolves.toMatchObject({
      password: "first-secret",
      username: "user",
    });

    await upsertEspConfig(team.id, {
      provider: "smtp",
      host: "smtp2.example.com",
      port: 465,
      secure: true,
      password: "",
    });
    await expect(getDecryptedEspCredentials(team.id)).resolves.toMatchObject({
      password: undefined,
      host: "smtp2.example.com",
    });
  });

  it("records a test result and deletes an unused draft", async () => {
    const { team } = await seedTeamAndContact(tdb);
    const draft = await createEspConfig(team.id, {
      name: "Draft",
      provider: "smtp",
      host: "draft.example.com",
      port: 587,
      secure: false,
    });
    await recordEspTestResult(team.id, "failed", "Bad credentials", draft.espId);
    await expect(getEspConfigByEspId(team.id, draft.espId)).resolves.toMatchObject({
      lastTestStatus: "failed",
      lastTestError: "Bad credentials",
    });
    await expect(deleteEspConfig(team.id, draft.espId)).resolves.toBe(true);
    await expect(getEspConfigByEspId(team.id, draft.espId)).resolves.toBeNull();
  });

  it("refuses to delete the team's live default", async () => {
    const { team } = await seedTeamAndContact(tdb);
    const [active] = await listEspConfigs(team.id);

    await expect(deleteEspConfig(team.id, active.espId)).rejects.toThrow(
      "esp_is_default",
    );
    await expect(getEspConfigByEspId(team.id, active.espId)).resolves.not.toBeNull();
  });

  it("deletes a retired default and moves the default to another active ESP", async () => {
    const { team } = await seedTeamAndContact(tdb);
    const [retired] = await listEspConfigs(team.id);
    await tdb
      .update(espConfigs)
      .set({ status: "retired", retiredAt: new Date() })
      .where(eq(espConfigs.id, retired.id));
    const backup = await createEspConfig(team.id, {
      name: "Backup",
      provider: "smtp",
      host: "backup.example.com",
      port: 587,
      secure: false,
    });
    await tdb
      .update(espConfigs)
      .set({ status: "active" })
      .where(eq(espConfigs.id, backup.id));

    await expect(deleteEspConfig(team.id, retired.espId)).resolves.toBe(true);

    const [delivery] = await tdb
      .select()
      .from(teamDeliverySettings)
      .where(eq(teamDeliverySettings.teamId, team.id));
    expect(delivery).toMatchObject({
      defaultSource: "team",
      defaultTeamEspConfigId: backup.id,
    });
  });

  it("keeps an ESP with transactional history and asks for retirement", async () => {
    const { team } = await seedTeamAndContact(tdb);
    const esp = await createEspConfig(team.id, {
      name: "Transactional",
      provider: "smtp",
      host: "tx.example.com",
      port: 587,
      secure: false,
    });
    await tdb.insert(transactionalEmails).values({
      teamId: team.id,
      deliverySourceType: "team",
      outboxId: esp.id,
      toEmail: "recipient@example.com",
      subject: "Receipt",
      status: "sent",
    });

    await expect(deleteEspConfig(team.id, esp.espId)).rejects.toThrow(
      "esp_has_delivery_history",
    );
    await expect(getEspConfigByEspId(team.id, esp.espId)).resolves.not.toBeNull();
  });

  it("blocks a delete while transactional email is queued on the ESP", async () => {
    const { team } = await seedTeamAndContact(tdb);
    const esp = await createEspConfig(team.id, {
      name: "Queued",
      provider: "smtp",
      host: "queued.example.com",
      port: 587,
      secure: false,
    });
    await tdb.insert(transactionalEmails).values({
      teamId: team.id,
      deliverySourceType: "team",
      outboxId: esp.id,
      toEmail: "recipient@example.com",
      subject: "Receipt",
      status: "queued",
    });

    await expect(deleteEspConfig(team.id, esp.espId)).rejects.toThrow(
      "delivery_source_in_use",
    );
  });

  it("deletes a never-activated organization draft but not an activated one", async () => {
    const { organization } = await seedTeamAndContact(tdb);
    const draft = await createOrganizationEspConfig(organization.id, {
      name: "Draft",
      provider: "smtp",
      host: "org-draft.example.com",
      port: 587,
      secure: false,
    });
    const retired = await createOrganizationEspConfig(organization.id, {
      name: "Retired",
      provider: "smtp",
      host: "org-retired.example.com",
      port: 587,
      secure: false,
    });
    await tdb
      .update(espConfigs)
      .set({ status: "retired", activatedAt: new Date(), retiredAt: new Date() })
      .where(eq(espConfigs.id, retired.id));

    await expect(
      deleteOrganizationEspConfig(organization.id, draft.espId),
    ).resolves.toBe(true);
    await expect(
      deleteOrganizationEspConfig(organization.id, retired.espId),
    ).rejects.toThrow("esp_retire_instead");
  });

  it("retires a once-active draft but not a never-activated one", async () => {
    const { team } = await seedTeamAndContact(tdb);
    const fresh = await createEspConfig(team.id, {
      name: "Fresh",
      provider: "smtp",
      host: "fresh.example.com",
      port: 587,
      secure: false,
    });
    await expect(
      transitionEspConfig(fresh, "retire", { cancel: true }),
    ).rejects.toThrow("invalid_lifecycle_transition");
    const [edited] = await tdb
      .update(espConfigs)
      .set({ activatedAt: new Date() })
      .where(eq(espConfigs.id, fresh.id))
      .returning();
    await expect(
      transitionEspConfig(edited, "retire", { cancel: true }),
    ).resolves.toMatchObject({ status: "retired" });
  });

  it("deletes an ESP pinned only to draft, paused, or completed sequences", async () => {
    const { team } = await seedTeamAndContact(tdb);
    const [active] = await listEspConfigs(team.id);
    await tdb
      .update(teamDeliverySettings)
      .set({ defaultSource: null, defaultTeamEspConfigId: null })
      .where(eq(teamDeliverySettings.teamId, team.id));
    const draft = await seedSequence(tdb, {
      teamId: team.id,
      status: "draft",
      outboxId: active.id,
      emails: [{ emailId: "email_draft" }],
    });
    const paused = await seedSequence(tdb, {
      teamId: team.id,
      status: "paused",
      outboxId: active.id,
      emails: [{ emailId: "email_paused" }],
    });
    const completed = await seedSequence(tdb, {
      teamId: team.id,
      type: "broadcast",
      status: "completed",
      outboxId: active.id,
      emails: [{ emailId: "email_completed" }],
    });
    const [terminalOutbound] = await tdb
      .insert(outboundMessages)
      .values({
        teamId: team.id,
        deliverySourceType: "team",
        espConfigId: active.id,
        espGrantId: null,
        sourceType: "campaign",
        recipientEmail: "recipient@example.com",
        normalizedRecipient: "recipient@example.com",
        provider: "smtp",
        rfcMessageId: "<completed@example.com>",
        deliveryStatus: "accepted",
      })
      .returning();

    await expect(deleteEspConfig(team.id, active.espId)).resolves.toBe(true);

    const detached = await tdb
      .select({
        status: sequences.status,
        deliverySourceIntent: sequences.deliverySourceIntent,
        deliverySourceType: sequences.deliverySourceType,
        outboxId: sequences.outboxId,
        espGrantId: sequences.espGrantId,
        report: sequences.report,
      })
      .from(sequences)
      .where(
        inArray(sequences.id, [
          draft.sequenceRow.id,
          paused.sequenceRow.id,
          completed.sequenceRow.id,
        ]),
      );
    expect(detached).toHaveLength(3);
    expect(detached).toEqual(
      expect.arrayContaining([
        ...["draft", "paused", "completed"].map((status) =>
          expect.objectContaining({
            status,
            deliverySourceIntent: null,
            deliverySourceType: null,
            outboxId: null,
            espGrantId: null,
            report: expect.objectContaining({
              deliverySourceDeleted: true,
            }),
          }),
        ),
      ]),
    );
    const [historicalOutbound] = await tdb
      .select({
        espConfigId: outboundMessages.espConfigId,
        espGrantId: outboundMessages.espGrantId,
        provider: outboundMessages.provider,
        deliveryStatus: outboundMessages.deliveryStatus,
      })
      .from(outboundMessages)
      .where(eq(outboundMessages.id, terminalOutbound.id));
    expect(historicalOutbound).toEqual({
      espConfigId: null,
      espGrantId: null,
      provider: "smtp",
      deliveryStatus: "accepted",
    });
  });

  it("scopes ESP lookups and deletes to the owning team", async () => {
    const { team: teamA } = await seedTeamAndContact(tdb);
    const { team: teamB } = await seedTeamAndContact(tdb);
    const [espA] = await listEspConfigs(teamA.id);

    await expect(getEspConfigByEspId(teamB.id, espA.espId)).resolves.toBeNull();
    await expect(deleteEspConfig(teamB.id, espA.espId)).resolves.toBe(false);
  });
});

describe("checkAndRememberDomainAuthentication", () => {
  const token = "6p3ranxrt5vvjzleljadgpakhkvklt2d";
  // SES: the token's key is empty (rotation) but its CNAME is right.
  const lookups = {
    resolveTxt: async (): Promise<string[][]> => {
      throw Object.assign(new Error("ENOTFOUND"), { code: "ENOTFOUND" });
    },
    resolveMx: async () => [],
    resolveCname: async (name: string) =>
      name === `${token}._domainkey.example.com` ? [`${token}.dkim.amazonses.com`] : [],
  };

  it("saves a token that passes and uses it when the next check omits it", async () => {
    const { team } = await seedTeamAndContact(tdb, {
      espConfig: {
        provider: "ses",
        host: "email-smtp.eu-west-1.amazonaws.com",
        fromEmail: "news@example.com",
      },
    });
    const [esp] = await tdb
      .select()
      .from(espConfigs)
      .where(eq(espConfigs.teamId, team.id));

    const first = await checkAndRememberDomainAuthentication(esp, token, lookups);
    expect(first?.dkim).toMatchObject({ status: "pass", selector: token });
    const [saved] = await tdb
      .select()
      .from(espConfigs)
      .where(eq(espConfigs.id, esp.id));
    expect(saved.dkimSelector).toBe(token);

    // A reload checks without a token and still passes.
    const again = await checkAndRememberDomainAuthentication(saved, undefined, lookups);
    expect(again?.dkim).toMatchObject({ status: "pass", selector: token });
  });

  it("doesn't save a selector that fails", async () => {
    const { team } = await seedTeamAndContact(tdb, {
      espConfig: { provider: "ses", fromEmail: "news@example.com" },
    });
    const [esp] = await tdb
      .select()
      .from(espConfigs)
      .where(eq(espConfigs.teamId, team.id));
    const result = await checkAndRememberDomainAuthentication(
      esp,
      "wrongtoken",
      lookups,
    );
    expect(result?.dkim.status).toBe("fail");
    const [saved] = await tdb
      .select()
      .from(espConfigs)
      .where(eq(espConfigs.id, esp.id));
    expect(saved.dkimSelector).toBeNull();
  });
});
