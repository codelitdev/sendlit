import {
  type ContactDeletion,
  type ContactSelection,
  contactFilterSchema,
} from "@sendlit/api-contract";
import { and, asc, count, eq, inArray, lt, type SQL } from "drizzle-orm";
import { db } from "../db/client";
import { genId } from "../db/id";
import { contacts } from "../db/schema";
import {
  addOrStrengthenSuppression,
  getActiveSuppressionReasons,
} from "../delivery-feedback/suppression-queries";
import { captureEvent } from "../observability";
import { normalizeEmail } from "../utils/email";
import { listContactsConditions } from "./queries";
import type { ContactFilterWithAggregator } from "./segment";
import { getSegment } from "./segments-queries";

/** Selections up to this size are deleted before the response; larger ones
 * run as a background job. Matches the contactIds limit. */
export const INLINE_DELETE_LIMIT = 1000;
const BATCH_SIZE = 500;

export const UNSUBSCRIBED_DELETED_EXPLANATION = "Unsubscribed contact was deleted";

export type SelectionError = "segment_not_found" | "invalid_segment_filter";

/**
 * The SQL condition for a bulk selection, always scoped to the team. With
 * `cutoffId` (a UUIDv7 taken when the request arrived), only contacts that
 * existed then match, so a long background deletion never removes contacts
 * added while it runs.
 */
export async function selectionCondition(
  teamId: string,
  selection: ContactSelection,
  cutoffId?: string,
): Promise<{ condition: SQL } | { error: SelectionError }> {
  const conditions: (SQL | undefined)[] = [];
  if (selection.contactIds) {
    conditions.push(
      eq(contacts.teamId, teamId),
      inArray(contacts.contactId, selection.contactIds),
    );
  } else {
    const match = selection.match ?? {};
    const filters: ContactFilterWithAggregator[] = [];
    if (match.segmentId) {
      const segment = await getSegment(match.segmentId);
      if (!segment || segment.teamId !== teamId) return { error: "segment_not_found" };
      const parsed = contactFilterSchema.safeParse(segment.filter);
      if (!parsed.success) return { error: "invalid_segment_filter" };
      filters.push(parsed.data as ContactFilterWithAggregator);
    }
    if (match.filter) filters.push(match.filter as ContactFilterWithAggregator);
    conditions.push(
      listContactsConditions({
        teamId,
        searchText: match.q,
        filter: filters.length ? filters : undefined,
      }),
    );
  }
  if (cutoffId) conditions.push(lt(contacts.id, cutoffId));
  return { condition: and(...conditions) as SQL };
}

/** How many contacts a selection matches, and how many are unsubscribed. */
export async function countSelection(
  condition: SQL,
): Promise<{ count: number; unsubscribed: number }> {
  const rows = await db
    .select({ subscribed: contacts.subscribed, value: count() })
    .from(contacts)
    .where(condition)
    .groupBy(contacts.subscribed);
  let total = 0;
  let unsubscribed = 0;
  for (const row of rows) {
    total += row.value;
    if (!row.subscribed) unsubscribed += row.value;
  }
  return { count: total, unsubscribed };
}

type DeletableContact = {
  id: string;
  email: string;
  subscribed: boolean;
};

/**
 * Deletes contact rows directly (never through the per-contact tag or
 * update helpers, so no sequence triggers fire). Their custom field values,
 * sequence progress, events and delivery records cascade. Suppressions have
 * no FK to contacts and are kept; unsubscribe state lives only on the
 * contact row, so each unsubscribed address without an active suppression
 * is suppressed first — re-importing or re-adding it never mails it again.
 */
export async function deleteContactRows(
  teamId: string,
  rows: DeletableContact[],
  actorUserId?: string | null,
): Promise<{ deleted: number; suppressed: number }> {
  if (rows.length === 0) return { deleted: 0, suppressed: 0 };
  let suppressed = 0;
  const unsubscribed = rows.filter((row) => !row.subscribed);
  if (unsubscribed.length) {
    const active = await getActiveSuppressionReasons(
      teamId,
      unsubscribed.map((row) => row.email),
    );
    for (const row of unsubscribed) {
      if (active.has(normalizeEmail(row.email))) continue;
      await addOrStrengthenSuppression({
        teamId,
        recipientEmail: row.email,
        reason: "manual",
        actorType: actorUserId ? "workspace_user" : "system",
        actorUserId: actorUserId ?? null,
        explanation: UNSUBSCRIBED_DELETED_EXPLANATION,
      });
      suppressed++;
    }
  }
  const deleted = await db
    .delete(contacts)
    .where(
      and(
        eq(contacts.teamId, teamId),
        inArray(
          contacts.id,
          rows.map((row) => row.id),
        ),
      ),
    )
    .returning({ id: contacts.id });
  return { deleted: deleted.length, suppressed };
}

/** Deletes everything matching `condition` in batches, reporting progress
 * after each one. Safe to re-run: it only ever sees what is left. */
export async function deleteMatchingContacts(
  teamId: string,
  condition: SQL,
  {
    actorUserId,
    onProgress,
  }: {
    actorUserId?: string | null;
    onProgress?: (progress: { deleted: number; suppressed: number }) => Promise<void>;
  } = {},
): Promise<{ deleted: number; suppressed: number }> {
  const total = { deleted: 0, suppressed: 0 };
  for (;;) {
    const batch = await db
      .select({
        id: contacts.id,
        email: contacts.email,
        subscribed: contacts.subscribed,
      })
      .from(contacts)
      .where(condition)
      .orderBy(asc(contacts.id))
      .limit(BATCH_SIZE);
    if (batch.length === 0) break;
    const result = await deleteContactRows(teamId, batch, actorUserId);
    total.deleted += result.deleted;
    total.suppressed += result.suppressed;
    await onProgress?.(total);
    if (batch.length < BATCH_SIZE) break;
  }
  return total;
}

export function captureBulkDeletion({
  teamId,
  selection,
  deletionId,
  deleted,
  suppressed,
}: {
  teamId: string;
  selection: ContactSelection;
  deletionId: string | null;
  deleted: number;
  suppressed: number;
}) {
  captureEvent({
    event: "contacts_bulk_deleted",
    source: "contacts.bulk_delete",
    teamId,
    properties: {
      kind: selection.contactIds ? "ids" : "match",
      count: deleted,
      suppressed_count: suppressed,
      ...(deletionId ? { job_id: deletionId } : {}),
    },
  });
}

export type StartDeletionResult =
  | { status: 200 | 202; body: ContactDeletion }
  | { status: 404; body: { error: string } }
  | { status: 400; body: { error: string } }
  | { status: 409; body: { error: string; count: number } };

/** A fresh UUIDv7: every contact created before now sorts below it. */
export function newCutoffId(): string {
  return genId();
}
