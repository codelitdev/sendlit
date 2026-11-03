import { type AnyColumn, and, eq, inArray, or, type SQL, sql } from "drizzle-orm";
import { EventType, UserFilter } from "../config/constants";
import { db } from "../db/client";
import {
  contacts,
  rules,
  segments,
  sequenceEmails,
  sequences,
  signupForms,
} from "../db/schema";
import { captureEvent } from "../observability";
import type { ContactFilterWithAggregator } from "./segment";

/**
 * Team-wide tag management (#150). Tags live in `contacts.tags`; everything
 * else (segment and audience filters, tag triggers and their `rules`, sequence
 * email tag actions, signup forms) only names them.
 */

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Executor = typeof db | Tx;

const TAG_TRIGGERS = [EventType.TAG_ADDED, EventType.TAG_REMOVED];
const TAG_ACTIONS = ["tag:add", "tag:remove"];

export type TagSequenceUsage = "filter" | "exclude_filter" | "trigger" | "email_action";

export type TagReferences = {
  tag: string;
  contactCount: number;
  segments: { segmentId: string; name: string }[];
  sequences: {
    sequenceId: string;
    title: string;
    type: "broadcast" | "sequence";
    status: string;
    usages: TagSequenceUsage[];
  }[];
  signupForms: { formId: string; name: string }[];
};

function rowsOf<T>(result: unknown): T[] {
  return ((result as { rows?: T[] }).rows ?? []) as T[];
}

/** jsonb containment: the filter has a `tag` condition on `tag`. */
function filterNamesTag(column: SQL | AnyColumn, tag: string): SQL {
  return sql`coalesce(${column}, '{}'::jsonb) @> ${JSON.stringify({
    filters: [{ name: UserFilter.TAG, value: tag }],
  })}::jsonb`;
}

function filterUsesTag(filter: unknown, tag: string): boolean {
  const conditions = (filter as ContactFilterWithAggregator | null)?.filters;
  return (
    Array.isArray(conditions) &&
    conditions.some((c) => c.name === UserFilter.TAG && c.value === tag)
  );
}

function renameInFilter(filter: unknown, from: string, to: string): unknown {
  if (!filterUsesTag(filter, from)) return filter;
  const value = filter as ContactFilterWithAggregator;
  return {
    ...value,
    filters: value.filters.map((c) =>
      c.name === UserFilter.TAG && c.value === from
        ? { ...c, value: to, ...(c.valueLabel !== undefined && { valueLabel: to }) }
        : c,
    ),
  };
}

const hasTag = (tag: string) => sql`${contacts.tags} @> ARRAY[${tag}]::text[]`;

export async function listTags(
  teamId: string,
): Promise<{ tag: string; contactCount: number }[]> {
  const result = await db.execute(sql`
    select t.tag as tag, count(*)::int as "contactCount"
    from ${contacts}, unnest(${contacts.tags}) as t(tag)
    where ${contacts.teamId} = ${teamId}
    group by t.tag
    order by t.tag`);
  return rowsOf<{ tag: string; contactCount: number }>(result).map((row) => ({
    tag: row.tag,
    contactCount: Number(row.contactCount),
  }));
}

export async function countContactsWithTag(
  teamId: string,
  tag: string,
  executor: Executor = db,
): Promise<number> {
  const [row] = await executor
    .select({ count: sql<number>`count(*)::int` })
    .from(contacts)
    .where(and(eq(contacts.teamId, teamId), hasTag(tag)));
  return Number(row?.count ?? 0);
}

export async function getTagReferences(
  teamId: string,
  tag: string,
  executor: Executor = db,
): Promise<TagReferences> {
  const [contactCount, segmentRows, sequenceRows, actionRows, formRows] =
    await Promise.all([
      countContactsWithTag(teamId, tag, executor),
      executor
        .select({ segmentId: segments.segmentId, name: segments.name })
        .from(segments)
        .where(and(eq(segments.teamId, teamId), filterNamesTag(segments.filter, tag)))
        .orderBy(segments.name),
      executor
        .select({
          id: sequences.id,
          sequenceId: sequences.sequenceId,
          title: sequences.title,
          type: sequences.type,
          status: sequences.status,
          filter: sequences.filter,
          excludeFilter: sequences.excludeFilter,
          triggerType: sequences.triggerType,
          triggerData: sequences.triggerData,
        })
        .from(sequences)
        .where(
          and(
            eq(sequences.teamId, teamId),
            or(
              filterNamesTag(sequences.filter, tag),
              filterNamesTag(sequences.excludeFilter, tag),
              and(
                inArray(sequences.triggerType, TAG_TRIGGERS),
                eq(sequences.triggerData, tag),
              ),
              sql`exists (
                select 1 from ${sequenceEmails}
                where ${sequenceEmails.sequenceId} = ${sequences.id}
                  and ${sequenceEmails.actionType} in ${TAG_ACTIONS}
                  and ${sequenceEmails.actionData} ->> 'tag' = ${tag}
              )`,
            ),
          ),
        )
        .orderBy(sequences.title),
      executor
        .selectDistinct({ sequenceId: sequenceEmails.sequenceId })
        .from(sequenceEmails)
        .innerJoin(sequences, eq(sequences.id, sequenceEmails.sequenceId))
        .where(
          and(
            eq(sequences.teamId, teamId),
            inArray(sequenceEmails.actionType, TAG_ACTIONS),
            sql`${sequenceEmails.actionData} ->> 'tag' = ${tag}`,
          ),
        ),
      executor
        .select({ formId: signupForms.formId, name: signupForms.name })
        .from(signupForms)
        .where(
          and(
            eq(signupForms.teamId, teamId),
            sql`${signupForms.tags} @> ARRAY[${tag}]::text[]`,
          ),
        )
        .orderBy(signupForms.name),
    ]);

  const withActions = new Set(actionRows.map((row) => row.sequenceId));
  return {
    tag,
    contactCount,
    segments: segmentRows,
    sequences: sequenceRows.map((row) => {
      const usages: TagSequenceUsage[] = [];
      if (filterUsesTag(row.filter, tag)) usages.push("filter");
      if (filterUsesTag(row.excludeFilter, tag)) usages.push("exclude_filter");
      if (
        row.triggerType &&
        TAG_TRIGGERS.includes(row.triggerType as (typeof TAG_TRIGGERS)[number]) &&
        row.triggerData === tag
      ) {
        usages.push("trigger");
      }
      if (withActions.has(row.id)) usages.push("email_action");
      return {
        sequenceId: row.sequenceId,
        title: row.title,
        type: row.type as "broadcast" | "sequence",
        status: row.status,
        usages,
      };
    }),
    signupForms: formRows,
  };
}

export function isTagUnused(references: TagReferences): boolean {
  return (
    references.contactCount === 0 &&
    references.segments.length === 0 &&
    references.sequences.length === 0 &&
    references.signupForms.length === 0
  );
}

/**
 * Removes the tag from every contact. References are left alone on purpose:
 * dropping a `tag is X` condition would widen a segment or audience to
 * people it never targeted. No tag-removed events fire, so this never
 * enrolls anyone in a sequence. Returns null when nothing uses the tag.
 */
export async function deleteTag(
  teamId: string,
  tag: string,
): Promise<{ tag: string; contactsUpdated: number; references: TagReferences } | null> {
  const before = await getTagReferences(teamId, tag);
  if (isTagUnused(before)) return null;
  const updated = await db
    .update(contacts)
    .set({ tags: sql`array_remove(${contacts.tags}, ${tag})`, updatedAt: new Date() })
    .where(and(eq(contacts.teamId, teamId), hasTag(tag)))
    .returning({ id: contacts.id });
  captureEvent({
    event: "tag_deleted",
    source: "tags.delete",
    teamId,
    properties: { count: updated.length },
  });
  return {
    tag,
    contactsUpdated: updated.length,
    references: { ...before, contactCount: 0 },
  };
}

export type RenameTagResult = {
  tag: string;
  previousTag: string;
  contactsUpdated: number;
  segmentsUpdated: number;
  sequencesUpdated: number;
  signupFormsUpdated: number;
};

/**
 * Renames the tag everywhere it is named, in one transaction. Renaming onto
 * an existing tag merges them. Sent (completed) broadcasts keep their
 * original filters, as a record of who they went to. No tag events fire.
 */
export async function renameTag(
  teamId: string,
  from: string,
  to: string,
): Promise<RenameTagResult | "tag_not_found" | "tag_unchanged"> {
  if (from === to) return "tag_unchanged";
  const result = await db.transaction(async (tx) => {
    const references = await getTagReferences(teamId, from, tx);
    if (isTagUnused(references)) return "tag_not_found" as const;
    const now = new Date();

    const updatedContacts = await tx
      .update(contacts)
      .set({
        tags: sql`array_append(array_remove(array_remove(${contacts.tags}, ${from}), ${to}), ${to})`,
        updatedAt: now,
      })
      .where(and(eq(contacts.teamId, teamId), hasTag(from)))
      .returning({ id: contacts.id });

    const segmentRows = await tx
      .select({ id: segments.id, filter: segments.filter })
      .from(segments)
      .where(and(eq(segments.teamId, teamId), filterNamesTag(segments.filter, from)));
    for (const row of segmentRows) {
      await tx
        .update(segments)
        .set({ filter: renameInFilter(row.filter, from, to), updatedAt: now })
        .where(eq(segments.id, row.id));
    }

    const sequenceIds = references.sequences
      .filter((s) => !(s.type === "broadcast" && s.status === "completed"))
      .map((s) => s.sequenceId);
    if (sequenceIds.length) {
      const sequenceRows = await tx
        .select()
        .from(sequences)
        .where(
          and(eq(sequences.teamId, teamId), inArray(sequences.sequenceId, sequenceIds)),
        );
      for (const row of sequenceRows) {
        const renamesTrigger =
          row.triggerType !== null &&
          TAG_TRIGGERS.includes(row.triggerType as (typeof TAG_TRIGGERS)[number]) &&
          row.triggerData === from;
        await tx
          .update(sequences)
          .set({
            filter: renameInFilter(row.filter, from, to),
            excludeFilter: renameInFilter(row.excludeFilter, from, to),
            ...(renamesTrigger && { triggerData: to }),
            updatedAt: now,
          })
          .where(eq(sequences.id, row.id));
        // Active sequences listen through `rules`, a copy of the trigger.
        if (renamesTrigger) {
          await tx
            .update(rules)
            .set({ eventData: to, updatedAt: now })
            .where(
              and(
                eq(rules.sequenceId, row.id),
                inArray(rules.event, TAG_TRIGGERS),
                eq(rules.eventData, from),
              ),
            );
        }
        await tx
          .update(sequenceEmails)
          .set({
            actionData: sql`jsonb_set(${sequenceEmails.actionData}, '{tag}', to_jsonb(${to}::text))`,
            updatedAt: now,
          })
          .where(
            and(
              eq(sequenceEmails.sequenceId, row.id),
              inArray(sequenceEmails.actionType, TAG_ACTIONS),
              sql`${sequenceEmails.actionData} ->> 'tag' = ${from}`,
            ),
          );
      }
    }

    const updatedForms = await tx
      .update(signupForms)
      .set({
        tags: sql`array_append(array_remove(array_remove(${signupForms.tags}, ${from}), ${to}), ${to})`,
        updatedAt: now,
      })
      .where(
        and(
          eq(signupForms.teamId, teamId),
          sql`${signupForms.tags} @> ARRAY[${from}]::text[]`,
        ),
      )
      .returning({ id: signupForms.id });

    return {
      tag: to,
      previousTag: from,
      contactsUpdated: updatedContacts.length,
      segmentsUpdated: segmentRows.length,
      sequencesUpdated: sequenceIds.length,
      signupFormsUpdated: updatedForms.length,
    };
  });
  if (typeof result === "string") return result;
  captureEvent({
    event: "tag_renamed",
    source: "tags.rename",
    teamId,
    properties: { count: result.contactsUpdated },
  });
  return result;
}
