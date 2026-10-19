import { beforeEach, describe, expect, it, mock } from "bun:test";
import { eq } from "drizzle-orm";

mock.module("../db/client", async () => {
  const { makeTestDb } = await import("../test/db.js");
  return { db: await makeTestDb() };
});

let subscribedContactsLimit: number | null = null;
const entitlements = await import("../billing/entitlements");
// mock.module rewrites the live namespace, so keep the real function first.
const realEntitlements = entitlements.getOrganizationEntitlements;
mock.module("../billing/entitlements", () => ({
  ...entitlements,
  getOrganizationEntitlements: async (organizationId: string) => ({
    ...(await realEntitlements(organizationId)),
    subscribedContactsLimit,
  }),
}));

const { db } = await import("../db/client");
const { contactCustomFieldValues, contacts } = await import("../db/schema");
const { addOrStrengthenSuppression, getActiveSuppression } = await import(
  "../delivery-feedback/suppression-queries"
);
const { seedTeamAndContact, truncateAll } = await import("../test/db");
type TestDb = import("../test/db").TestDb;
const { importContacts } = await import("./import");
const { exportContactsCsv, csvCell } = await import("./export");

const tdb = db as unknown as TestDb;

beforeEach(async () => {
  await truncateAll(tdb);
  subscribedContactsLimit = null;
});

async function contactByEmail(email: string) {
  const [row] = await tdb.select().from(contacts).where(eq(contacts.email, email));
  return row;
}

describe("importContacts", () => {
  it("maps a beehiiv export's statuses", async () => {
    const { team } = await seedTeamAndContact(tdb);

    const result = await importContacts({
      teamId: team.id,
      contacts: [
        { row: 2, email: "Active@Example.com", status: "Active" },
        { row: 3, email: "paused@example.com", status: "Paused" },
        { row: 4, email: "inactive@example.com", status: "Inactive" },
        { row: 5, email: "bounced@example.com", status: "Bounced" },
        { row: 6, email: "pending@example.com", status: "Pending" },
        { row: 7, email: "approval@example.com", status: "Needs Approval" },
        { row: 8, email: "weird@example.com", status: "Frozen" },
        { row: 9, email: "not-an-email", status: "Active" },
        { row: 10, email: "active@example.com", status: "Active" },
      ],
      tags: ["beehiiv"],
    });

    expect(result).toMatchObject({
      created: 4,
      updated: 0,
      unchanged: 0,
      suppressed: 1,
    });
    expect(result.skipped).toEqual([
      { row: 6, email: "pending@example.com", reason: "pending_confirmation" },
      { row: 7, email: "approval@example.com", reason: "pending_confirmation" },
      { row: 8, email: "weird@example.com", reason: "unknown_status" },
      { row: 9, email: "not-an-email", reason: "invalid_email" },
      { row: 10, email: "active@example.com", reason: "duplicate" },
    ]);
    expect(await contactByEmail("active@example.com")).toMatchObject({
      subscribed: true,
      tags: ["beehiiv"],
    });
    expect(await contactByEmail("paused@example.com")).toMatchObject({
      subscribed: true,
      tags: ["beehiiv", "paused"],
    });
    expect((await contactByEmail("inactive@example.com")).subscribed).toBe(false);
    expect((await contactByEmail("bounced@example.com")).subscribed).toBe(false);
    expect((await getActiveSuppression(team.id, "bounced@example.com"))?.reason).toBe(
      "hard_bounce",
    );
  });

  it("imports pending contacts unsubscribed when asked", async () => {
    const { team } = await seedTeamAndContact(tdb);
    const result = await importContacts({
      teamId: team.id,
      contacts: [{ email: "pending@example.com", status: "Pending" }],
      pending: "unsubscribed",
    });
    expect(result.created).toBe(1);
    expect(await contactByEmail("pending@example.com")).toMatchObject({
      subscribed: false,
      tags: ["pending"],
    });
  });

  it("never re-subscribes and keeps suppressed addresses unsubscribed", async () => {
    const { team } = await seedTeamAndContact(tdb);
    await importContacts({
      teamId: team.id,
      contacts: [
        { email: "left@example.com", status: "unsubscribed" },
        { email: "stays@example.com", status: "subscribed" },
      ],
    });
    await addOrStrengthenSuppression({
      teamId: team.id,
      recipientEmail: "complainer@example.com",
      reason: "complaint",
      actorType: "system",
    });

    const result = await importContacts({
      teamId: team.id,
      contacts: [
        { email: "left@example.com", status: "Active" },
        { email: "stays@example.com", status: "cleaned" },
        { email: "complainer@example.com", status: "Active" },
      ],
    });

    expect(result).toMatchObject({
      created: 1,
      updated: 1,
      unchanged: 1,
      suppressed: 1,
    });
    expect((await contactByEmail("left@example.com")).subscribed).toBe(false);
    expect((await contactByEmail("stays@example.com")).subscribed).toBe(false);
    expect((await contactByEmail("complainer@example.com")).subscribed).toBe(false);
  });

  it("merges tags and custom fields, indexes them and keeps the earliest signup", async () => {
    const { team } = await seedTeamAndContact(tdb);
    await importContacts({
      teamId: team.id,
      contacts: [
        {
          email: "reader@example.com",
          tags: ["a"],
          customFields: { plan: "free" },
          createdAt: "2024-03-01T00:00:00Z",
        },
      ],
    });
    const result = await importContacts({
      teamId: team.id,
      contacts: [
        {
          email: "reader@example.com",
          name: "Reader",
          tags: ["b"],
          customFields: { city: "Pune" },
          createdAt: "2023-01-15T00:00:00Z",
        },
      ],
    });

    expect(result.updated).toBe(1);
    const reader = await contactByEmail("reader@example.com");
    expect(reader).toMatchObject({
      name: "Reader",
      tags: ["a", "b"],
      customFields: { plan: "free", city: "Pune" },
      subscribed: true,
    });
    expect(reader.createdAt?.toISOString()).toBe("2023-01-15T00:00:00.000Z");
    const indexed = await tdb
      .select({ key: contactCustomFieldValues.key })
      .from(contactCustomFieldValues)
      .where(eq(contactCustomFieldValues.contactId, reader.id));
    expect(indexed.map((row) => row.key).sort()).toEqual(["city", "plan"]);

    const again = await importContacts({
      teamId: team.id,
      contacts: [{ email: "reader@example.com", tags: ["a"] }],
    });
    expect(again.unchanged).toBe(1);
  });

  it("skips new subscribed contacts beyond the plan's limit", async () => {
    const { team } = await seedTeamAndContact(tdb);
    subscribedContactsLimit = 2;

    const result = await importContacts({
      teamId: team.id,
      contacts: [
        { email: "one@example.com" },
        { email: "two@example.com" },
        { email: "gone@example.com", status: "unsubscribed" },
      ],
    });

    // The seeded contact already uses one of the two slots.
    expect(result.created).toBe(2);
    expect(result.skipped).toEqual([
      { email: "two@example.com", reason: "plan_limit_reached" },
    ]);
  });
});

describe("exportContactsCsv", () => {
  it("exports statuses, tags, custom fields and suppressions in importable columns", async () => {
    const { team } = await seedTeamAndContact(tdb);
    await tdb.delete(contacts).where(eq(contacts.teamId, team.id));
    await importContacts({
      teamId: team.id,
      contacts: [
        {
          email: "a@example.com",
          name: "Ann, Jr.",
          tags: ["x", "y"],
          customFields: { city: "Pune" },
          createdAt: "2024-01-02T03:04:05Z",
        },
        { email: "b@example.com", status: "complained" },
        { email: "c@example.com", name: "=HYPERLINK(1)", status: "unsubscribed" },
      ],
    });

    const { csv, count } = await exportContactsCsv({ teamId: team.id });
    const lines = csv.trimEnd().split("\r\n");

    expect(count).toBe(3);
    expect(lines[0]).toBe("email,name,status,tags,created_at,suppression_reason,city");
    expect(lines).toContain(
      'a@example.com,"Ann, Jr.",subscribed,"x, y",2024-01-02T03:04:05.000Z,,Pune',
    );
    expect(lines.find((line) => line.startsWith("b@"))).toContain(
      "b@example.com,,complained,",
    );
    expect(lines.find((line) => line.startsWith("b@"))).toContain(",complaint,");
    expect(lines.find((line) => line.startsWith("c@"))).toContain(
      "c@example.com,'=HYPERLINK(1),unsubscribed",
    );
  });

  it("quotes and defuses cells", () => {
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell("-1+1")).toBe("'-1+1");
    expect(csvCell(null)).toBe("");
  });
});
