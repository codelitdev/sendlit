import { beforeEach, describe, expect, it, mock } from "bun:test";
import { eq } from "drizzle-orm";

mock.module("../db/client", async () => {
  const { makeTestDb } = await import("../test/db.js");
  return { db: await makeTestDb() };
});

const { db } = await import("../db/client");
const { emailContentVersions } = await import("../db/schema");
const { seedTeamAndContact, truncateAll } = await import("../test/db");
type TestDb = import("../test/db").TestDb;
const { emailContent, seedSequence } = await import("../test/fixtures");
const { getContentVersion, getOrCreateContentVersion } = await import(
  "./content-versions"
);

const tdb = db as unknown as TestDb;

beforeEach(async () => {
  await truncateAll(tdb);
});

async function seed() {
  const { team } = await seedTeamAndContact(tdb);
  const { emailRows } = await seedSequence(tdb, {
    teamId: team.id,
    emails: [{ emailId: "email_e1" }, { emailId: "email_e2" }],
  });
  return { team, emails: emailRows.map((email) => ({ ...email, teamId: team.id })) };
}

describe("getOrCreateContentVersion", () => {
  it("stores each distinct content once and a new copy after an edit", async () => {
    const { emails } = await seed();
    const [email] = emails;

    const first = await getOrCreateContentVersion(email);
    const again = await getOrCreateContentVersion(email);
    // Same content read back from Postgres (jsonb reorders keys).
    const reread = await getOrCreateContentVersion({
      ...email,
      content: JSON.parse(JSON.stringify(email.content)),
    });
    expect(again).toEqual(first);
    expect(reread).toEqual(first);
    expect(first.versionId).toMatch(/^ver_/);

    const edited = await getOrCreateContentVersion({
      ...email,
      content: emailContent({ text: "Edited" }),
    });
    const renamed = await getOrCreateContentVersion({ ...email, subject: "New" });
    expect(new Set([first.id, edited.id, renamed.id]).size).toBe(3);

    const rows = await tdb
      .select()
      .from(emailContentVersions)
      .where(eq(emailContentVersions.sequenceEmailId, email.id));
    expect(rows).toHaveLength(3);
    const stored = await getContentVersion(email.id, edited.versionId);
    expect(JSON.stringify(stored?.content)).toContain("Edited");
  });

  it("finds a version only through its own email", async () => {
    const { emails } = await seed();
    const version = await getOrCreateContentVersion(emails[0]);

    expect(await getContentVersion(emails[1].id, version.versionId)).toBeNull();
    expect(await getContentVersion(emails[0].id, "ver_missing")).toBeNull();
  });
});
