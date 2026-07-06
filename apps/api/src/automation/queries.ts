import { and, count, eq, lt, sql } from "drizzle-orm";
import { db } from "../db/client";
import { contacts, ongoingSequences, rules, sequences } from "../db/schema";
import { EventType, sequenceBounceLimit } from "../config/constants";
import {
    buildContactFilterCondition,
    ContactFilterWithAggregator,
} from "../contacts/segment";

export async function getDueDateRules() {
    return db
        .select()
        .from(rules)
        .where(
            and(
                eq(rules.event, EventType.DATE_OCCURRED),
                lt(rules.eventDateInMillis, Date.now()),
            ),
        );
}

export async function deleteRule(ruleId: string) {
    await db.delete(rules).where(eq(rules.ruleId, ruleId));
}

export async function getSequenceRowById(id: string) {
    const [row] = await db
        .select()
        .from(sequences)
        .where(eq(sequences.id, id))
        .limit(1);
    return row ?? null;
}

export async function getSequenceRowBySequenceId(
    teamId: string,
    sequenceId: string,
) {
    const [row] = await db
        .select()
        .from(sequences)
        .where(
            and(
                eq(sequences.teamId, teamId),
                eq(sequences.sequenceId, sequenceId),
            ),
        )
        .limit(1);
    return row ?? null;
}

function matchingContactsCondition(
    teamId: string,
    filter: ContactFilterWithAggregator | null | undefined,
) {
    const condition = buildContactFilterCondition(filter);
    return condition
        ? and(
              eq(contacts.teamId, teamId),
              eq(contacts.subscribed, true),
              condition,
          )
        : and(eq(contacts.teamId, teamId), eq(contacts.subscribed, true));
}

/** Returns **internal** contact ids — the only kind
 * `enrollContactsInOngoingSequence` (and the `ongoing_sequences` FK it writes
 * to) needs. Use `getMatchingPublicContactIds` if you need the public
 * `contactId`s instead (e.g. for a report/snapshot field like
 * `sequences.entrants`). */
export async function getMatchingContactIds(
    teamId: string,
    filter: ContactFilterWithAggregator | null | undefined,
): Promise<string[]> {
    const rows = await db
        .select({ id: contacts.id })
        .from(contacts)
        .where(matchingContactsCondition(teamId, filter));
    return rows.map((r) => r.id);
}

/** Same matching set as `getMatchingContactIds`, but returns the public
 * `contactId`s — for report/snapshot fields (e.g. `sequences.entrants`) that
 * intentionally aren't live FKs. */
export async function getMatchingPublicContactIds(
    teamId: string,
    filter: ContactFilterWithAggregator | null | undefined,
): Promise<string[]> {
    const rows = await db
        .select({ contactId: contacts.contactId })
        .from(contacts)
        .where(matchingContactsCondition(teamId, filter));
    return rows.map((r) => r.contactId);
}

export async function enrollContactsInOngoingSequence({
    teamId,
    sequenceId,
    contactIds,
}: {
    teamId: string;
    /** Internal `sequences.id`. */
    sequenceId: string;
    /** Internal `contacts.id`s. */
    contactIds: string[];
}) {
    if (contactIds.length === 0) return;
    const now = Date.now();
    await db
        .insert(ongoingSequences)
        .values(
            contactIds.map((contactId) => ({
                teamId,
                sequenceId,
                contactId,
                nextEmailScheduledTime: now,
            })),
        )
        .onConflictDoNothing({
            target: [ongoingSequences.sequenceId, ongoingSequences.contactId],
        });
}

export async function lockBroadcast(sequenceRowId: string, entrants: string[]) {
    await db
        .update(sequences)
        .set({
            entrants,
            report: sql`jsonb_set(coalesce(${sequences.report}, '{}'::jsonb), '{broadcast}', ${JSON.stringify(
                { lockedAt: Date.now(), sentAt: null },
            )}::jsonb)`,
            updatedAt: new Date(),
        })
        .where(eq(sequences.id, sequenceRowId));
}

export async function markBroadcastSent(sequenceId: string) {
    await db
        .update(sequences)
        .set({
            report: sql`jsonb_set(coalesce(${sequences.report}, '{}'::jsonb), '{broadcast,sentAt}', ${JSON.stringify(
                Date.now(),
            )}::jsonb)`,
            status: "completed",
            updatedAt: new Date(),
        })
        .where(eq(sequences.sequenceId, sequenceId));
}

export async function getDueOngoingSequences() {
    const currentTime = Date.now();
    return db
        .select()
        .from(ongoingSequences)
        .where(
            and(
                lt(ongoingSequences.nextEmailScheduledTime, currentTime),
                lt(ongoingSequences.retryCount, sequenceBounceLimit),
            ),
        );
}

export async function deleteOngoingSequence(id: string) {
    await db.delete(ongoingSequences).where(eq(ongoingSequences.id, id));
}

export async function countOngoingSequencesForSequence(sequenceId: string) {
    const [row] = await db
        .select({ count: count() })
        .from(ongoingSequences)
        .where(eq(ongoingSequences.sequenceId, sequenceId));
    return row?.count ?? 0;
}
