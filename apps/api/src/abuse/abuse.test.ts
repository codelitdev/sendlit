import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";
import { eq } from "drizzle-orm";

mock.module("../db/client", async () => {
  const { makeTestDb } = await import("../test/db.js");
  return { db: await makeTestDb() };
});
const captureEvent = mock();
const captureError = mock();
const realObservability = await import("../observability");
mock.module("../observability", () => ({
  ...realObservability,
  captureEvent,
  captureError,
}));

const { db } = await import("../db/client");
const schema = await import("../db/schema");
const { seedTeamAndContact, truncateAll } = await import("../test/db");
type TestDb = import("../test/db").TestDb;
const { seedSequence } = await import("../test/fixtures");
const { useCloudFakeBillingEnv, clearCloudFakeBillingEnv } = await import(
  "../test/billing"
);
const { heuristicScan, assertEmailContentAllowed } = await import("./content-scan");
const { assertSignupAllowed, recordSignup, SignupBlockedError } = await import(
  "./signup"
);
const { recordContactImport, assertNoImportUnderReview } = await import("./imports");
const { listAbuseFlags, resolveAbuseFlag } = await import("./flags");
const { pacingBudget } = await import("./pacing");
const { assertLargeBroadcastReviewed } = await import("./broadcast-review");
const { runAbuseCli } = await import("./operator-cli");
const { closeSharedRedis } = await import("../services/redis-client");
const { recordPacedSend } = await import("./telemetry");

const tdb = db as unknown as TestDb;

beforeEach(async () => {
  useCloudFakeBillingEnv();
  process.env.CONTENT_SCAN = "heuristic";
  captureEvent.mockClear();
  captureError.mockClear();
  await truncateAll(tdb);
});

/** PostHog events sent so far, as `[event, properties]`. */
const events = () =>
  captureEvent.mock.calls.map(([call]) => [call.event, call.properties]);

afterAll(async () => {
  clearCloudFakeBillingEnv();
  delete process.env.CONTENT_SCAN;
  await closeSharedRedis();
});

const textEmail = (text: string) => ({
  content: [{ blockType: "text", settings: { content: text } }],
});

describe("heuristicScan", () => {
  it("passes an ordinary newsletter", () => {
    expect(
      heuristicScan(
        "October update",
        textEmail("Read [our blog](https://example.com/blog)."),
      ),
    ).toEqual({ verdict: "clean", reasons: [] });
  });

  it("blocks link text that names one domain but points to another", () => {
    const result = heuristicScan(
      "Account notice",
      textEmail("Log in at [paypal.com](https://paypa1-secure.example/login)"),
    );
    expect(result.verdict).toBe("blocked");
  });

  it("blocks an impersonated credential lure and executables", () => {
    expect(
      heuristicScan(
        "Security alert",
        textEmail(
          "Your Apple account will be suspended. Verify your account: https://evil.example/x",
        ),
      ).verdict,
    ).toBe("blocked");
    expect(
      heuristicScan("Invoice", textEmail("Download https://files.example/invoice.exe"))
        .verdict,
    ).toBe("blocked");
  });

  it("holds shorteners, raw IPs and spam phrases for review", () => {
    expect(heuristicScan("Hi", textEmail("See https://bit.ly/abc")).verdict).toBe(
      "review",
    );
    expect(heuristicScan("Hi", textEmail("See http://203.0.113.9/x")).verdict).toBe(
      "review",
    );
    expect(
      heuristicScan("Win", textEmail("Guaranteed income from home!")).verdict,
    ).toBe("review");
  });
});

describe("content scan enforcement", () => {
  it("blocks harmful content, pauses the team, and lets an approved email through", async () => {
    const { team, account } = await seedTeamAndContact(tdb);
    const { emailRows } = await seedSequence(tdb, {
      teamId: team.id,
      type: "broadcast",
      status: "draft",
      emails: [{ emailId: "email_e1", subject: "Notice" }],
    });
    const email = emailRows[0];
    const phishing = textEmail("Sign in at [chase.com](https://chase-login.example/)");

    await expect(
      assertEmailContentAllowed({ teamId: team.id, email, content: phishing }),
    ).rejects.toThrow("content_blocked");
    const [control] = await tdb
      .select()
      .from(schema.teamSendingControls)
      .where(eq(schema.teamSendingControls.teamId, team.id));
    expect(control).toMatchObject({
      status: "all_paused",
      reasonCode: "content_review",
    });

    const [{ flag }] = await listAbuseFlags();
    expect(flag).toMatchObject({ kind: "content", severity: "high" });
    // Content stored on the email, so the stored verdict is used next time.
    await tdb
      .update(schema.sequenceEmails)
      .set({ content: phishing })
      .where(eq(schema.sequenceEmails.id, email.id));

    await resolveAbuseFlag({
      flagId: flag.flagId,
      resolution: "released",
      operatorUserId: account.id,
      note: "false positive",
    });
    const [reloaded] = await tdb
      .select()
      .from(schema.sequenceEmails)
      .where(eq(schema.sequenceEmails.id, email.id));
    expect(reloaded.contentScanVerdict).toBe("approved");
    await expect(
      assertEmailContentAllowed({ teamId: team.id, email: reloaded }),
    ).resolves.toBeUndefined();
    const [released] = await tdb
      .select()
      .from(schema.teamSendingControls)
      .where(eq(schema.teamSendingControls.teamId, team.id));
    expect(released.status).toBe("warned");
  });

  it("does nothing on self-hosted installs", async () => {
    clearCloudFakeBillingEnv();
    const { team } = await seedTeamAndContact(tdb);
    const { emailRows } = await seedSequence(tdb, {
      teamId: team.id,
      emails: [{ emailId: "email_e1" }],
    });
    await expect(
      assertEmailContentAllowed({
        teamId: team.id,
        email: emailRows[0],
        content: textEmail("[paypal.com](https://evil.example)"),
      }),
    ).resolves.toBeUndefined();
  });
});

describe("signup guards", () => {
  it("rejects disposable domains and, when configured, free providers", async () => {
    await expect(
      assertSignupAllowed({ email: "x@mailinator.com" }),
    ).rejects.toBeInstanceOf(SignupBlockedError);
    await expect(
      assertSignupAllowed({ email: "x@gmail.com" }),
    ).resolves.toBeUndefined();
    process.env.SIGNUP_FREE_EMAIL_POLICY = "block";
    await expect(assertSignupAllowed({ email: "x@gmail.com" })).rejects.toThrow(
      "free_email",
    );
    delete process.env.SIGNUP_FREE_EMAIL_POLICY;
    await expect(
      assertSignupAllowed({ email: "x@acme.example" }),
    ).resolves.toBeUndefined();
  });

  it("flags free-provider signups for review", async () => {
    const { account, organization } = await seedTeamAndContact(tdb);
    await recordSignup({
      userId: account.id,
      email: "maker@gmail.com",
      organizationId: organization.id,
    });
    const flags = await listAbuseFlags();
    expect(flags.map(({ flag }) => [flag.kind, flag.severity])).toEqual([
      ["signup", "low"],
    ]);
  });

  it("allows three signups per IP per day", async () => {
    const { sharedRedis } = await import("../services/redis-client");
    const reachable = await sharedRedis()
      .ping()
      .then(
        () => true,
        () => false,
      );
    if (!reachable) return; // Needs Redis (CI runs one).
    const ip = `test-${crypto.randomUUID()}`;
    for (let i = 0; i < 3; i++) {
      await assertSignupAllowed({ email: `p${i}@acme.example`, ip });
      await recordSignup({
        userId: `u${i}`,
        email: `p${i}@acme.example`,
        organizationId: null,
        ip,
      });
    }
    await expect(assertSignupAllowed({ email: "p4@acme.example", ip })).rejects.toThrow(
      "too_many_signups",
    );
  });
});

describe("large imports", () => {
  it("alerts on a new account's large import and holds its campaigns until released", async () => {
    const { team, account, organization } = await seedTeamAndContact(tdb);
    const emails = Array.from({ length: 1_200 }, (_, i) => `c${i}@example.com`);
    await recordContactImport({
      teamId: team.id,
      createdEmails: emails,
      updated: 0,
      skipped: 0,
      suppressed: 0,
      source: "beehiiv.csv",
    });

    const [audit] = await tdb
      .select()
      .from(schema.organizationAuditEvents)
      .where(eq(schema.organizationAuditEvents.action, "contacts.imported"));
    expect(audit.metadata).toMatchObject({ created: 1_200, source: "beehiiv.csv" });
    const [{ flag }] = await listAbuseFlags();
    expect(flag).toMatchObject({ kind: "import", severity: "high" });
    expect(flag.details).toMatchObject({
      importedLast24h: 1_200,
      source: "beehiiv.csv",
    });
    await expect(assertNoImportUnderReview(organization.id)).rejects.toThrow(
      "import_under_review",
    );

    const out: string[] = [];
    const code = await runAbuseCli(
      ["release", flag.flagId, "--operator", account.id, "--reason", "known list"],
      { out: (line) => out.push(line), err: (line) => out.push(line) },
    );
    expect(code).toBe(0);
    await expect(assertNoImportUnderReview(organization.id)).resolves.toBeUndefined();
  });

  it("only records small imports", async () => {
    const { team } = await seedTeamAndContact(tdb);
    await recordContactImport({
      teamId: team.id,
      createdEmails: ["a@example.com"],
      updated: 0,
      skipped: 0,
      suppressed: 0,
    });
    expect(await listAbuseFlags()).toEqual([]);
  });
});

describe("first large broadcast through the team's own ESP", () => {
  const broadcast = { sequenceId: "seq_first", title: "Welcome issue" };

  it("is reviewed once for a new account, then later ones start", async () => {
    const { team, account, organization } = await seedTeamAndContact(tdb);
    const start = (recipients: number, deliverySourceType: "team" | "organization") =>
      assertLargeBroadcastReviewed({
        organizationId: organization.id,
        teamId: team.id,
        deliverySourceType,
        sequence: broadcast,
        recipients,
      });

    // Small broadcasts and shared-mailbox ones (paced instead) aren't held.
    await expect(start(999, "team")).resolves.toBeUndefined();
    await expect(start(5_000, "organization")).resolves.toBeUndefined();

    await expect(start(1_000, "team")).rejects.toThrow("broadcast_held_for_review");
    await expect(start(1_000, "team")).rejects.toThrow("broadcast_held_for_review");
    const flags = await listAbuseFlags();
    expect(flags).toHaveLength(1);
    expect(flags[0].flag).toMatchObject({ kind: "broadcast", severity: "medium" });
    expect(flags[0].flag.details).toMatchObject({
      sequenceId: "seq_first",
      recipients: 1_000,
    });

    const code = await runAbuseCli(
      ["release", flags[0].flag.flagId, "--operator", account.id, "--reason", "ok"],
      { out: () => undefined, err: () => undefined },
    );
    expect(code).toBe(0);
    await expect(start(20_000, "team")).resolves.toBeUndefined();
  });

  it("counts a released large import as the account's one review", async () => {
    const { team, account, organization } = await seedTeamAndContact(tdb);
    await recordContactImport({
      teamId: team.id,
      createdEmails: Array.from({ length: 1_000 }, (_, i) => `c${i}@example.com`),
      updated: 0,
      skipped: 0,
      suppressed: 0,
    });
    const [{ flag }] = await listAbuseFlags();
    await runAbuseCli(
      ["release", flag.flagId, "--operator", account.id, "--reason", "known list"],
      { out: () => undefined, err: () => undefined },
    );

    await expect(
      assertLargeBroadcastReviewed({
        organizationId: organization.id,
        teamId: team.id,
        deliverySourceType: "team",
        sequence: broadcast,
        recipients: 1_000,
      }),
    ).resolves.toBeUndefined();
    expect(await listAbuseFlags()).toHaveLength(0);
  });

  it("doesn't hold established or exempt accounts, or self-hosted installs", async () => {
    const { team, organization } = await seedTeamAndContact(tdb);
    const start = () =>
      assertLargeBroadcastReviewed({
        organizationId: organization.id,
        teamId: team.id,
        deliverySourceType: "team",
        sequence: broadcast,
        recipients: 50_000,
      });
    await tdb
      .update(schema.organizations)
      .set({ createdAt: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000) })
      .where(eq(schema.organizations.id, organization.id));
    await expect(start()).resolves.toBeUndefined();

    await tdb
      .update(schema.organizations)
      .set({ createdAt: new Date() })
      .where(eq(schema.organizations.id, organization.id));
    process.env.SENDLIT_DEPLOYMENT_MODE = "oss";
    await expect(start()).resolves.toBeUndefined();
    expect(await listAbuseFlags()).toHaveLength(0);
  });
});

describe("new-account pacing", () => {
  it("spreads a new account's daily allowance over the pacing hours", () => {
    const now = new Date("2026-10-19T12:00:00Z");
    const created = new Date("2026-10-15T00:00:00Z");
    expect(
      pacingBudget({
        organizationCreatedAt: created,
        pacingExempt: false,
        rampDailyLimit: 1_000,
        monthlySendsLimit: 25_000,
        now,
      }),
    ).toEqual({ dailyLimit: 1_000, hourlyLimit: 84 });
    expect(
      pacingBudget({
        organizationCreatedAt: created,
        pacingExempt: false,
        rampDailyLimit: null,
        monthlySendsLimit: 125_000,
        now,
      }),
    ).toEqual({ dailyLimit: 4_167, hourlyLimit: 348 });
    expect(
      pacingBudget({
        organizationCreatedAt: created,
        pacingExempt: true,
        rampDailyLimit: 1_000,
        monthlySendsLimit: 25_000,
        now,
      }),
    ).toBeNull();
    expect(
      pacingBudget({
        organizationCreatedAt: new Date("2026-08-01T00:00:00Z"),
        pacingExempt: false,
        rampDailyLimit: null,
        monthlySendsLimit: 25_000,
        now,
      }),
    ).toBeNull();
  });
});

describe("PostHog events", () => {
  it("records refused signups with the reason only", async () => {
    await expect(assertSignupAllowed({ email: "x@mailinator.com" })).rejects.toThrow(
      "disposable_email",
    );
    expect(events()).toEqual([["signup_blocked", { reason: "disposable_email" }]]);
  });

  it("records scans, flags, pauses and operator decisions", async () => {
    const { team, organization, account } = await seedTeamAndContact(tdb);
    const { emailRows } = await seedSequence(tdb, {
      teamId: team.id,
      type: "broadcast",
      status: "draft",
      emails: [{ emailId: "email_e1", subject: "Notice" }],
    });
    await expect(
      assertEmailContentAllowed({
        teamId: team.id,
        email: emailRows[0],
        content: textEmail("Download https://example.com/update.exe"),
      }),
    ).rejects.toThrow("content_blocked");
    const [{ flag }] = await listAbuseFlags();
    await resolveAbuseFlag({
      flagId: flag.flagId,
      resolution: "confirmed",
      operatorUserId: account.id,
      note: "malware",
    });

    expect(events()).toEqual([
      ["content_scanned", { verdict: "blocked", scan_mode: "heuristic" }],
      [
        "abuse_flag_raised",
        { kind: "content", severity: "high", organization_id: organization.id },
      ],
      [
        "team_paused_for_review",
        { reason: "content_review", organization_id: organization.id },
      ],
      [
        "abuse_flag_resolved",
        { kind: "content", outcome: "confirmed", organization_id: organization.id },
      ],
      ["organization_sending_suspended", { organization_id: organization.id }],
    ]);
    expect(captureEvent.mock.calls[0][0]).toMatchObject({
      source: "abuse.content_scan",
      teamId: team.id,
    });
  });

  it("records a paced campaign once per hour", async () => {
    const { sharedRedis } = await import("../services/redis-client");
    const reachable = await sharedRedis()
      .ping()
      .then(
        () => true,
        () => false,
      );
    if (!reachable) return; // Needs Redis (CI runs one).
    const input = {
      teamId: "team-1",
      organizationId: "org-1",
      sequenceId: `seq_${crypto.randomUUID()}`,
      reason: "marketing_hourly_pacing",
    };
    await recordPacedSend(input);
    await recordPacedSend(input);
    expect(events()).toEqual([
      [
        "marketing_send_paced",
        {
          reason: "marketing_hourly_pacing",
          sequence_id: input.sequenceId,
          organization_id: "org-1",
        },
      ],
    ]);
  });
});
