import {
  type CustomFields,
  EVENT_DEFINITIONS_MAX,
  EVENT_PROPERTIES_MAX_KEYS,
  EVENT_STALE_AFTER_MS,
  type TrackEventBody,
} from "@sendlit/api-contract";
import { and, count, desc, eq, inArray, isNull, lt, sql } from "drizzle-orm";
import { fireEvent } from "../automation/fire-event";
import { EventType } from "../config/constants";
import {
  afterContactCreated,
  afterContactUpdated,
  type Contact,
  createContactInTx,
  findContactByEmail,
  getContactByContactId,
  updateContactInTx,
} from "../contacts/queries";
import { db } from "../db/client";
import {
  contactEventMatches,
  contactEvents,
  type EventDefinitionProperty,
  type EventPropertyType,
  eventDefinitions,
  sequences,
} from "../db/schema";
import { captureError, captureEvent } from "../observability";
import logger from "../services/log";

/** Custom events — see docs/custom_events.md. */

export type ContactEventRow = typeof contactEvents.$inferSelect;
export type EventDefinitionRow = typeof eventDefinitions.$inferSelect;
export type EventSource = "api" | "session" | "mcp";
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** An expected failure; `code` is the API error code. */
export class EventsError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

class IdempotentReplay extends Error {}

export type TrackEventResult = {
  eventId: string;
  contactId: string;
  duplicate: boolean;
  contactCreated: boolean;
};

const ISO_DATE =
  /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;

export function inferPropertyType(value: unknown): EventPropertyType | null {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) return "array";
  if (typeof value === "number") return "number";
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "object") return "object";
  if (
    typeof value === "string" &&
    ISO_DATE.test(value) &&
    !Number.isNaN(Date.parse(value))
  ) {
    return "date";
  }
  return "string";
}

/** Adds newly observed top-level keys; declared entries always win. */
export function mergeObservedProperties(
  existing: EventDefinitionProperty[],
  properties: Record<string, unknown>,
): EventDefinitionProperty[] {
  const merged = [...existing];
  const known = new Set(existing.map((p) => p.key));
  for (const [key, value] of Object.entries(properties)) {
    if (known.has(key) || merged.length >= EVENT_PROPERTIES_MAX_KEYS) continue;
    const type = inferPropertyType(value);
    if (!type) continue;
    merged.push({ key, type, declared: false });
    known.add(key);
  }
  return merged;
}

async function lockTeamDefinitions(tx: Tx, teamId: string) {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtext(${`event_definitions:${teamId}`}))`,
  );
}

/** Enforces the per-team name cap for a name that isn't registered yet.
 * The advisory lock serializes new names per team; `ON CONFLICT` alone
 * can't enforce a count. */
async function assertRoomForNewName(tx: Tx, teamId: string) {
  await lockTeamDefinitions(tx, teamId);
  const [row] = await tx
    .select({ value: count() })
    .from(eventDefinitions)
    .where(eq(eventDefinitions.teamId, teamId));
  if ((row?.value ?? 0) >= EVENT_DEFINITIONS_MAX) {
    throw new EventsError("event_name_limit_reached");
  }
}

async function recordDefinitionInTx(
  tx: Tx,
  {
    teamId,
    name,
    properties,
    triggers,
    seenAt,
  }: {
    teamId: string;
    name: string;
    properties: Record<string, unknown>;
    triggers: boolean;
    seenAt: Date;
  },
) {
  const [existing] = await tx
    .select()
    .from(eventDefinitions)
    .where(and(eq(eventDefinitions.teamId, teamId), eq(eventDefinitions.name, name)))
    .limit(1)
    .for("update");
  if (existing) {
    await tx
      .update(eventDefinitions)
      .set({
        properties: mergeObservedProperties(existing.properties, properties),
        firstSeenAt: existing.firstSeenAt ?? seenAt,
        lastSeenAt: seenAt,
        ...(triggers && { lastProperties: properties }),
      })
      .where(eq(eventDefinitions.id, existing.id));
    return;
  }
  await assertRoomForNewName(tx, teamId);
  await tx
    .insert(eventDefinitions)
    .values({
      teamId,
      name,
      origin: "received",
      properties: mergeObservedProperties([], properties),
      lastProperties: triggers ? properties : null,
      firstSeenAt: seenAt,
      lastSeenAt: seenAt,
    })
    .onConflictDoNothing();
}

async function findByIdempotencyKey(teamId: string, key: string) {
  const [row] = await db
    .select({ event: contactEvents, contactPublicId: sql<string>`c.contact_id` })
    .from(contactEvents)
    .innerJoin(sql`contacts c`, sql`c.id = ${contactEvents.contactId}`)
    .where(and(eq(contactEvents.teamId, teamId), eq(contactEvents.idempotencyKey, key)))
    .limit(1);
  return row ?? null;
}

function replayResult(row: { event: ContactEventRow; contactPublicId: string }) {
  return {
    eventId: row.event.eventId,
    contactId: row.contactPublicId,
    duplicate: true,
    contactCreated: false,
  };
}

/**
 * `POST /events`. Validation has already run against the contract schema
 * for REST callers; MCP callers pass the same schema in the tool.
 * See docs/custom_events.md#ingest-pipeline.
 */
export async function trackEvent({
  teamId,
  source,
  body,
}: {
  teamId: string;
  source: EventSource;
  body: TrackEventBody;
}): Promise<TrackEventResult> {
  const name = body.eventName;
  const properties = (body.properties ?? {}) as Record<string, unknown>;
  const receivedAt = new Date();
  const occurredAt = body.occurredAt ? new Date(body.occurredAt) : receivedAt;
  const stale = receivedAt.getTime() - occurredAt.getTime() > EVENT_STALE_AFTER_MS;
  const triggers = !body.backfill && !stale;

  // 1. Idempotency fast path.
  if (body.idempotencyKey) {
    const existing = await findByIdempotencyKey(teamId, body.idempotencyKey);
    if (existing) return replayResult(existing);
  }

  // 2. Resolve the contact (read only).
  let contact: Contact | null = null;
  if (body.contactId) {
    contact = await getContactByContactId(body.contactId);
    if (!contact || contact.teamId !== teamId)
      throw new EventsError("contact_not_found");
  } else if (body.email) {
    contact = await findContactByEmail(teamId, body.email);
    if (!contact && body.createContact === false) {
      throw new EventsError("contact_not_found");
    }
  }

  const contactPatch = body.contact
    ? {
        ...(body.contact.name !== undefined && { name: body.contact.name }),
        ...(body.contact.customFields && {
          customFields: body.contact.customFields as CustomFields,
        }),
      }
    : null;
  const hasPatch = !!contactPatch && Object.keys(contactPatch).length > 0;

  // 3. One transaction: contact create/update, name cap, event, definition.
  let outcome: {
    event: ContactEventRow;
    contact: Contact;
    created: boolean;
    updated: { row: Contact; previous: Contact } | null;
  };
  try {
    outcome = await db.transaction(async (tx) => {
      let current = contact;
      let created = false;
      let updated: { row: Contact; previous: Contact } | null = null;
      if (!current) {
        const result = await createContactInTx(tx, {
          teamId,
          email: body.email!,
          name: body.contact?.name,
          customFields: (body.contact?.customFields ?? {}) as CustomFields,
        });
        current = result.contact;
        created = result.created;
      }
      if (!created && hasPatch) {
        updated = await updateContactInTx(
          tx,
          teamId,
          current.contactId,
          contactPatch!,
          {
            mergeCustomFields: true,
          },
        );
        if (updated) current = updated.row;
      }

      const [event] = await tx
        .insert(contactEvents)
        .values({
          teamId,
          contactId: current.id,
          name,
          properties,
          occurredAt,
          idempotencyKey: body.idempotencyKey ?? null,
          backfill: !!body.backfill,
          triggers,
          source,
          processedAt: triggers ? null : receivedAt,
          createdAt: receivedAt,
        })
        .onConflictDoNothing({
          target: [contactEvents.teamId, contactEvents.idempotencyKey],
          where: sql`${contactEvents.idempotencyKey} IS NOT NULL`,
        })
        .returning();
      // A concurrent request with the same key won: undo everything this
      // one did (including a contact it created) and replay the winner.
      if (!event) throw new IdempotentReplay();

      await recordDefinitionInTx(tx, {
        teamId,
        name,
        properties,
        triggers,
        seenAt: receivedAt,
      });
      return { event, contact: current, created, updated };
    });
  } catch (err) {
    if (!(err instanceof IdempotentReplay)) throw err;
    const winner = await findByIdempotencyKey(teamId, body.idempotencyKey!);
    if (!winner) throw new Error("idempotency_conflict");
    return replayResult(winner);
  }

  // 4. After the commit. Backfilled and stale events fire nothing.
  if (outcome.created) {
    await afterContactCreated(outcome.contact, { fireTriggers: triggers });
  } else if (outcome.updated) {
    await afterContactUpdated(outcome.updated, { fireTriggers: triggers });
  }
  let enrolledCount = 0;
  if (triggers) {
    enrolledCount = (await matchEventTriggers(outcome.event)).length;
  }

  captureEvent({
    event: "custom_event_received",
    source: source === "mcp" ? "mcp.track_event" : "events.track",
    teamId,
    properties: {
      duplicate: false,
      contact_created: outcome.created,
      backfill: !!body.backfill,
      stale,
      sequences_enrolled: enrolledCount,
      event_source: source,
    },
  });

  return {
    eventId: outcome.event.eventId,
    contactId: outcome.contact.contactId,
    duplicate: false,
    contactCreated: outcome.created,
  };
}

/** Runs `event:custom` matching for a stored event, then marks it
 * processed. Safe to run twice: `contact_event_matches` allows one
 * enrollment per event and sequence. */
export async function matchEventTriggers(event: ContactEventRow): Promise<string[]> {
  const enrolled = await fireEvent({
    teamId: event.teamId,
    event: EventType.CUSTOM_EVENT,
    eventData: event.name,
    contactId: event.contactId,
    triggerEvent: {
      contactEventId: event.id,
      snapshot: {
        eventId: event.eventId,
        name: event.name,
        properties: event.properties,
        occurredAt: event.occurredAt.toISOString(),
      },
    },
  });
  await db
    .update(contactEvents)
    .set({ processedAt: new Date() })
    .where(eq(contactEvents.id, event.id));
  return enrolled;
}

const SWEEP_BATCH = 100;
const SWEEP_GRACE_MS = 2 * 60 * 1000;

/** Recovery sweep (60s rules loop): matches events whose inline matching
 * was cut off, e.g. by a crash between commit and match. */
export async function processUnmatchedEvents(): Promise<number> {
  const claimed = await db.transaction(async (tx) => {
    return tx
      .select()
      .from(contactEvents)
      .where(
        and(
          isNull(contactEvents.processedAt),
          lt(contactEvents.createdAt, new Date(Date.now() - SWEEP_GRACE_MS)),
        ),
      )
      .orderBy(contactEvents.createdAt)
      .limit(SWEEP_BATCH)
      .for("update", { skipLocked: true });
  });
  for (const event of claimed) {
    try {
      await matchEventTriggers(event);
    } catch (err: any) {
      logger.error({ error: err.message }, "event recovery sweep failed");
      captureError({
        error: err,
        source: "events.recovery_sweep",
        teamId: event.teamId,
      });
    }
  }
  return claimed.length;
}

export async function listContactEvents(
  contactInternalId: string,
  { page = 1, limit = 10, name }: { page?: number; limit?: number; name?: string },
) {
  const where = and(
    eq(contactEvents.contactId, contactInternalId),
    name ? eq(contactEvents.name, name) : undefined,
  );
  const [rows, [total]] = await Promise.all([
    db
      .select()
      .from(contactEvents)
      .where(where)
      .orderBy(desc(contactEvents.occurredAt), desc(contactEvents.id))
      .limit(limit)
      .offset((page - 1) * limit),
    db.select({ value: count() }).from(contactEvents).where(where),
  ]);
  const ids = rows.map((row) => row.id);
  const matches = ids.length
    ? await db
        .select({
          contactEventId: contactEventMatches.contactEventId,
          sequenceId: sequences.sequenceId,
          title: sequences.title,
        })
        .from(contactEventMatches)
        .innerJoin(sequences, eq(sequences.id, contactEventMatches.sequenceId))
        .where(
          and(
            inArray(contactEventMatches.contactEventId, ids),
            eq(contactEventMatches.enrolled, true),
          ),
        )
    : [];
  const items = rows.map((row) => ({
    eventId: row.eventId,
    name: row.name,
    properties: row.properties,
    occurredAt: row.occurredAt.toISOString(),
    receivedAt: row.createdAt.toISOString(),
    source: row.source as EventSource,
    backfill: row.backfill,
    triggers: row.triggers,
    enrolledSequences: matches
      .filter((match) => match.contactEventId === row.id)
      .map(({ sequenceId, title }) => ({ sequenceId, title })),
  }));
  return { items, total: total?.value ?? 0 };
}

// ---- Definitions --------------------------------------------------------

async function sequenceCounts(teamId: string, names?: string[]) {
  const rows = await db
    .select({ name: sequences.triggerData, value: count() })
    .from(sequences)
    .where(
      and(
        eq(sequences.teamId, teamId),
        eq(sequences.triggerType, EventType.CUSTOM_EVENT),
        names ? inArray(sequences.triggerData, names) : undefined,
      ),
    )
    .groupBy(sequences.triggerData);
  return new Map(rows.map((row) => [row.name ?? "", Number(row.value)]));
}

function toPublicDefinition(row: EventDefinitionRow, sequenceCount: number) {
  return {
    name: row.name,
    origin: row.origin as "received" | "manual",
    description: row.description,
    properties: row.properties,
    firstSeenAt: row.firstSeenAt?.toISOString() ?? null,
    lastSeenAt: row.lastSeenAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    sequenceCount,
  };
}

export function toPublicDefinitionDetail(
  row: EventDefinitionRow,
  sequenceCount: number,
) {
  return {
    ...toPublicDefinition(row, sequenceCount),
    lastProperties: row.lastProperties,
  };
}

export async function listEventDefinitions(teamId: string) {
  const rows = await db
    .select()
    .from(eventDefinitions)
    .where(eq(eventDefinitions.teamId, teamId))
    .orderBy(
      sql`${eventDefinitions.lastSeenAt} desc nulls last`,
      eventDefinitions.name,
    );
  const counts = await sequenceCounts(teamId);
  return rows.map((row) => toPublicDefinition(row, counts.get(row.name) ?? 0));
}

async function findDefinition(teamId: string, name: string) {
  const [row] = await db
    .select()
    .from(eventDefinitions)
    .where(and(eq(eventDefinitions.teamId, teamId), eq(eventDefinitions.name, name)))
    .limit(1);
  return row ?? null;
}

export async function getEventDefinition(teamId: string, name: string) {
  const row = await findDefinition(teamId, name);
  if (!row) return null;
  const counts = await sequenceCounts(teamId, [name]);
  return toPublicDefinitionDetail(row, counts.get(name) ?? 0);
}

type DeclaredProperty = { key: string; type: EventPropertyType };

function withDeclared(
  existing: EventDefinitionProperty[],
  declared: DeclaredProperty[],
): EventDefinitionProperty[] {
  const declaredKeys = new Set(declared.map((p) => p.key));
  const observed = existing.filter((p) => !p.declared && !declaredKeys.has(p.key));
  return [...declared.map((p) => ({ ...p, declared: true })), ...observed].slice(
    0,
    EVENT_PROPERTIES_MAX_KEYS,
  );
}

export async function createEventDefinition(
  teamId: string,
  input: { name: string; description?: string; properties?: DeclaredProperty[] },
) {
  const row = await db.transaction(async (tx) => {
    await lockTeamDefinitions(tx, teamId);
    const [existing] = await tx
      .select({ id: eventDefinitions.id })
      .from(eventDefinitions)
      .where(
        and(eq(eventDefinitions.teamId, teamId), eq(eventDefinitions.name, input.name)),
      )
      .limit(1);
    if (existing) throw new EventsError("event_definition_exists");
    await assertRoomForNewName(tx, teamId);
    const [inserted] = await tx
      .insert(eventDefinitions)
      .values({
        teamId,
        name: input.name,
        origin: "manual",
        description: input.description ?? null,
        properties: withDeclared([], input.properties ?? []),
      })
      .returning();
    return inserted!;
  });
  captureEvent({
    event: "event_definition_created",
    source: "events.definitions",
    teamId,
    properties: { definition_origin: "manual" },
  });
  const counts = await sequenceCounts(teamId, [row.name]);
  return toPublicDefinitionDetail(row, counts.get(row.name) ?? 0);
}

export async function updateEventDefinition(
  teamId: string,
  name: string,
  input: { description?: string | null; properties?: DeclaredProperty[] },
) {
  const row = await db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(eventDefinitions)
      .where(and(eq(eventDefinitions.teamId, teamId), eq(eventDefinitions.name, name)))
      .limit(1)
      .for("update");
    if (!existing) return null;
    const [updated] = await tx
      .update(eventDefinitions)
      .set({
        ...(input.description !== undefined && { description: input.description }),
        ...(input.properties && {
          properties: withDeclared(existing.properties, input.properties),
        }),
      })
      .where(eq(eventDefinitions.id, existing.id))
      .returning();
    return updated ?? null;
  });
  if (!row) return null;
  const counts = await sequenceCounts(teamId, [name]);
  return toPublicDefinitionDetail(row, counts.get(name) ?? 0);
}

/** `null` when it doesn't exist. Stored events are kept. */
export async function deleteEventDefinition(teamId: string, name: string) {
  const row = await findDefinition(teamId, name);
  if (!row) return null;
  const counts = await sequenceCounts(teamId, [name]);
  if ((counts.get(name) ?? 0) > 0) throw new EventsError("event_definition_in_use");
  await db.delete(eventDefinitions).where(eq(eventDefinitions.id, row.id));
  captureEvent({
    event: "event_definition_deleted",
    source: "events.definitions",
    teamId,
    properties: { definition_origin: row.origin },
  });
  return true;
}

// ---- Retention (hourly delivery-feedback retention loop) -----------------

const RETENTION_BATCH = 500;
const IDEMPOTENCY_WINDOW_DAYS = 30;
export const EVENT_RETENTION_DAYS = Number(process.env.EVENT_RETENTION_DAYS) || 396;

/** node-postgres reports `rowCount`; PGlite (tests) reports `affectedRows`. */
function affectedRows(result: unknown): number {
  const r = result as { rowCount?: number | null; affectedRows?: number };
  return r.rowCount ?? r.affectedRows ?? 0;
}

const daysAgo = (days: number) => new Date(Date.now() - days * 24 * 60 * 60 * 1000);

/** Closes the dedupe window: a key can be reused once it's cleared. */
export async function clearExpiredIdempotencyKeys(): Promise<number> {
  const rows = await db.execute(sql`
    update contact_events set idempotency_key = null
    where id in (
      select id from contact_events
      where idempotency_key is not null and created_at < ${daysAgo(IDEMPOTENCY_WINDOW_DAYS)}
      limit ${RETENTION_BATCH}
    )
    returning id`);
  return affectedRows(rows);
}

export async function purgeExpiredContactEvents(): Promise<number> {
  const rows = await db.execute(sql`
    delete from contact_events
    where id in (
      select id from contact_events
      where created_at < ${daysAgo(EVENT_RETENTION_DAYS)}
      limit ${RETENTION_BATCH}
    )
    returning id`);
  return affectedRows(rows);
}

/** Received definitions not seen for the retention period, unless a
 * sequence (any status) still uses the name. Manual ones are never purged. */
export async function purgeStaleEventDefinitions(): Promise<number> {
  const rows = await db.execute(sql`
    delete from event_definitions d
    where d.id in (
      select d2.id from event_definitions d2
      where d2.origin = 'received'
        and d2.last_seen_at < ${daysAgo(EVENT_RETENTION_DAYS)}
        and not exists (
          select 1 from sequences s
          where s.team_id = d2.team_id
            and s.trigger_type = ${EventType.CUSTOM_EVENT}
            and s.trigger_data = d2.name
        )
      limit ${RETENTION_BATCH}
    )
    returning d.id`);
  return affectedRows(rows);
}

/** The event behind a "view in browser" link: only when it belongs to the
 * link's own contact and team. */
export async function getContactEventForView({
  eventId,
  teamId,
  contactId,
}: {
  eventId: string;
  teamId: string;
  contactId: string;
}) {
  const [row] = await db
    .select({ properties: contactEvents.properties })
    .from(contactEvents)
    .where(
      and(
        eq(contactEvents.eventId, eventId),
        eq(contactEvents.teamId, teamId),
        eq(contactEvents.contactId, contactId),
      ),
    )
    .limit(1);
  return row ?? null;
}

/** Sample `{{ event.* }}` data for test sends: the last payload received
 * for the name. */
export async function getEventSample(teamId: string, name: string) {
  const row = await findDefinition(teamId, name);
  return row?.lastProperties ?? null;
}
