import { beforeEach, describe, expect, it, mock } from "bun:test";

mock.module("../db/client", async () => {
  const { makeTestDb } = await import("../test/db");
  return { db: await makeTestDb() };
});

const { and, eq } = await import("drizzle-orm");
const { EventType } = await import("../config/constants");
const { db } = await import("../db/client");
const schema = await import("../db/schema");
const { seedTeamAndContact, truncateAll } = await import("../test/db");
const { seedSequence } = await import("../test/fixtures");
const { updateSequence } = await import("../sequences/queries");
const {
  createEventDefinition,
  deleteEventDefinition,
  EventsError,
  listContactEvents,
  listEventDefinitions,
  matchEventTriggers,
  trackEvent,
} = await import("./queries");
type TestDb = import("../test/db").TestDb;

const tdb = db as unknown as TestDb;

beforeEach(async () => {
  await truncateAll(tdb);
});

/** An active sequence listening for `trigger` (and its rule, as
 * `startSequence` would write it). */
async function seedTriggeredSequence(
  teamId: string,
  {
    triggerType = EventType.CUSTOM_EVENT,
    triggerData = "course purchased",
    triggerFilter = null,
    reentry = "every_time",
    reentryPeriodDays = null,
    status = "active",
  }: {
    triggerType?: string;
    triggerData?: string | null;
    triggerFilter?: unknown;
    reentry?: string;
    reentryPeriodDays?: number | null;
    status?: string;
  } = {},
) {
  const { sequenceRow } = await seedSequence(tdb, {
    teamId,
    status,
    emails: [{ emailId: `email_${crypto.randomUUID()}` }],
  });
  await tdb
    .update(schema.sequences)
    .set({ triggerType, triggerData, triggerFilter, reentry, reentryPeriodDays })
    .where(eq(schema.sequences.id, sequenceRow.id));
  if (status === "active") {
    await tdb.insert(schema.rules).values({
      teamId,
      sequenceId: sequenceRow.id,
      event: triggerType,
      eventData: triggerData,
      eventFilter: triggerFilter,
    });
  }
  return sequenceRow;
}

async function ongoingFor(sequenceId: string) {
  return tdb
    .select()
    .from(schema.ongoingSequences)
    .where(eq(schema.ongoingSequences.sequenceId, sequenceId));
}

async function finish(sequenceId: string) {
  await tdb
    .delete(schema.ongoingSequences)
    .where(eq(schema.ongoingSequences.sequenceId, sequenceId));
}

const track = (teamId: string, body: Record<string, unknown>) =>
  trackEvent({
    teamId,
    source: "api",
    body: { eventName: "course purchased", ...body } as any,
  });

describe("trackEvent", () => {
  it("stores the event and enrolls only matching active sequences, with the payload", async () => {
    const { team, contact } = await seedTeamAndContact(tdb);
    const matching = await seedTriggeredSequence(team.id);
    const otherName = await seedTriggeredSequence(team.id, {
      triggerData: "trial ending",
    });
    const paused = await seedTriggeredSequence(team.id, { status: "paused" });

    const result = await track(team.id, {
      email: contact.email,
      properties: { courseName: "Rust 101" },
    });

    expect(result).toEqual(
      expect.objectContaining({ contactId: contact.contactId, duplicate: false }),
    );
    expect(result.eventId).toStartWith("evt_");
    const [ongoing] = await ongoingFor(matching.id);
    expect(ongoing?.triggerEvent).toEqual(
      expect.objectContaining({
        eventId: result.eventId,
        name: "course purchased",
        properties: { courseName: "Rust 101" },
      }),
    );
    expect(await ongoingFor(otherName.id)).toHaveLength(0);
    expect(await ongoingFor(paused.id)).toHaveLength(0);

    const timeline = await listContactEvents(contact.id, {});
    expect(timeline.total).toBe(1);
    expect(timeline.items[0]?.enrolledSequences).toEqual([
      { sequenceId: matching.sequenceId, title: matching.title },
    ]);
  });

  it("creates an unknown contact by default and fires subscriber:added once", async () => {
    const { team } = await seedTeamAndContact(tdb);
    const welcome = await seedTriggeredSequence(team.id, {
      triggerType: EventType.SUBSCRIBER_ADDED,
      triggerData: null,
    });
    const purchase = await seedTriggeredSequence(team.id);

    const result = await track(team.id, {
      email: "new@example.com",
      contact: { name: "New", customFields: { plan: "pro" } },
    });

    expect(result.contactCreated).toBe(true);
    const [created] = await tdb
      .select()
      .from(schema.contacts)
      .where(eq(schema.contacts.contactId, result.contactId));
    expect(created?.name).toBe("New");
    expect(created?.customFields).toEqual({ plan: "pro" });
    expect(await ongoingFor(welcome.id)).toHaveLength(1);
    expect(await ongoingFor(purchase.id)).toHaveLength(1);
  });

  it("returns contact_not_found without creating anything", async () => {
    const { team } = await seedTeamAndContact(tdb);
    const other = await seedTeamAndContact(tdb);

    await expect(
      track(team.id, { email: "nobody@example.com", createContact: false }),
    ).rejects.toThrow(new EventsError("contact_not_found"));
    await expect(track(team.id, { contactId: "cnt_missing" })).rejects.toThrow(
      "contact_not_found",
    );
    await expect(
      track(team.id, { contactId: other.contact.contactId }),
    ).rejects.toThrow("contact_not_found");
    expect(await tdb.select().from(schema.contactEvents)).toHaveLength(0);
  });

  it("stores an idempotent replay once and enrolls once", async () => {
    const { team, contact } = await seedTeamAndContact(tdb);
    const sequence = await seedTriggeredSequence(team.id);

    const first = await track(team.id, {
      email: contact.email,
      idempotencyKey: "order_1",
    });
    await finish(sequence.id);
    const second = await track(team.id, {
      email: contact.email,
      idempotencyKey: "order_1",
      contact: { customFields: { plan: "pro" } },
    });

    expect(second).toEqual({ ...first, duplicate: true, contactCreated: false });
    expect(await tdb.select().from(schema.contactEvents)).toHaveLength(1);
    expect(await ongoingFor(sequence.id)).toHaveLength(0);
    const [unchanged] = await tdb
      .select()
      .from(schema.contacts)
      .where(eq(schema.contacts.id, contact.id));
    expect(unchanged?.customFields).toEqual(contact.customFields);
  });

  it("records backfilled and stale events without firing anything", async () => {
    const { team } = await seedTeamAndContact(tdb);
    const welcome = await seedTriggeredSequence(team.id, {
      triggerType: EventType.SUBSCRIBER_ADDED,
      triggerData: null,
    });
    const purchase = await seedTriggeredSequence(team.id);

    const backfilled = await track(team.id, {
      email: "old@example.com",
      backfill: true,
    });
    const stale = await track(team.id, {
      email: "older@example.com",
      occurredAt: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString(),
    });

    expect(backfilled.contactCreated).toBe(true);
    expect(stale.contactCreated).toBe(true);
    expect(await ongoingFor(welcome.id)).toHaveLength(0);
    expect(await ongoingFor(purchase.id)).toHaveLength(0);
    const events = await tdb.select().from(schema.contactEvents);
    expect(events.every((event) => !event.triggers && event.processedAt)).toBe(true);
  });

  it("merges contact custom fields instead of replacing them", async () => {
    const { team, contact } = await seedTeamAndContact(tdb, {
      contact: { customFields: { plan: "free", seats: 2 } },
    });
    await track(team.id, {
      email: contact.email,
      contact: { customFields: { plan: "pro" } },
    });
    const [row] = await tdb
      .select()
      .from(schema.contacts)
      .where(eq(schema.contacts.id, contact.id));
    expect(row?.customFields).toEqual({ plan: "pro", seats: 2 });
  });

  it("applies the trigger's property filter, including dashboard string values", async () => {
    const { team, contact } = await seedTeamAndContact(tdb);
    const sequence = await seedTriggeredSequence(team.id, {
      triggerFilter: {
        aggregator: "and",
        filters: [{ key: "amount", condition: "gt", value: "100" }],
      },
    });

    await track(team.id, { email: contact.email, properties: { amount: 50 } });
    expect(await ongoingFor(sequence.id)).toHaveLength(0);
    await track(team.id, { email: contact.email, properties: { amount: 150 } });
    expect(await ongoingFor(sequence.id)).toHaveLength(1);
  });

  it("refuses a new name past the per-team limit and rolls back the contact", async () => {
    const { team } = await seedTeamAndContact(tdb);
    await tdb.insert(schema.eventDefinitions).values(
      Array.from({ length: 500 }, (_, i) => ({
        teamId: team.id,
        name: `event ${i}`,
        origin: "manual",
      })),
    );
    await expect(track(team.id, { email: "late@example.com" })).rejects.toThrow(
      "event_name_limit_reached",
    );
    const [created] = await tdb
      .select()
      .from(schema.contacts)
      .where(eq(schema.contacts.email, "late@example.com"));
    expect(created).toBeUndefined();
    // A name that's already registered still works.
    await expect(
      track(team.id, { email: "late@example.com", eventName: "event 1" }),
    ).resolves.toEqual(expect.objectContaining({ contactCreated: true }));
  });
});

describe("re-entry", () => {
  it("every_time re-enrolls after finishing, but never twice from one event", async () => {
    const { team, contact } = await seedTeamAndContact(tdb);
    const sequence = await seedTriggeredSequence(team.id);

    await track(team.id, { email: contact.email });
    // An event while the contact is in the sequence doesn't restart it.
    await track(team.id, { email: contact.email });
    expect(await ongoingFor(sequence.id)).toHaveLength(1);
    const matches = await tdb.select().from(schema.contactEventMatches);
    expect(matches.map((m) => m.enrolled).sort()).toEqual([false, true]);

    await finish(sequence.id);
    // The recovery sweep running again on the first event must not re-enroll.
    const [firstEvent] = await tdb
      .select()
      .from(schema.contactEvents)
      .orderBy(schema.contactEvents.createdAt)
      .limit(1);
    await matchEventTriggers(firstEvent!);
    expect(await ongoingFor(sequence.id)).toHaveLength(0);

    await track(team.id, { email: contact.email });
    expect(await ongoingFor(sequence.id)).toHaveLength(1);
  });

  it("once never re-enrolls after the first entry", async () => {
    const { team, contact } = await seedTeamAndContact(tdb);
    const sequence = await seedTriggeredSequence(team.id, { reentry: "once" });

    await track(team.id, { email: contact.email });
    await finish(sequence.id);
    await track(team.id, { email: contact.email });

    expect(await ongoingFor(sequence.id)).toHaveLength(0);
    const [entry] = await tdb
      .select()
      .from(schema.sequenceEntries)
      .where(eq(schema.sequenceEntries.sequenceId, sequence.id));
    expect(entry?.entryCount).toBe(1);
  });

  it("once_per_period waits for the period", async () => {
    const { team, contact } = await seedTeamAndContact(tdb);
    const sequence = await seedTriggeredSequence(team.id, {
      reentry: "once_per_period",
      reentryPeriodDays: 7,
    });
    const entryWhere = and(
      eq(schema.sequenceEntries.sequenceId, sequence.id),
      eq(schema.sequenceEntries.contactId, contact.id),
    );

    await track(team.id, { email: contact.email });
    await finish(sequence.id);
    // Day 3: refused.
    await tdb
      .update(schema.sequenceEntries)
      .set({ lastEnteredAt: new Date(Date.now() - 3 * 86_400_000) })
      .where(entryWhere);
    await track(team.id, { email: contact.email });
    expect(await ongoingFor(sequence.id)).toHaveLength(0);
    // Day 8: allowed.
    await tdb
      .update(schema.sequenceEntries)
      .set({ lastEnteredAt: new Date(Date.now() - 8 * 86_400_000) })
      .where(entryWhere);
    await track(team.id, { email: contact.email });
    expect(await ongoingFor(sequence.id)).toHaveLength(1);
  });
});

describe("event definitions", () => {
  it("registers by hand, keeps declared types when received, and blocks deleting while used", async () => {
    const { team, contact } = await seedTeamAndContact(tdb);
    const created = await createEventDefinition(team.id, {
      name: "trial ending",
      properties: [{ key: "daysLeft", type: "number" }],
    });
    expect(created).toEqual(
      expect.objectContaining({
        origin: "manual",
        firstSeenAt: null,
        sequenceCount: 0,
      }),
    );
    await expect(
      createEventDefinition(team.id, { name: "trial ending" }),
    ).rejects.toThrow("event_definition_exists");

    await track(team.id, {
      email: contact.email,
      eventName: "trial ending",
      properties: { daysLeft: "3", plan: "pro" },
    });
    const [listed] = await listEventDefinitions(team.id);
    expect(listed?.origin).toBe("manual");
    expect(listed?.firstSeenAt).not.toBeNull();
    expect(listed?.properties).toEqual([
      { key: "daysLeft", type: "number", declared: true },
      { key: "plan", type: "string", declared: false },
    ]);

    await seedTriggeredSequence(team.id, { triggerData: "trial ending" });
    await expect(deleteEventDefinition(team.id, "trial ending")).rejects.toThrow(
      "event_definition_in_use",
    );
  });
});

describe("updateSequence trigger validation", () => {
  it("refreshes the rule of an active sequence and validates against the stored type", async () => {
    const { team } = await seedTeamAndContact(tdb);
    const sequence = await seedTriggeredSequence(team.id);

    await updateSequence({
      teamId: team.id,
      sequenceId: sequence.sequenceId,
      triggerData: " trial ending ",
    });
    const rules = await tdb
      .select()
      .from(schema.rules)
      .where(eq(schema.rules.sequenceId, sequence.id));
    expect(rules.map((rule) => rule.eventData)).toEqual(["trial ending"]);

    await expect(
      updateSequence({
        teamId: team.id,
        sequenceId: sequence.sequenceId,
        triggerType: EventType.TAG_ADDED,
        triggerFilter: {
          aggregator: "and",
          filters: [{ key: "a", condition: "exists" }],
        },
      }),
    ).rejects.toThrow("invalid_trigger_filter");

    const { sequenceRow: broadcast } = await seedSequence(tdb, {
      teamId: team.id,
      type: "broadcast",
      status: "draft",
      emails: [{ emailId: `email_${crypto.randomUUID()}` }],
    });
    await expect(
      updateSequence({
        teamId: team.id,
        sequenceId: broadcast.sequenceId,
        triggerType: EventType.CUSTOM_EVENT,
      }),
    ).rejects.toThrow("invalid_trigger_type");
    await expect(
      updateSequence({
        teamId: team.id,
        sequenceId: broadcast.sequenceId,
        reentry: "once",
      }),
    ).rejects.toThrow("invalid_reentry");
  });
});
