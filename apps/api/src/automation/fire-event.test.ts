import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";

vi.mock("../db/client", async () => {
  const { makeTestDb } = await import("../test/db.js");
  return { db: await makeTestDb() };
});

import { db } from "../db/client";
import { ongoingSequences, rules } from "../db/schema";
import { truncateAll, seedTeamAndContact, type TestDb } from "../test/db";
import { seedSequence } from "../test/fixtures";
import { EventType } from "../config/constants";
import { fireEvent } from "./fire-event";

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
    ruleId: `rule-${crypto.randomUUID()}`,
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
      emails: [{ emailId: "e1" }],
    });
    await seedRule({
      teamId: team.id,
      sequenceId: sequenceRow.sequenceId,
      event: EventType.TAG_ADDED,
      eventData: "vip",
    });

    await fireEvent({
      teamId: team.id,
      event: EventType.TAG_ADDED,
      eventData: "vip",
      contactId: contact.contactId,
    });

    expect(await enrolledContactIds(sequenceRow.sequenceId)).toEqual([
      contact.contactId,
    ]);
  });

  it("ignores TAG_ADDED rules for a different tag", async () => {
    const { team, contact } = await seedTeamAndContact(tdb);
    const { sequenceRow } = await seedSequence(tdb, {
      teamId: team.id,
      emails: [{ emailId: "e1" }],
    });
    await seedRule({
      teamId: team.id,
      sequenceId: sequenceRow.sequenceId,
      event: EventType.TAG_ADDED,
      eventData: "vip",
    });

    await fireEvent({
      teamId: team.id,
      event: EventType.TAG_ADDED,
      eventData: "newsletter",
      contactId: contact.contactId,
    });

    expect(await enrolledContactIds(sequenceRow.sequenceId)).toEqual([]);
  });

  it("does not enroll into sequences that are not active", async () => {
    const { team, contact } = await seedTeamAndContact(tdb);
    const { sequenceRow } = await seedSequence(tdb, {
      teamId: team.id,
      status: "paused",
      emails: [{ emailId: "e1" }],
    });
    await seedRule({
      teamId: team.id,
      sequenceId: sequenceRow.sequenceId,
      event: EventType.SUBSCRIBER_ADDED,
    });

    await fireEvent({
      teamId: team.id,
      event: EventType.SUBSCRIBER_ADDED,
      contactId: contact.contactId,
    });

    expect(await enrolledContactIds(sequenceRow.sequenceId)).toEqual([]);
  });

  it("enrolls on SUBSCRIBER_ADDED without any eventData matching", async () => {
    const { team, contact } = await seedTeamAndContact(tdb);
    const { sequenceRow } = await seedSequence(tdb, {
      teamId: team.id,
      emails: [{ emailId: "e1" }],
    });
    await seedRule({
      teamId: team.id,
      sequenceId: sequenceRow.sequenceId,
      event: EventType.SUBSCRIBER_ADDED,
    });

    await fireEvent({
      teamId: team.id,
      event: EventType.SUBSCRIBER_ADDED,
      contactId: contact.contactId,
    });

    expect(await enrolledContactIds(sequenceRow.sequenceId)).toEqual([
      contact.contactId,
    ]);
  });
});
