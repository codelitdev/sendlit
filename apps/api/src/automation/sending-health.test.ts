import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  type Mock,
  mock,
  spyOn,
  vi,
} from "bun:test";
import { eq } from "drizzle-orm";
import { Liquid } from "liquidjs";

mock.module("../db/client", async () => {
  const { makeTestDb } = await import("../test/db.js");
  return { db: await makeTestDb() };
});
mock.module("../mail/send", () => ({
  sendMail: vi.fn().mockResolvedValue({ messageId: null, providerResponse: null }),
}));

const { db } = await import("../db/client");
const schema = await import("../db/schema");
const { sendMail } = await import("../mail/send");
const { seedTeamAndContact, truncateAll } = await import("../test/db");
type TestDb = import("../test/db").TestDb;
const { emailContent, seedOngoingSequence, seedSequence } = await import(
  "../test/fixtures"
);
const { isPermanentRenderError, processOngoingSequence } = await import(
  "./process-ongoing-sequence"
);
const { EmailRenderError } = await import("../mail/render");
const { TemplateValidationError } = await import("../templates/validation");
const generalSettings = await import("../settings/general/queries");
const { getDueOngoingSequences } = await import("./queries");
const { resetSendingHealthCacheForTests, isFatalEspError, renderErrorReason } =
  await import("./sending-health");
const { startSequence } = await import("../sequences/queries");

const tdb = db as unknown as TestDb;
const mockedSendMail = sendMail as unknown as Mock<typeof sendMail>;

beforeEach(async () => {
  await truncateAll(tdb);
  resetSendingHealthCacheForTests();
  mockedSendMail.mockReset();
  mockedSendMail.mockResolvedValue({ messageId: null, providerResponse: null });
});
afterEach(() => {
  delete process.env.AUTO_PAUSE_MIN_SENT;
  delete process.env.AUTO_PAUSE_CONSECUTIVE_FAILURES;
});

async function broadcastTo(n: number) {
  const { team } = await seedTeamAndContact(tdb);
  const { sequenceRow } = await seedSequence(tdb, {
    teamId: team.id,
    type: "broadcast",
    emails: [{ emailId: "email_e1", delayInMillis: 0 }],
  });
  const rows = [];
  for (let i = 0; i < n; i++) {
    const [contact] = await tdb
      .insert(schema.contacts)
      .values({
        teamId: team.id,
        email: `r${i}.${crypto.randomUUID()}@example.com`,
        unsubscribeToken: crypto.randomUUID(),
      })
      .returning();
    rows.push(
      await seedOngoingSequence(tdb, {
        teamId: team.id,
        sequenceId: sequenceRow.id,
        contactId: contact.id,
      }),
    );
  }
  return { team, sequenceRow, rows };
}

const sequenceById = async (id: string) =>
  (await tdb.select().from(schema.sequences).where(eq(schema.sequences.id, id)))[0];

describe("auto-pause (#25)", () => {
  it("pauses on a high bounce rate and stops sending", async () => {
    process.env.AUTO_PAUSE_MIN_SENT = "2";
    const { sequenceRow, rows } = await broadcastTo(4);
    for (const row of rows.slice(0, 3)) await processOngoingSequence(row.id);
    expect(mockedSendMail).toHaveBeenCalledTimes(3);
    const [first] = await tdb.select().from(schema.outboundMessages).limit(1);
    await tdb
      .update(schema.outboundMessages)
      .set({ deliveryStatus: "bounced" })
      .where(eq(schema.outboundMessages.id, first.id));
    // Rates are checked at most every 30 seconds per sequence.
    resetSendingHealthCacheForTests();

    await processOngoingSequence(rows[3].id);

    expect(mockedSendMail).toHaveBeenCalledTimes(3);
    const paused = await sequenceById(sequenceRow.id);
    expect(paused.status).toBe("paused");
    expect((paused.report as any).autoPause).toMatchObject({ reason: "bounce_rate" });
    // The remaining delivery waits, unclaimed, and isn't picked up while paused.
    const [remaining] = await tdb
      .select()
      .from(schema.ongoingSequences)
      .where(eq(schema.ongoingSequences.id, rows[3].id));
    expect(remaining.processingStartedAt).toBeNull();
    expect(await getDueOngoingSequences()).toEqual([]);
  });

  it("pauses after consecutive failures, and at once on a fatal ESP error", async () => {
    process.env.AUTO_PAUSE_CONSECUTIVE_FAILURES = "2";
    const { sequenceRow, rows } = await broadcastTo(3);
    mockedSendMail.mockRejectedValue(new Error("connection reset"));
    await expect(processOngoingSequence(rows[0].id)).rejects.toThrow(
      "connection reset",
    );
    await expect(processOngoingSequence(rows[1].id)).resolves.toBeUndefined();
    const paused = await sequenceById(sequenceRow.id);
    expect((paused.report as any).autoPause.reason).toBe("consecutive_failures");

    const other = await broadcastTo(1);
    mockedSendMail.mockRejectedValue(
      Object.assign(new Error("554 Account is suspended"), { responseCode: 554 }),
    );
    await processOngoingSequence(other.rows[0].id);
    const fatal = await sequenceById(other.sequenceRow.id);
    expect((fatal.report as any).autoPause.reason).toBe("esp_error");
    expect(isFatalEspError(new Error("454 Throttling failure"))).toBe(false);
  });

  it("pauses on a footer settings error and keeps every recipient queued until resumed", async () => {
    const { team, sequenceRow, rows } = await broadcastTo(2);
    // A team-wide problem: every recipient's footer fails the same way.
    await tdb
      .update(schema.settings)
      .set({ mailingAddress: "" })
      .where(eq(schema.settings.teamId, team.id));

    await processOngoingSequence(rows[0].id);

    expect(mockedSendMail).not.toHaveBeenCalled();
    const paused = await sequenceById(sequenceRow.id);
    expect(paused.status).toBe("paused");
    expect((paused.report as any).autoPause).toMatchObject({
      reason: "render_error",
      error: "footer_render_context_required",
    });
    // Nobody is dropped or charged a retry, and nothing is polled while paused.
    const queued = await tdb.select().from(schema.ongoingSequences);
    expect(queued).toHaveLength(2);
    expect(
      queued.every((row) => row.retryCount === 0 && !row.processingStartedAt),
    ).toBe(true);
    expect(await getDueOngoingSequences()).toEqual([]);

    // Fixed and resumed: everyone gets the email and the broadcast completes.
    await tdb
      .update(schema.settings)
      .set({ mailingAddress: "1 Test St, Testville" })
      .where(eq(schema.settings.teamId, team.id));
    await startSequence({ teamId: team.id, sequenceId: sequenceRow.sequenceId });
    for (const row of rows) await processOngoingSequence(row.id);
    expect(mockedSendMail).toHaveBeenCalledTimes(2);
    expect((await sequenceById(sequenceRow.id)).status).toBe("completed");
  });

  it("retries a transient error while rendering without pausing or counting it", async () => {
    const { sequenceRow, rows } = await broadcastTo(1);
    const spy = spyOn(generalSettings, "getTeamSettingsRow").mockRejectedValueOnce(
      new Error("Connection terminated unexpectedly"),
    );
    try {
      await expect(processOngoingSequence(rows[0].id)).rejects.toThrow(
        "Connection terminated unexpectedly",
      );
    } finally {
      spy.mockRestore();
    }

    expect((await sequenceById(sequenceRow.id)).status).toBe("active");
    const [row] = await tdb.select().from(schema.ongoingSequences);
    expect(row.retryCount).toBe(0);
    expect(row.processingStartedAt).toBeNull();
    // Recovered: the next attempt sends normally.
    await processOngoingSequence(rows[0].id);
    expect(mockedSendMail).toHaveBeenCalledTimes(1);
  });

  it("pauses on a Liquid syntax error in the email content", async () => {
    const { sequenceRow, rows } = await broadcastTo(1);
    await tdb
      .update(schema.sequenceEmails)
      .set({ content: emailContent({ text: "Hello {{ subscriber.name" }) as any })
      .where(eq(schema.sequenceEmails.sequenceId, sequenceRow.id));

    await processOngoingSequence(rows[0].id);

    expect(mockedSendMail).not.toHaveBeenCalled();
    const paused = await sequenceById(sequenceRow.id);
    expect(paused.status).toBe("paused");
    expect((paused.report as any).autoPause.reason).toBe("render_error");
    expect(await tdb.select().from(schema.ongoingSequences)).toHaveLength(1);
  });

  it("pauses, instead of skipping everyone, on a Liquid runtime error from the content", async () => {
    const { sequenceRow, rows } = await broadcastTo(2);
    // Fails at render time for every recipient, whatever their data.
    await tdb
      .update(schema.sequenceEmails)
      .set({ content: emailContent({ text: "Hi {% include header %}" }) as any })
      .where(eq(schema.sequenceEmails.sequenceId, sequenceRow.id));

    for (const row of rows) await processOngoingSequence(row.id);

    expect(mockedSendMail).not.toHaveBeenCalled();
    const paused = await sequenceById(sequenceRow.id);
    expect(paused.status).toBe("paused");
    expect((paused.report as any).autoPause.reason).toBe("render_error");
    expect((paused.report as any).sequence?.failed ?? []).toEqual([]);
    expect(await tdb.select().from(schema.ongoingSequences)).toHaveLength(2);
  });

  it("pauses after several recipients in a row fail a guarded content error", async () => {
    process.env.AUTO_PAUSE_CONSECUTIVE_FAILURES = "2";
    const { sequenceRow, rows } = await broadcastTo(3);
    // The include only runs for contacts with a name, so a render without
    // contact data succeeds and each failure looks per-recipient.
    await tdb
      .update(schema.sequenceEmails)
      .set({
        content: emailContent({
          text: "Hi {% if subscriber.name %}{% include greeting %}{% endif %}",
        }) as any,
      })
      .where(eq(schema.sequenceEmails.sequenceId, sequenceRow.id));
    await tdb.update(schema.contacts).set({ name: "Ada" });

    for (const row of rows) await processOngoingSequence(row.id);

    expect(mockedSendMail).not.toHaveBeenCalled();
    const paused = await sequenceById(sequenceRow.id);
    expect(paused.status).toBe("paused");
    expect((paused.report as any).autoPause.reason).toBe("render_error");
    // Only the first recipient was skipped; the rest wait for the fix.
    expect((paused.report as any).sequence.failed).toHaveLength(1);
    expect(await tdb.select().from(schema.ongoingSequences)).toHaveLength(2);
  });

  it("skips only the recipient whose own data breaks the Liquid render", async () => {
    const { sequenceRow, rows } = await broadcastTo(2);
    await tdb
      .update(schema.sequenceEmails)
      .set({
        content: emailContent({ text: "Hi {{ subscriber.name | url_decode }}" }) as any,
      })
      .where(eq(schema.sequenceEmails.sequenceId, sequenceRow.id));
    // An invalid percent-encoding makes url_decode throw for this contact only.
    const [broken] = await tdb
      .update(schema.contacts)
      .set({ name: "O%E0Brien" })
      .where(eq(schema.contacts.id, rows[0].contactId))
      .returning();

    for (const row of rows) await processOngoingSequence(row.id);

    expect(mockedSendMail).toHaveBeenCalledTimes(1);
    const after = await sequenceById(sequenceRow.id);
    expect(after.status).toBe("completed");
    expect((after.report as any).autoPause).toBeUndefined();
    expect((after.report as any).sequence.failed).toEqual([broken.contactId]);
    expect(await tdb.select().from(schema.ongoingSequences)).toHaveLength(0);
  });

  it("treats only content and footer errors as permanent render errors", () => {
    expect(isPermanentRenderError(new EmailRenderError("footer_render_failed"))).toBe(
      true,
    );
    expect(isPermanentRenderError(new TemplateValidationError("footer_required"))).toBe(
      true,
    );
    let liquidSyntaxError: unknown;
    try {
      new Liquid().parse("{{ name");
    } catch (err) {
      liquidSyntaxError = err;
    }
    expect(isPermanentRenderError(liquidSyntaxError)).toBe(true);
    expect(
      isPermanentRenderError(new Error("Connection terminated unexpectedly")),
    ).toBe(false);
    expect(renderErrorReason("footer_render_context_required")).toContain(
      "no mailing address",
    );
    expect(renderErrorReason("footer_render_failed")).toContain("mailing address");
    // A missing footer block is a content problem, not a mailing-address one.
    expect(renderErrorReason("footer_required")).toContain("footer block");
    expect(renderErrorReason("footer_required")).not.toContain("mailing address");
  });

  it("resumes a paused broadcast's queued deliveries without running its audience again", async () => {
    process.env.AUTO_PAUSE_MIN_SENT = "1";
    const { team, sequenceRow, rows } = await broadcastTo(2);
    await processOngoingSequence(rows[0].id);
    await tdb.update(schema.outboundMessages).set({ feedbackStatus: "complained" });
    await tdb
      .update(schema.sequences)
      .set({ report: { broadcast: { lockedAt: Date.now(), sentAt: null } } })
      .where(eq(schema.sequences.id, sequenceRow.id));
    resetSendingHealthCacheForTests();
    await processOngoingSequence(rows[1].id);
    expect((await sequenceById(sequenceRow.id)).status).toBe("paused");

    const resumed = await startSequence({
      teamId: team.id,
      sequenceId: sequenceRow.sequenceId,
    });

    expect(resumed.status).toBe("active");
    expect((resumed.report as any).autoPause).toBeUndefined();
    expect(await tdb.select().from(schema.rules)).toEqual([]);
    expect(await getDueOngoingSequences()).toHaveLength(1);
    // The old complaint doesn't count after the resume, so the rest goes out.
    resetSendingHealthCacheForTests();
    await processOngoingSequence(rows[1].id);
    expect(mockedSendMail).toHaveBeenCalledTimes(2);
    expect((await sequenceById(sequenceRow.id)).status).toBe("completed");
  });
});
