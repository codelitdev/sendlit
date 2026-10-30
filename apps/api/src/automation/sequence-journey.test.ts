import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  type Mock,
  mock,
  setSystemTime,
  vi,
} from "bun:test";

mock.module("../db/client", async () => {
  const { makeTestDb } = await import("../test/db.js");
  return { db: await makeTestDb() };
});
mock.module("../mail/send", () => ({
  sendMail: vi.fn().mockResolvedValue({ messageId: null, providerResponse: null }),
}));
const observability = await import("../observability");
const captureEvent = vi.fn();
mock.module("../observability", () => ({ ...observability, captureEvent }));

const { db } = await import("../db/client");
const { ongoingSequences, rules } = await import("../db/schema");
const { EventType } = await import("../config/constants");
const { sendMail } = await import("../mail/send");
const { seedTeamAndContact, truncateAll } = await import("../test/db");
type TestDb = import("../test/db").TestDb;
const { seedSequence } = await import("../test/fixtures");
const { fireEvent } = await import("./fire-event");
const { getDueOngoingSequences } = await import("./queries");
const { processOngoingSequence } = await import("./process-ongoing-sequence");

const tdb = db as unknown as TestDb;
const mockedSendMail = sendMail as unknown as Mock<typeof sendMail>;
const DAY = 86_400_000;

beforeEach(async () => {
  await truncateAll(tdb);
  mockedSendMail.mockClear();
  captureEvent.mockClear();
});

afterEach(() => {
  setSystemTime();
});

function earlySendEvents() {
  return captureEvent.mock.calls
    .map(([e]) => e)
    .filter((e) => e.event === "sequence_email_sent_early");
}

/** Moves the clock to `at`, then does what one 60s poll and its workers do. */
async function pollAt(at: number): Promise<string[]> {
  setSystemTime(new Date(at));
  const before = mockedSendMail.mock.calls.length;
  for (const row of await getDueOngoingSequences()) {
    await processOngoingSequence(row.id);
  }
  return mockedSendMail.mock.calls.slice(before).map(([mail]) => mail.subject);
}

/** Enrolls the seeded contact through a subscriber:added trigger at `at`. */
async function subscribeAt(
  at: number,
  emails: Parameters<typeof seedSequence>[1]["emails"],
) {
  const { team, contact } = await seedTeamAndContact(tdb);
  const { sequenceRow } = await seedSequence(tdb, { teamId: team.id, emails });
  await tdb.insert(rules).values({
    teamId: team.id,
    ruleId: `rule_${crypto.randomUUID()}`,
    event: EventType.SUBSCRIBER_ADDED,
    sequenceId: sequenceRow.id,
  });
  setSystemTime(new Date(at));
  await fireEvent({
    teamId: team.id,
    event: EventType.SUBSCRIBER_ADDED,
    contactId: contact.id,
  });
}

describe("a contact's journey through a multi-day sequence", () => {
  it("sends each email only once its delay has passed", async () => {
    const start = Date.parse("2026-11-02T09:00:00Z");
    await subscribeAt(start, [
      { emailId: "email_day2", subject: "Day 2", delayInMillis: 2 * DAY },
      { emailId: "email_day5", subject: "Day 5", delayInMillis: 3 * DAY },
    ]);

    expect(await pollAt(start + 60_000)).toEqual([]);
    expect(await pollAt(start + 1.9 * DAY)).toEqual([]);
    expect(await pollAt(start + 2.1 * DAY)).toEqual(["Day 2"]);
    expect(await pollAt(start + 2.2 * DAY)).toEqual([]);
    expect(await pollAt(start + 4.9 * DAY)).toEqual([]);
    expect(await pollAt(start + 5.1 * DAY)).toEqual(["Day 5"]);
    expect(await pollAt(start + 30 * DAY)).toEqual([]);
  });

  it("sends a first email without a delay on the next poll", async () => {
    const start = Date.parse("2026-11-02T09:00:00Z");
    await subscribeAt(start, [
      { emailId: "email_welcome", subject: "Welcome", delayInMillis: 0 },
      { emailId: "email_day1", subject: "Day 1", delayInMillis: DAY },
    ]);

    expect(await pollAt(start + 60_000)).toEqual(["Welcome"]);
    expect(await pollAt(start + 0.9 * DAY)).toEqual([]);
    expect(await pollAt(start + 1.1 * DAY)).toEqual(["Day 1"]);
  });

  it("keeps later emails on schedule when one goes out late", async () => {
    const start = Date.parse("2026-11-02T09:00:00Z");
    await subscribeAt(start, [
      { emailId: "email_day1", subject: "Day 1", delayInMillis: DAY },
      { emailId: "email_day3", subject: "Day 3", delayInMillis: 2 * DAY },
    ]);

    // No poll ran on day 1 (an outage, say): it goes out on day 2.5.
    expect(await pollAt(start + 2.5 * DAY)).toEqual(["Day 1"]);
    expect(await pollAt(start + 2.9 * DAY)).toEqual([]);
    expect(await pollAt(start + 3.1 * DAY)).toEqual(["Day 3"]);
  });

  it("never reports an on-schedule journey as early", async () => {
    const start = Date.parse("2026-11-02T09:00:00Z");
    await subscribeAt(start, [
      { emailId: "email_welcome", subject: "Welcome", delayInMillis: 0 },
      { emailId: "email_day1", subject: "Day 1", delayInMillis: DAY },
    ]);

    await pollAt(start + 60_000);
    await pollAt(start + 1.1 * DAY);

    expect(mockedSendMail).toHaveBeenCalledTimes(2);
    expect(earlySendEvents()).toEqual([]);
  });

  it("reports an email scheduled before its delay, and still sends it", async () => {
    const start = Date.parse("2026-11-02T09:00:00Z");
    await subscribeAt(start, [
      { emailId: "email_day13", subject: "Day 13", delayInMillis: 13 * DAY },
    ]);
    // What the old enrollment did: due straight away.
    await tdb.update(ongoingSequences).set({ nextEmailScheduledTime: start });

    expect(await pollAt(start + 60_000)).toEqual(["Day 13"]);
    const [event] = earlySendEvents();
    expect(event.properties).toMatchObject({
      email_id: "email_day13",
      early_by_ms: 13 * DAY - 60_000,
    });
  });
});
