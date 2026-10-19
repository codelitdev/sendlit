import { beforeEach, describe, expect, it, mock } from "bun:test";

mock.module("../db/client", async () => {
  const { makeTestDb } = await import("../test/db");
  return { db: await makeTestDb() };
});

const { db } = await import("../db/client");
const { contacts, emailEvents, ongoingSequences } = await import("../db/schema");
const { seedTeamAndContact, truncateAll } = await import("../test/db");
const { seedSequence } = await import("../test/fixtures");
const { engagementPriorities } = await import("./engagement");
const { enrollContactsInOngoingSequence, getDueOngoingSequences } = await import(
  "./queries"
);
type TestDb = import("../test/db").TestDb;

const tdb = db as unknown as TestDb;
const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000);

beforeEach(async () => {
  await truncateAll(tdb);
});

async function setup() {
  const { team, contact } = await seedTeamAndContact(tdb);
  const { sequenceRow, emailRows } = await seedSequence(tdb, {
    teamId: team.id,
    type: "broadcast",
    emails: [{ emailId: "email_e1", delayInMillis: 0 }],
  });
  const add = async (
    email: string,
    values: Partial<typeof contacts.$inferInsert> = {},
  ) => {
    const [row] = await tdb
      .insert(contacts)
      .values({
        teamId: team.id,
        email,
        unsubscribeToken: crypto.randomUUID(),
        ...values,
      })
      .returning();
    return row;
  };
  const event = (contactId: string, action: string, at: Date) =>
    tdb.insert(emailEvents).values({
      teamId: team.id,
      sequenceId: sequenceRow.id,
      emailId: emailRows[0].id,
      contactId,
      action,
      createdAt: at,
    });
  return { team, contact, sequenceRow, add, event };
}

describe("engagement order", () => {
  it("ranks clickers, then openers, then imported rates, then newer signups", async () => {
    const { team, add, event } = await setup();
    const clicker = await add("clicker@example.com", { createdAt: daysAgo(400) });
    const opener = await add("opener@example.com", { createdAt: daysAgo(400) });
    const imported = await add("imported@example.com", {
      createdAt: daysAgo(400),
      customFields: { open_rate: "80%" },
    });
    const fresh = await add("fresh@example.com", { createdAt: daysAgo(1) });
    const dormant = await add("dormant@example.com", { createdAt: daysAgo(900) });
    await event(clicker.id, "click", daysAgo(10));
    await event(opener.id, "open", daysAgo(2));
    await event(dormant.id, "open", daysAgo(700));

    const priorities = await engagementPriorities(
      team.id,
      [dormant, fresh, imported, opener, clicker].map((c) => c.id),
    );
    const order = [clicker, opener, imported, fresh, dormant];
    const ranked = [...order].sort(
      (a, b) => priorities.get(b.id)! - priorities.get(a.id)!,
    );
    expect(ranked.map((c) => c.email)).toEqual(order.map((c) => c.email));
  });

  it("enrolls with priorities and hands out due deliveries most engaged first", async () => {
    const { team, sequenceRow, add, event } = await setup();
    const quiet = await add("quiet@example.com", { createdAt: daysAgo(300) });
    const keen = await add("keen@example.com", { createdAt: daysAgo(300) });
    await event(keen.id, "click", daysAgo(1));

    await enrollContactsInOngoingSequence({
      teamId: team.id,
      sequenceId: sequenceRow.id,
      contactIds: [quiet.id, keen.id],
    });
    const rows = await tdb.select().from(ongoingSequences);
    expect(rows.find((r) => r.contactId === keen.id)!.priority).toBeGreaterThan(
      rows.find((r) => r.contactId === quiet.id)!.priority,
    );
    await new Promise((resolve) => setTimeout(resolve, 5));
    const due = await getDueOngoingSequences();
    expect(due.map((r) => r.contactId)).toEqual([keen.id, quiet.id]);
  });
});
