import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";
import { eq } from "drizzle-orm";

mock.module("../db/client", async () => {
  const { makeTestDb } = await import("../test/db.js");
  return { db: await makeTestDb() };
});

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
const { runAbuseCli } = await import("./operator-cli");
const { closeSharedRedis } = await import("../services/redis-client");

const tdb = db as unknown as TestDb;

beforeEach(async () => {
  useCloudFakeBillingEnv();
  process.env.CONTENT_SCAN = "heuristic";
  await truncateAll(tdb);
});

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
