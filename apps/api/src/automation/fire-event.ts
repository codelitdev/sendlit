import type { EventPropertyFilter, PropertyChangeFilter } from "@sendlit/api-contract";
import { and, eq, inArray } from "drizzle-orm";
import { isPlanGateError } from "../billing/errors";
import { type Event, EventType } from "../config/constants";
import { sequenceAudience } from "../contacts/segment";
import { db } from "../db/client";
import { rules, sequences, type TriggerEventSnapshot } from "../db/schema";
import { captureError, captureEvent } from "../observability";
import logger from "../services/log";
import { matchesEventFilter, matchesPropertyChange } from "./event-filter";
import { contactMatchesAudience, enrollContactFromTrigger } from "./queries";

/** Triggers whose rule only matches a specific `eventData` (tag name, event
 * name, custom field key). */
const EVENTS_WITH_DATA = new Set<Event>([
  EventType.TAG_ADDED,
  EventType.TAG_REMOVED,
  EventType.CUSTOM_EVENT,
  EventType.CONTACT_PROPERTY_CHANGED,
]);

/**
 * Tag/subscriber/event-based sequence triggers are event driven rather than
 * polled (unlike `DATE_OCCURRED` broadcasts — see `process-rules.ts`). Call
 * this whenever a contact is created, tagged, updated or sends a custom
 * event, so any matching active sequence immediately enrolls them.
 *
 * Returns the public ids of the sequences the contact was enrolled in.
 */
export async function fireEvent({
  teamId,
  event,
  eventData,
  contactId,
  payload,
  triggerEvent,
}: {
  teamId: string;
  event: Event;
  eventData?: string;
  /** Internal `contacts.id` — callers already have the `Contact` row loaded. */
  contactId: string;
  /** `contact:property_changed` only: `{ key, from, to }`, rendered as
   * `{{ event.* }}` and matched against the from/to filter. */
  payload?: { key: string; from: unknown; to: unknown };
  /** `event:custom` only: the stored event (internal id) and its snapshot. */
  triggerEvent?: { contactEventId: string; snapshot: TriggerEventSnapshot };
}): Promise<string[]> {
  const conditions = [eq(rules.teamId, teamId), eq(rules.event, event)];
  if (EVENTS_WITH_DATA.has(event)) {
    if (eventData === undefined) return [];
    conditions.push(eq(rules.eventData, eventData));
  }
  const matchingRules = await db
    .select()
    .from(rules)
    .where(and(...conditions));
  if (matchingRules.length === 0) return [];

  const sequenceRows = await db
    .select({
      id: sequences.id,
      sequenceId: sequences.sequenceId,
      type: sequences.type,
      status: sequences.status,
      emailsOrder: sequences.emailsOrder,
      filter: sequences.filter,
      excludeFilter: sequences.excludeFilter,
      reentry: sequences.reentry,
      reentryPeriodDays: sequences.reentryPeriodDays,
    })
    .from(sequences)
    .where(
      and(
        eq(sequences.teamId, teamId),
        inArray(
          sequences.id,
          matchingRules.map((rule) => rule.sequenceId),
        ),
      ),
    );
  const sequencesById = new Map(sequenceRows.map((row) => [row.id, row]));

  const snapshot: TriggerEventSnapshot | undefined =
    triggerEvent?.snapshot ??
    (payload
      ? {
          eventId: "",
          name: EventType.CONTACT_PROPERTY_CHANGED,
          properties: payload,
          occurredAt: new Date().toISOString(),
        }
      : undefined);

  const enrolled: string[] = [];
  for (const rule of matchingRules) {
    const sequenceRow = sequencesById.get(rule.sequenceId);
    if (sequenceRow?.status !== "active") continue;

    if (
      event === EventType.CUSTOM_EVENT &&
      !matchesEventFilter(
        rule.eventFilter as EventPropertyFilter | null,
        triggerEvent?.snapshot.properties ?? {},
      )
    ) {
      continue;
    }
    if (
      event === EventType.CONTACT_PROPERTY_CHANGED &&
      !matchesPropertyChange(
        rule.eventFilter as PropertyChangeFilter | null,
        payload?.from,
        payload?.to,
      )
    ) {
      continue;
    }

    try {
      if (
        !(await contactMatchesAudience(
          teamId,
          contactId,
          sequenceAudience(sequenceRow),
        ))
      ) {
        continue;
      }
      const outcome = await enrollContactFromTrigger({
        teamId,
        sequence: sequenceRow,
        contactId,
        triggerEvent: snapshot
          ? { contactEventId: triggerEvent?.contactEventId, snapshot }
          : undefined,
      });
      if (outcome !== "enrolled") continue;
      enrolled.push(sequenceRow.sequenceId);
      captureEvent({
        event: "contact_enrolled_in_sequence",
        source: "automation.fire_event",
        teamId,
        properties: {
          sequence_id: sequenceRow.sequenceId,
          event_type: event,
        },
      });
    } catch (err: any) {
      logger.error(
        { error: err.message, sequence_id: sequenceRow.sequenceId, contactId },
        "fireEvent enrollment failed",
      );
      captureError({
        error: err,
        source: "automation.fire_event",
        teamId,
        context: {
          sequence_id: sequenceRow.sequenceId,
          event_type: event,
          error_code: isPlanGateError(err) ? err.code : "enrollment_failed",
        },
      });
    }
  }
  return enrolled;
}
