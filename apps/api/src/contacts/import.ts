import {
  type ContactImportStatus,
  type CustomFields,
  normalizeImportStatus,
} from "@sendlit/api-contract";
import { and, count, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { getOrganizationEntitlements } from "../billing/entitlements";
import { db } from "../db/client";
import { contacts, teams } from "../db/schema";
import {
  addOrStrengthenSuppression,
  getActiveSuppressionReasons,
} from "../delivery-feedback/suppression-queries";
import { captureEvent } from "../observability";
import { generateUniqueId } from "../utils/id";
import { type Contact, replaceContactCustomFieldValues } from "./queries";

export interface ImportContactRow {
  email: string;
  name?: string;
  tags?: string[];
  status?: string;
  createdAt?: string;
  customFields?: CustomFields;
  row?: number;
}

export type ImportSkipReason =
  | "invalid_email"
  | "duplicate"
  | "pending_confirmation"
  | "unknown_status"
  | "plan_limit_reached";

export interface ImportContactsResult {
  created: number;
  updated: number;
  unchanged: number;
  suppressed: number;
  skipped: { row?: number; email: string; reason: ImportSkipReason }[];
}

interface PreparedRow {
  row?: number;
  email: string;
  name?: string;
  tags: string[];
  status: ContactImportStatus;
  createdAt?: Date;
  customFields?: CustomFields;
}

const emailSchema = z.string().email();

function signupDate(value: string | undefined): Date | undefined {
  if (!value?.trim()) return undefined;
  const date = new Date(value.trim());
  const time = date.getTime();
  // Ignore unparseable dates and ones in the future; the contact then gets
  // the import time like any new contact.
  return Number.isFinite(time) && time <= Date.now() ? date : undefined;
}

function cleanTags(tags: (string | undefined)[]): string[] {
  return [
    ...new Set(tags.map((tag) => tag?.trim()).filter((tag): tag is string => !!tag)),
  ];
}

const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Creates or updates contacts from another platform's export, matched by
 * email. A status can only get stricter (subscribed < unsubscribed <
 * bounced < complained): an import never re-subscribes an unsubscribed or
 * suppressed contact, and bounced or complained rows are imported
 * unsubscribed and added to the suppression list. Imports don't fire
 * sequence triggers, like Mailchimp's default for imported contacts.
 */
export async function importContacts({
  teamId,
  contacts: rows,
  tags: tagsForAll = [],
  pending = "skip",
}: {
  teamId: string;
  contacts: ImportContactRow[];
  tags?: string[];
  pending?: "skip" | "unsubscribed";
}): Promise<ImportContactsResult> {
  const result: ImportContactsResult = {
    created: 0,
    updated: 0,
    unchanged: 0,
    suppressed: 0,
    skipped: [],
  };
  const skip = (row: { row?: number }, email: string, reason: ImportSkipReason) =>
    result.skipped.push({
      ...(row.row !== undefined && { row: row.row }),
      email,
      reason,
    });

  const prepared = new Map<string, PreparedRow>();
  for (const row of rows) {
    const email = row.email.trim().toLowerCase();
    if (!emailSchema.safeParse(email).success) {
      skip(row, row.email, "invalid_email");
      continue;
    }
    if (prepared.has(email)) {
      skip(row, email, "duplicate");
      continue;
    }
    let interpreted = normalizeImportStatus(row.status);
    if ("skip" in interpreted) {
      if (interpreted.skip === "pending_confirmation" && pending === "unsubscribed") {
        interpreted = { status: "unsubscribed", tag: "pending" };
      } else {
        skip(row, email, interpreted.skip);
        continue;
      }
    }
    prepared.set(email, {
      row: row.row,
      email,
      name: row.name?.trim() || undefined,
      tags: cleanTags([...(row.tags ?? []), ...tagsForAll, interpreted.tag]),
      status: interpreted.status,
      createdAt: signupDate(row.createdAt),
      customFields:
        row.customFields && Object.keys(row.customFields).length > 0
          ? row.customFields
          : undefined,
    });
  }
  if (prepared.size === 0) return result;

  const [team] = await db
    .select({ organizationId: teams.organizationId })
    .from(teams)
    .where(eq(teams.id, teamId))
    .limit(1);
  if (!team) throw new Error("team_not_found");

  const emails = [...prepared.keys()];
  const suppressedReasons = await getActiveSuppressionReasons(teamId, emails);
  const existingRows = await db
    .select()
    .from(contacts)
    .where(and(eq(contacts.teamId, teamId), inArray(contacts.email, emails)));
  const existing = new Map(existingRows.map((contact) => [contact.email, contact]));

  // New subscribed contacts count against the plan, so work out how many
  // still fit once instead of per row.
  const { subscribedContactsLimit } = await getOrganizationEntitlements(
    team.organizationId,
  );
  let remainingSlots = Number.POSITIVE_INFINITY;
  if (subscribedContactsLimit !== null) {
    const [{ value }] = await db
      .select({ value: count() })
      .from(contacts)
      .innerJoin(teams, eq(teams.id, contacts.teamId))
      .where(
        and(
          eq(teams.organizationId, team.organizationId),
          eq(contacts.subscribed, true),
        ),
      );
    remainingSlots = Math.max(0, subscribedContactsLimit - Number(value));
  }

  const customFieldUpdates: { contactId: string; customFields: CustomFields }[] = [];
  const toInsert: (typeof contacts.$inferInsert)[] = [];
  for (const row of prepared.values()) {
    const subscribed = row.status === "subscribed" && !suppressedReasons.has(row.email);
    const current = existing.get(row.email);
    if (current) {
      const patch = updatePatch(current, row, subscribed);
      if (!patch) {
        result.unchanged++;
        continue;
      }
      await db
        .update(contacts)
        .set({ ...patch, updatedAt: new Date() })
        .where(eq(contacts.id, current.id));
      if (patch.customFields) {
        customFieldUpdates.push({
          contactId: current.id,
          customFields: patch.customFields,
        });
      }
      result.updated++;
      continue;
    }
    if (subscribed) {
      if (remainingSlots <= 0) {
        skip(row, row.email, "plan_limit_reached");
        continue;
      }
      remainingSlots--;
    }
    toInsert.push({
      teamId,
      email: row.email,
      name: row.name,
      tags: row.tags,
      customFields: row.customFields ?? {},
      subscribed,
      unsubscribeToken: generateUniqueId(),
      ...(row.createdAt && { createdAt: row.createdAt }),
    });
  }

  if (toInsert.length > 0) {
    const created = await db
      .insert(contacts)
      .values(toInsert)
      .onConflictDoNothing({ target: [contacts.teamId, contacts.email] })
      .returning({ id: contacts.id, customFields: contacts.customFields });
    result.created += created.length;
    // Created concurrently by someone else between our read and insert.
    result.unchanged += toInsert.length - created.length;
    for (const contact of created) {
      const customFields = contact.customFields as CustomFields;
      if (Object.keys(customFields).length > 0) {
        customFieldUpdates.push({ contactId: contact.id, customFields });
      }
    }
  }
  await replaceContactCustomFieldValues(teamId, customFieldUpdates);

  for (const row of prepared.values()) {
    if (row.status !== "bounced" && row.status !== "complained") continue;
    await addOrStrengthenSuppression({
      teamId,
      recipientEmail: row.email,
      reason: row.status === "bounced" ? "hard_bounce" : "complaint",
      actorType: "system",
      explanation: `Imported as ${row.status}`,
    });
    result.suppressed++;
  }

  captureEvent({
    event: "contacts_imported",
    source: "contacts.import",
    teamId,
    properties: {
      rows: rows.length,
      created: result.created,
      updated: result.updated,
      suppressed: result.suppressed,
      skipped: result.skipped.length,
    },
  });
  return result;
}

/** What an import row changes on an existing contact, or `null` for
 * nothing. Tags and custom fields merge; the name is replaced when given;
 * subscription only ever turns off; an earlier signup date wins. */
function updatePatch(
  current: Contact,
  row: PreparedRow,
  subscribed: boolean,
): Partial<
  Pick<Contact, "name" | "tags" | "customFields" | "subscribed" | "createdAt">
> | null {
  const patch: Partial<
    Pick<Contact, "name" | "tags" | "customFields" | "subscribed" | "createdAt">
  > = {};
  if (row.name && row.name !== current.name) patch.name = row.name;
  const tags = cleanTags([...current.tags, ...row.tags]);
  if (tags.length !== current.tags.length) patch.tags = tags;
  if (row.customFields) {
    const merged = { ...(current.customFields as CustomFields), ...row.customFields };
    if (!sameJson(merged, current.customFields)) patch.customFields = merged;
  }
  if (current.subscribed && !subscribed) patch.subscribed = false;
  if (row.createdAt && (!current.createdAt || row.createdAt < current.createdAt)) {
    patch.createdAt = row.createdAt;
  }
  return Object.keys(patch).length > 0 ? patch : null;
}
