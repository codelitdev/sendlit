import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  type Mock,
  mock,
  vi,
} from "bun:test";
import { eq } from "drizzle-orm";

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
const { seedOngoingSequence, seedSequence } = await import("../test/fixtures");
const { processOngoingSequence } = await import("./process-ongoing-sequence");
const { getDueOngoingSequences } = await import("./queries");
const { resetSendingHealthCacheForTests, isFatalEspError } = await import(
  "./sending-health"
);
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
