import { and, asc, count, desc, eq, isNull, lt, ne, or, sql } from "drizzle-orm";
import { assertMarketingAllowedForContactUsage } from "../billing/entitlements";
import { EventType, sequenceBounceLimit } from "../config/constants";
import {
  type AudienceFilters,
  buildContactExclusionCondition,
  buildContactFilterCondition,
} from "../contacts/segment";
import { db } from "../db/client";
import {
  contactEventMatches,
  contacts,
  ongoingSequences,
  rules,
  sequenceEmails,
  sequenceEntries,
  sequences,
  type TriggerEventSnapshot,
  teams,
} from "../db/schema";
import { engagementPriorities } from "./engagement";

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

/** The first published email in `emailsOrder` that the contact hasn't been
 * sent yet. */
export function getNextPublishedEmail<
  T extends { emailId: string; published: boolean },
>(
  emailsOrder: string[],
  emails: T[],
  ongoingSequence: { sentEmailIds: string[] },
): T | null {
  const sentEmailIdsSet = new Set(ongoingSequence.sentEmailIds);
  for (const emailId of emailsOrder) {
    const email = emails.find((e) => e.emailId === emailId && e.published);
    if (email && !sentEmailIdsSet.has(email.emailId)) {
      return email;
    }
  }
  return null;
}

export async function getSequenceRowById(id: string) {
  const [row] = await db.select().from(sequences).where(eq(sequences.id, id)).limit(1);
  return row ?? null;
}

export async function getSequenceRowBySequenceId(teamId: string, sequenceId: string) {
  const [row] = await db
    .select()
    .from(sequences)
    .where(and(eq(sequences.teamId, teamId), eq(sequences.sequenceId, sequenceId)))
    .limit(1);
  return row ?? null;
}

function matchingContactsCondition(teamId: string, audience: AudienceFilters) {
  return and(
    eq(contacts.teamId, teamId),
    eq(contacts.subscribed, true),
    buildContactFilterCondition(audience.filter),
    buildContactExclusionCondition(audience.excludeFilter),
  );
}

/** Returns **internal** contact ids — the only kind
 * `enrollContactsInOngoingSequence` (and the `ongoing_sequences` FK it writes
 * to) needs. Use `getMatchingPublicContactIds` if you need the public
 * `contactId`s instead (e.g. for a report/snapshot field like
 * `sequences.entrants`). */
export async function getMatchingContactIds(
  teamId: string,
  audience: AudienceFilters,
): Promise<string[]> {
  const rows = await db
    .select({ id: contacts.id })
    .from(contacts)
    .where(matchingContactsCondition(teamId, audience));
  return rows.map((r) => r.id);
}

/** Same matching set as `getMatchingContactIds`, but returns the public
 * `contactId`s — for report/snapshot fields (e.g. `sequences.entrants`) that
 * intentionally aren't live FKs. */
export async function getMatchingPublicContactIds(
  teamId: string,
  audience: AudienceFilters,
): Promise<string[]> {
  const rows = await db
    .select({ contactId: contacts.contactId })
    .from(contacts)
    .where(matchingContactsCondition(teamId, audience));
  return rows.map((r) => r.contactId);
}

/** Whether one contact (internal `contacts.id`) is in a sequence's audience,
 * for event-triggered enrollment. */
export async function contactMatchesAudience(
  teamId: string,
  contactId: string,
  audience: AudienceFilters,
): Promise<boolean> {
  const [row] = await db
    .select({ id: contacts.id })
    .from(contacts)
    .where(and(eq(contacts.id, contactId), matchingContactsCondition(teamId, audience)))
    .limit(1);
  return Boolean(row);
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
  const [team] = await db
    .select({ organizationId: teams.organizationId })
    .from(teams)
    .where(eq(teams.id, teamId))
    .limit(1);
  if (team) {
    await db.transaction(async (tx) => {
      await assertMarketingAllowedForContactUsage(tx, team.organizationId);
    });
  }
  const now = Date.now();
  // Most engaged first, so a capped day (warm-up, daily limit) reaches them.
  const priorities = await engagementPriorities(teamId, contactIds, now);
  await db
    .insert(ongoingSequences)
    .values(
      contactIds.map((contactId) => ({
        teamId,
        sequenceId,
        contactId,
        nextEmailScheduledTime: now,
        priority: priorities.get(contactId) ?? 0,
      })),
    )
    .onConflictDoNothing({
      target: [ongoingSequences.sequenceId, ongoingSequences.contactId],
    });
}

export type TriggerEnrollmentOutcome =
  | "enrolled"
  | "already_matched"
  | "already_in_sequence"
  | "reentry_refused";

class ReentryRefused extends Error {}

/**
 * Enrolls one contact from a trigger (`fireEvent`), in one transaction:
 *
 * 1. When the trigger is a stored custom event, claim its
 *    `contact_event_matches` row, so a retry or the recovery sweep can't
 *    enroll the contact twice from one event.
 * 2. Insert the `ongoing_sequences` row; a conflict means the contact is
 *    already in the sequence.
 * 3. For sequences, apply the re-entry setting to `sequence_entries` as one
 *    atomic upsert. A refusal rolls back the enrollment.
 *
 * See docs/custom_events.md#matching-matcheventtriggers-and-fireevent.
 */
export async function enrollContactFromTrigger({
  teamId,
  sequence,
  contactId,
  triggerEvent,
}: {
  teamId: string;
  sequence: {
    id: string;
    type: string;
    emailsOrder: string[];
    reentry: string;
    reentryPeriodDays: number | null;
  };
  /** Internal `contacts.id`. */
  contactId: string;
  triggerEvent?: { contactEventId?: string; snapshot: TriggerEventSnapshot };
}): Promise<TriggerEnrollmentOutcome> {
  const [team] = await db
    .select({ organizationId: teams.organizationId })
    .from(teams)
    .where(eq(teams.id, teamId))
    .limit(1);
  const now = Date.now();
  const priorities = await engagementPriorities(teamId, [contactId], now);
  const firstEmailDelay =
    sequence.type === "sequence" ? await firstEmailDelayInMillis(sequence) : 0;
  const contactEventId = triggerEvent?.contactEventId;
  try {
    return await db.transaction(async (tx) => {
      if (team) await assertMarketingAllowedForContactUsage(tx, team.organizationId);
      if (contactEventId) {
        const [claimed] = await tx
          .insert(contactEventMatches)
          .values({ contactEventId, sequenceId: sequence.id })
          .onConflictDoNothing()
          .returning({ sequenceId: contactEventMatches.sequenceId });
        if (!claimed) return "already_matched";
      }
      const [inserted] = await tx
        .insert(ongoingSequences)
        .values({
          teamId,
          sequenceId: sequence.id,
          contactId,
          nextEmailScheduledTime: now + firstEmailDelay,
          priority: priorities.get(contactId) ?? 0,
          triggerEvent: triggerEvent?.snapshot ?? null,
        })
        .onConflictDoNothing({
          target: [ongoingSequences.sequenceId, ongoingSequences.contactId],
        })
        .returning({ id: ongoingSequences.id });
      if (!inserted) return "already_in_sequence";
      if (
        sequence.type === "sequence" &&
        !(await recordEntry(tx, sequence, contactId))
      ) {
        throw new ReentryRefused();
      }
      if (contactEventId) {
        await tx
          .update(contactEventMatches)
          .set({ enrolled: true })
          .where(
            and(
              eq(contactEventMatches.contactEventId, contactEventId),
              eq(contactEventMatches.sequenceId, sequence.id),
            ),
          );
      }
      return "enrolled";
    });
  } catch (err) {
    if (!(err instanceof ReentryRefused)) throw err;
    if (contactEventId) {
      await db
        .insert(contactEventMatches)
        .values({ contactEventId, sequenceId: sequence.id, enrolled: false })
        .onConflictDoNothing();
    }
    return "reentry_refused";
  }
}

/** A sequence's first email waits its own delay after entry, like every
 * later email waits after the one before it. (A broadcast's first delay is
 * its absolute send time instead; see `process-rules.ts`.) */
async function firstEmailDelayInMillis(sequence: {
  id: string;
  emailsOrder: string[];
}): Promise<number> {
  const emails = await db
    .select({
      emailId: sequenceEmails.emailId,
      published: sequenceEmails.published,
      delayInMillis: sequenceEmails.delayInMillis,
    })
    .from(sequenceEmails)
    .where(eq(sequenceEmails.sequenceId, sequence.id));
  return (
    getNextPublishedEmail(sequence.emailsOrder, emails, { sentEmailIds: [] })
      ?.delayInMillis ?? 0
  );
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** The re-entry check and the history write as one statement, so two
 * concurrent events can't both pass a `once` check. Returns whether the
 * entry is allowed. */
async function recordEntry(
  tx: Tx,
  sequence: { id: string; reentry: string; reentryPeriodDays: number | null },
  contactId: string,
): Promise<boolean> {
  const values = {
    sequenceId: sequence.id,
    contactId,
    firstEnteredAt: sql`now()`,
    lastEnteredAt: sql`now()`,
    entryCount: 1,
  };
  const target = [sequenceEntries.sequenceId, sequenceEntries.contactId];
  const bump = {
    lastEnteredAt: sql`now()`,
    entryCount: sql`${sequenceEntries.entryCount} + 1`,
  };
  const insert = tx.insert(sequenceEntries).values(values as any);
  let rows: unknown[];
  if (sequence.reentry === "once") {
    rows = await insert.onConflictDoNothing({ target }).returning();
  } else if (sequence.reentry === "once_per_period") {
    rows = await insert
      .onConflictDoUpdate({
        target,
        set: bump,
        setWhere: sql`${sequenceEntries.lastEnteredAt} < now() - make_interval(days => ${sequence.reentryPeriodDays ?? 1}::int)`,
      })
      .returning();
  } else {
    rows = await insert.onConflictDoUpdate({ target, set: bump }).returning();
  }
  return rows.length > 0;
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
  const rows = await db
    .select({ row: ongoingSequences })
    .from(ongoingSequences)
    .innerJoin(sequences, eq(sequences.id, ongoingSequences.sequenceId))
    .where(
      and(
        lt(ongoingSequences.nextEmailScheduledTime, currentTime),
        lt(ongoingSequences.retryCount, sequenceBounceLimit),
        // A paused sequence keeps its deliveries queued until it resumes.
        ne(sequences.status, "paused"),
        or(
          isNull(ongoingSequences.processingStartedAt),
          lt(
            ongoingSequences.processingStartedAt,
            new Date(currentTime - PROCESSING_LEASE_MS),
          ),
        ),
      ),
    )
    .orderBy(
      desc(ongoingSequences.priority),
      asc(ongoingSequences.nextEmailScheduledTime),
    );
  return rows.map(({ row }) => row);
}

const PROCESSING_LEASE_MS = 10 * 60 * 1000;

/** Atomically claims a due delivery row. The expiring lease recovers work
 * after a worker process dies while preventing two live workers from sending
 * the same sequence email concurrently. */
export async function claimOngoingSequence(id: string) {
  const now = new Date();
  const [row] = await db
    .update(ongoingSequences)
    .set({ processingStartedAt: now, updatedAt: now })
    .where(
      and(
        eq(ongoingSequences.id, id),
        lt(ongoingSequences.nextEmailScheduledTime, Date.now() + 1),
        or(
          isNull(ongoingSequences.processingStartedAt),
          lt(
            ongoingSequences.processingStartedAt,
            new Date(Date.now() - PROCESSING_LEASE_MS),
          ),
        ),
      ),
    )
    .returning();
  return row ?? null;
}

export async function releaseOngoingSequenceClaim(id: string): Promise<void> {
  await db
    .update(ongoingSequences)
    .set({ processingStartedAt: null, updatedAt: new Date() })
    .where(eq(ongoingSequences.id, id));
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
