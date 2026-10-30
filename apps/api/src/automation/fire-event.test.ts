import { beforeEach, describe, expect, it, mock } from "bun:test";
import { eq } from "drizzle-orm";

mock.module("../db/client", async () => {
  const { makeTestDb } = await import("../test/db.js");
  return { db: await makeTestDb() };
});

const { EventType } = await import("../config/constants");
const { db } = await import("../db/client");
const { ongoingSequences, rules, sequences } = await import("../db/schema");
const { seedTeamAndContact, truncateAll } = await import("../test/db");
type TestDb = import("../test/db").TestDb;
const { seedSequence } = await import("../test/fixtures");
const { fireEvent } = await import("./fire-event");

const tdb = db as unknown as TestDb;

beforeEach(async () => {
  await truncateAll(tdb);
});

async function seedRule({
  teamId,
  sequenceId,
  event,
  eventData,
}: {
  teamId: string;
  sequenceId: string;
  event: string;
  eventData?: string;
}) {
  await tdb.insert(rules).values({
    teamId,
    ruleId: `rule_${crypto.randomUUID()}`,
    event,
    sequenceId,
    eventData,
  });
}

async function enrolledContactIds(sequenceId: string) {
  const rows = await tdb
    .select()
    .from(ongoingSequences)
    .where(eq(ongoingSequences.sequenceId, sequenceId));
  return rows.map((r) => r.contactId);
}

describe("fireEvent", () => {
  it("enrolls the contact when a TAG_ADDED rule matches the tag", async () => {
    const { team, contact } = await seedTeamAndContact(tdb);
    const { sequenceRow } = await seedSequence(tdb, {
      teamId: team.id,
      emails: [{ emailId: "email_e1" }],
    });
    await seedRule({
      teamId: team.id,
      sequenceId: sequenceRow.id,
      event: EventType.TAG_ADDED,
      eventData: "vip",
    });

    await fireEvent({
      teamId: team.id,
      event: EventType.TAG_ADDED,
      eventData: "vip",
      contactId: contact.id,
    });

    expect(await enrolledContactIds(sequenceRow.id)).toEqual([contact.id]);
  });

  it("ignores TAG_ADDED rules for a different tag", async () => {
    const { team, contact } = await seedTeamAndContact(tdb);
    const { sequenceRow } = await seedSequence(tdb, {
      teamId: team.id,
      emails: [{ emailId: "email_e1" }],
    });
    await seedRule({
      teamId: team.id,
      sequenceId: sequenceRow.id,
      event: EventType.TAG_ADDED,
      eventData: "vip",
    });

    await fireEvent({
      teamId: team.id,
      event: EventType.TAG_ADDED,
      eventData: "newsletter",
      contactId: contact.id,
    });

    expect(await enrolledContactIds(sequenceRow.id)).toEqual([]);
  });

  it("does not enroll into sequences that are not active", async () => {
    const { team, contact } = await seedTeamAndContact(tdb);
    const { sequenceRow } = await seedSequence(tdb, {
      teamId: team.id,
      status: "paused",
      emails: [{ emailId: "email_e1" }],
    });
    await seedRule({
      teamId: team.id,
      sequenceId: sequenceRow.id,
      event: EventType.SUBSCRIBER_ADDED,
    });

    await fireEvent({
      teamId: team.id,
      event: EventType.SUBSCRIBER_ADDED,
      contactId: contact.id,
    });

    expect(await enrolledContactIds(sequenceRow.id)).toEqual([]);
  });

  it("enrolls on SUBSCRIBER_ADDED without any eventData matching", async () => {
    const { team, contact } = await seedTeamAndContact(tdb);
    const { sequenceRow } = await seedSequence(tdb, {
      teamId: team.id,
      emails: [{ emailId: "email_e1" }],
    });
    await seedRule({
      teamId: team.id,
      sequenceId: sequenceRow.id,
      event: EventType.SUBSCRIBER_ADDED,
    });

    await fireEvent({
      teamId: team.id,
      event: EventType.SUBSCRIBER_ADDED,
      contactId: contact.id,
    });

    expect(await enrolledContactIds(sequenceRow.id)).toEqual([contact.id]);
  });

  it("schedules the first email its own delay after entry", async () => {
    const { team, contact } = await seedTeamAndContact(tdb);
    const thirteenDays = 13 * 86400000;
    const { sequenceRow } = await seedSequence(tdb, {
      teamId: team.id,
      emails: [
        { emailId: "email_draft", delayInMillis: 0, published: false },
        { emailId: "email_e1", delayInMillis: thirteenDays },
      ],
    });
    await seedRule({
      teamId: team.id,
      sequenceId: sequenceRow.id,
      event: EventType.SUBSCRIBER_ADDED,
    });

    const before = Date.now();
    await fireEvent({
      teamId: team.id,
      event: EventType.SUBSCRIBER_ADDED,
      contactId: contact.id,
    });

    const [row] = await tdb
      .select()
      .from(ongoingSequences)
      .where(eq(ongoingSequences.sequenceId, sequenceRow.id));
    expect(row.nextEmailScheduledTime).toBeGreaterThanOrEqual(before + thirteenDays);
    expect(row.nextEmailScheduledTime).toBeLessThanOrEqual(Date.now() + thirteenDays);
  });

  it("schedules a first email without a delay right away", async () => {
    const { team, contact } = await seedTeamAndContact(tdb);
    const { sequenceRow } = await seedSequence(tdb, {
      teamId: team.id,
      emails: [{ emailId: "email_e1", delayInMillis: 0 }],
    });
    await seedRule({
      teamId: team.id,
      sequenceId: sequenceRow.id,
      event: EventType.SUBSCRIBER_ADDED,
    });

    await fireEvent({
      teamId: team.id,
      event: EventType.SUBSCRIBER_ADDED,
      contactId: contact.id,
    });

    const [row] = await tdb
      .select()
      .from(ongoingSequences)
      .where(eq(ongoingSequences.sequenceId, sequenceRow.id));
    expect(row.nextEmailScheduledTime).toBeLessThanOrEqual(Date.now());
  });

  it("skips contacts matching the sequence's exclusion filter", async () => {
    const { team, contact } = await seedTeamAndContact(tdb);
    const { sequenceRow } = await seedSequence(tdb, {
      teamId: team.id,
      emails: [{ emailId: "email_e1" }],
    });
    await tdb
      .update(sequences)
      .set({
        excludeFilter: {
          aggregator: "or",
          filters: [{ name: "email", condition: "is", value: contact.email }],
        },
      })
      .where(eq(sequences.id, sequenceRow.id));
    await seedRule({
      teamId: team.id,
      sequenceId: sequenceRow.id,
      event: EventType.SUBSCRIBER_ADDED,
    });

    await fireEvent({
      teamId: team.id,
      event: EventType.SUBSCRIBER_ADDED,
      contactId: contact.id,
    });

    expect(await enrolledContactIds(sequenceRow.id)).toEqual([]);
  });
});
