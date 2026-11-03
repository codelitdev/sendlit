import { beforeEach, describe, expect, it, mock, vi } from "bun:test";
import { eq } from "drizzle-orm";

mock.module("../db/client", async () => {
  const { makeTestDb } = await import("../test/db");
  return { db: await makeTestDb() };
});

const mocks = {
  fireEvent: vi.fn(async () => undefined),
  captureEvent: vi.fn(),
  queueAdd: vi.fn(async () => undefined),
  getJob: vi.fn(async (_id: string): Promise<any> => null),
};
mock.module("../automation/fire-event", () => ({ fireEvent: mocks.fireEvent }));
mock.module("../services/redis", () => ({ default: {} }));
mock.module("bullmq", () => ({
  Queue: class {
    add = mocks.queueAdd;
    getJob = mocks.getJob;
  },
}));
const observability = await import("../observability");
mock.module("../observability", () => ({
  ...observability,
  captureEvent: mocks.captureEvent,
}));

const { db } = await import("../db/client");
const { contactCustomFieldValues, contacts, ongoingSequences, segments } = await import(
  "../db/schema"
);
const { getActiveSuppression, addOrStrengthenSuppression, isRecipientSuppressed } =
  await import("../delivery-feedback/suppression-queries");
const { seedTeamAndContact, truncateAll } = await import("../test/db");
const { seedSequence } = await import("../test/fixtures");
const { importContacts } = await import("./import");
const { createContact, deleteContact } = await import("./queries");
const { countSelection, selectionCondition, UNSUBSCRIBED_DELETED_EXPLANATION } =
  await import("./bulk-delete");
const { getContactDeletion, processContactDeletionJob, startContactDeletion } =
  await import("./deletion-queue");
type TestDb = import("../test/db").TestDb;

const tdb = db as unknown as TestDb;

beforeEach(async () => {
  await truncateAll(tdb);
  for (const fn of Object.values(mocks)) fn.mockClear();
});

async function seedContacts(
  teamId: string,
  rows: { email: string; subscribed?: boolean; tags?: string[] }[],
) {
  return tdb
    .insert(contacts)
    .values(
      rows.map((row) => ({
        teamId,
        email: row.email,
        subscribed: row.subscribed ?? true,
        tags: row.tags ?? [],
        unsubscribeToken: crypto.randomUUID(),
      })),
    )
    .returning();
}

async function remainingEmails(teamId: string) {
  const rows = await tdb
    .select({ email: contacts.email })
    .from(contacts)
    .where(eq(contacts.teamId, teamId));
  return rows.map((row) => row.email).sort();
}

describe("bulk contact deletion", () => {
  it("deletes an explicit list of ids within the team only", async () => {
    const { team, contact } = await seedTeamAndContact(tdb);
    const other = await seedTeamAndContact(tdb);
    const [a, b] = await seedContacts(team.id, [
      { email: "a@example.com" },
      { email: "b@example.com" },
    ]);
    await tdb.insert(contactCustomFieldValues).values({
      teamId: team.id,
      contactId: a.id,
      key: "plan",
      valueType: "string",
      valueText: "pro",
    });

    const result = await startContactDeletion({
      teamId: team.id,
      // The other team's contact id must be ignored.
      selection: { contactIds: [a.contactId, b.contactId, other.contact.contactId] },
    });

    expect(result).toEqual({
      status: 200,
      body: {
        deletionId: null,
        status: "completed",
        count: 2,
        deleted: 2,
        suppressed: 0,
      },
    });
    expect(await remainingEmails(team.id)).toEqual([contact.email]);
    expect(await remainingEmails(other.team.id)).toEqual([other.contact.email]);
    expect(await tdb.select().from(contactCustomFieldValues)).toEqual([]);
    expect(mocks.captureEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "contacts_bulk_deleted",
        teamId: team.id,
        properties: { kind: "ids", count: 2, suppressed_count: 0 },
      }),
    );
  });

  it("previews and deletes by filter and by saved segment", async () => {
    const { team } = await seedTeamAndContact(tdb, {
      contact: { email: "keep@example.com" },
    });
    await seedContacts(team.id, [
      { email: "t1@example.com", tags: ["cold"] },
      { email: "t2@example.com", tags: ["cold"], subscribed: false },
      { email: "t3@example.com", tags: ["warm"] },
    ]);
    const filter = {
      aggregator: "or" as const,
      filters: [{ name: "tag" as const, condition: "is" as const, value: "cold" }],
    };

    const preview = await selectionCondition(team.id, { match: { filter } });
    if ("error" in preview) throw new Error(preview.error);
    expect(await countSelection(preview.condition)).toEqual({
      count: 2,
      unsubscribed: 1,
    });

    expect(
      await startContactDeletion({
        teamId: team.id,
        selection: { match: { filter } },
        expectedCount: 2,
      }),
    ).toMatchObject({ status: 200, body: { deleted: 2, suppressed: 1 } });
    expect(await remainingEmails(team.id)).toEqual([
      "keep@example.com",
      "t3@example.com",
    ]);

    const [segment] = await tdb
      .insert(segments)
      .values({
        teamId: team.id,
        name: "Warm",
        filter: {
          aggregator: "or",
          filters: [{ name: "tag", condition: "is", value: "warm" }],
        },
      })
      .returning();
    expect(
      await startContactDeletion({
        teamId: team.id,
        selection: { match: { segmentId: segment.segmentId } },
        expectedCount: 1,
      }),
    ).toMatchObject({ status: 200, body: { deleted: 1 } });
    expect(await remainingEmails(team.id)).toEqual(["keep@example.com"]);
  });

  it("refuses when the live count differs from the preview", async () => {
    const { team } = await seedTeamAndContact(tdb);
    await seedContacts(team.id, [{ email: "new@example.com" }]);

    const result = await startContactDeletion({
      teamId: team.id,
      selection: { match: {} },
      expectedCount: 1,
    });

    expect(result).toEqual({ status: 409, body: { error: "count_changed", count: 2 } });
    expect(await remainingEmails(team.id)).toHaveLength(2);
  });

  it("404s for another team's segment", async () => {
    const { team } = await seedTeamAndContact(tdb);
    const other = await seedTeamAndContact(tdb);
    const [segment] = await tdb
      .insert(segments)
      .values({
        teamId: other.team.id,
        name: "Theirs",
        filter: { aggregator: "or", filters: [] },
      })
      .returning();

    expect(
      await startContactDeletion({
        teamId: team.id,
        selection: { match: { segmentId: segment.segmentId } },
        expectedCount: 0,
      }),
    ).toEqual({ status: 404, body: { error: "segment_not_found" } });
  });

  it("keeps deleted unsubscribers suppressed, so a re-import isn't mailable", async () => {
    const { team, account } = await seedTeamAndContact(tdb);
    const [unsub, bounced] = await seedContacts(team.id, [
      { email: "gone@example.com", subscribed: false },
      { email: "bounced@example.com", subscribed: false },
    ]);
    await addOrStrengthenSuppression({
      teamId: team.id,
      recipientEmail: "bounced@example.com",
      reason: "hard_bounce",
      actorType: "system",
    });

    const result = await startContactDeletion({
      teamId: team.id,
      selection: { contactIds: [unsub.contactId, bounced.contactId] },
      actorUserId: account.id,
    });

    // Only the address without a suppression gets a new one; the bounce is kept.
    expect(result).toMatchObject({ body: { deleted: 2, suppressed: 1 } });
    expect(await getActiveSuppression(team.id, "gone@example.com")).toMatchObject({
      reason: "manual",
      active: true,
    });
    expect(await getActiveSuppression(team.id, "bounced@example.com")).toMatchObject({
      reason: "hard_bounce",
    });

    const imported = await importContacts({
      teamId: team.id,
      contacts: [{ email: "gone@example.com", status: "subscribed" }],
    });
    expect(imported.created).toBe(1);
    const [reimported] = await tdb
      .select()
      .from(contacts)
      .where(eq(contacts.email, "gone@example.com"));
    expect(reimported.subscribed).toBe(false);
    expect(await isRecipientSuppressed(team.id, "gone@example.com")).toBe(true);

    // Re-adding it by hand still can't be mailed: sends check the list.
    await deleteContact(team.id, reimported.contactId);
    await createContact({ teamId: team.id, email: "gone@example.com" });
    expect(await isRecipientSuppressed(team.id, "gone@example.com")).toBe(true);
  });

  it("single deletes also keep an unsubscriber suppressed", async () => {
    const { team } = await seedTeamAndContact(tdb);
    const [row] = await seedContacts(team.id, [
      { email: "once@example.com", subscribed: false },
    ]);

    await deleteContact(team.id, row.contactId);

    const suppression = await getActiveSuppression(team.id, "once@example.com");
    expect(suppression).toMatchObject({ reason: "manual", active: true });
  });

  it("fires no sequence events and drops sequence progress", async () => {
    const { team, contact } = await seedTeamAndContact(tdb, {
      contact: { tags: ["vip"] },
    });
    const { sequenceRow: sequence } = await seedSequence(tdb, {
      teamId: team.id,
      emails: [{ emailId: "email_e1" }],
    });
    await tdb.insert(ongoingSequences).values({
      teamId: team.id,
      sequenceId: sequence.id,
      contactId: contact.id,
      nextEmailScheduledTime: Date.now(),
    });

    await startContactDeletion({
      teamId: team.id,
      selection: { match: {} },
      expectedCount: 1,
    });

    expect(mocks.fireEvent).not.toHaveBeenCalled();
    expect(await tdb.select().from(ongoingSequences)).toEqual([]);
  });

  it("queues large selections and runs them as a resumable job", async () => {
    const { team } = await seedTeamAndContact(tdb, {
      contact: { email: "keep@example.com", tags: ["keep"] },
    });
    await seedContacts(
      team.id,
      Array.from({ length: 1205 }, (_, index) => ({
        email: `bulk${index}@example.com`,
        subscribed: index % 100 !== 0,
      })),
    );
    const filter = {
      aggregator: "and" as const,
      filters: [
        { name: "email" as const, condition: "contains" as const, value: "bulk" },
      ],
    };

    const result = await startContactDeletion({
      teamId: team.id,
      selection: { match: { filter } },
      expectedCount: 1205,
    });

    expect(result.status).toBe(202);
    const body = result.body as { deletionId: string };
    expect(body).toMatchObject({ status: "queued", count: 1205, deleted: 0 });
    expect(body.deletionId).toStartWith("cdel_");
    expect(await remainingEmails(team.id)).toHaveLength(1206);
    const [, data, options] = (mocks.queueAdd as ReturnType<typeof vi.fn>).mock
      .calls[0] as any[];
    expect(options).toEqual({ jobId: body.deletionId });

    // A contact added after the request is left alone.
    await seedContacts(team.id, [{ email: "bulk-late@example.com" }]);

    // Simulate a retry that resumes after a first attempt deleted 5.
    const progress: unknown[] = [];
    const job = {
      id: body.deletionId,
      data,
      progress: { deleted: 5, suppressed: 0 } as unknown,
      updateProgress: vi.fn(async (value: unknown) => {
        progress.push(value);
      }),
    };
    const total = await processContactDeletionJob(job as any);

    expect(total).toEqual({ deleted: 1210, suppressed: 13 });
    expect(progress.length).toBeGreaterThan(2);
    expect(await remainingEmails(team.id)).toEqual([
      "bulk-late@example.com",
      "keep@example.com",
    ]);
    expect(await isRecipientSuppressed(team.id, "bulk100@example.com")).toBe(true);
    expect(mocks.fireEvent).not.toHaveBeenCalled();
  });

  it("reports a job's status to its own team only", async () => {
    const { team } = await seedTeamAndContact(tdb);
    const job = {
      data: { teamId: team.id, count: 2000 },
      progress: { deleted: 500, suppressed: 3 },
      returnvalue: null,
      getState: async () => "active",
    };
    (mocks.getJob as ReturnType<typeof vi.fn>).mockResolvedValue(job);

    expect(await getContactDeletion(team.id, "cdel_x")).toEqual({
      deletionId: "cdel_x",
      status: "running",
      count: 2000,
      deleted: 500,
      suppressed: 3,
    });
    expect(await getContactDeletion("another-team", "cdel_x")).toBeNull();

    job.getState = async () => "completed";
    (job as any).returnvalue = { deleted: 2000, suppressed: 4 };
    expect(await getContactDeletion(team.id, "cdel_x")).toMatchObject({
      status: "completed",
      deleted: 2000,
      suppressed: 4,
    });
    expect(UNSUBSCRIBED_DELETED_EXPLANATION).toBeTruthy();
  });
});
