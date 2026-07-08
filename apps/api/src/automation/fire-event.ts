import { and, eq } from "drizzle-orm";
import { db } from "../db/client";
import { rules, sequences } from "../db/schema";
import { enrollContactsInOngoingSequence } from "./queries";
import { Event, EventType } from "../config/constants";
import logger from "../services/log";
import { captureError, captureEvent } from "../observability/posthog";

/**
 * Tag/subscriber-based sequence triggers are event driven rather than polled
 * (unlike `DATE_OCCURRED` broadcasts — see `process-rules.ts`). Call this
 * whenever a contact is created or tagged so any matching active sequence
 * immediately enrolls them.
 */
export async function fireEvent({
    teamId,
    event,
    eventData,
    contactId,
}: {
    teamId: string;
    event: Event;
    eventData?: string;
    /** Internal `contacts.id` — callers already have the `Contact` row loaded. */
    contactId: string;
}) {
    const matchingRules = await db
        .select()
        .from(rules)
        .where(and(eq(rules.teamId, teamId), eq(rules.event, event)));

    for (const rule of matchingRules) {
        if (
            (event === EventType.TAG_ADDED ||
                event === EventType.TAG_REMOVED) &&
            rule.eventData !== eventData
        ) {
            continue;
        }

        const [sequenceRow] = await db
            .select({ id: sequences.id, status: sequences.status })
            .from(sequences)
            .where(
                and(
                    eq(sequences.teamId, teamId),
                    eq(sequences.id, rule.sequenceId),
                ),
            )
            .limit(1);
        if (!sequenceRow || sequenceRow.status !== "active") continue;

        try {
            await enrollContactsInOngoingSequence({
                teamId,
                sequenceId: sequenceRow.id,
                contactIds: [contactId],
            });
            captureEvent({
                event: "contact_enrolled_in_sequence",
                source: "automation.fire_event",
                teamId,
                properties: {
                    sequence_id: rule.sequenceId,
                    event_type: event,
                },
            });
        } catch (err: any) {
            logger.error(
                { error: err.message, sequence_id: rule.sequenceId, contactId },
                "fireEvent enrollment failed",
            );
            captureError({
                error: err,
                source: "automation.fire_event",
                teamId,
                context: {
                    sequence_id: rule.sequenceId,
                    event_type: event,
                },
            });
        }
    }
}
