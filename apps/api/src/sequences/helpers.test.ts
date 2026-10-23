import { beforeEach, describe, expect, it, mock } from "bun:test";

mock.module("../db/client", async () => {
  const { makeTestDb } = await import("../test/db");
  return { db: await makeTestDb() };
});

const { EventType } = await import("../config/constants");
const { db } = await import("../db/client");
const { rules } = await import("../db/schema");
const { seedTeamAndContact, truncateAll } = await import("../test/db");
type TestDb = import("../test/db").TestDb;
const { seedSequence } = await import("../test/fixtures");
const { addRule, defaultEmailContent, removeRule, verifyMandatoryTags } = await import(
  "./helpers"
);

const tdb = db as unknown as TestDb;

beforeEach(async () => {
  await truncateAll(tdb);
});

describe("sequence helpers", () => {
  it("requires exactly one final managed footer", () => {
    expect(() => verifyMandatoryTags(defaultEmailContent.content)).not.toThrow();
    expect(() =>
      verifyMandatoryTags([
        {
          blockType: "text",
          settings: { content: "no tags here" },
        },
      ]),
    ).toThrow(/managed footer/);
  });

  it("adds and removes broadcast schedule rules", async () => {
    const { team } = await seedTeamAndContact(tdb);
    const { sequenceRow } = await seedSequence(tdb, {
      teamId: team.id,
      type: "broadcast",
      emails: [{ emailId: "email_helpers1", delayInMillis: 0 }],
    });

    await addRule({
      teamId: team.id,
      sequenceId: sequenceRow.id,
      triggerType: EventType.DATE_OCCURRED,
      eventDateInMillis: Date.now() + 60_000,
    });
    expect(await tdb.select().from(rules)).toHaveLength(1);

    await removeRule({ teamId: team.id, sequenceId: sequenceRow.id });
    expect(await tdb.select().from(rules)).toHaveLength(0);
  });
});
