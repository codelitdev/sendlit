import type { CustomFields, CustomFieldValue } from "@sendlit/api-contract";
import { and, count, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import { fireEvent } from "../automation/fire-event";
import { reserveSubscribedContactSlot } from "../billing/entitlements";
import { EventType, itemsPerPage } from "../config/constants";
import { db } from "../db/client";
import {
  contactCustomFieldValues,
  contacts,
  emailDeliveries,
  sequenceEmails,
  sequences,
  teams,
} from "../db/schema";
import { getActiveSuppressionReasons } from "../delivery-feedback/suppression-queries";
import { captureEvent } from "../observability";
import { normalizeEmail } from "../utils/email";
// `contacts.contactId` auto-generates via `$defaultFn` (see `db/schema.ts`);
// `generateUniqueId` is only still needed here for `unsubscribeToken`, an
// opaque secret rather than a public resource ID.
import { generateUniqueId } from "../utils/id";
import {
  buildContactExclusionCondition,
  buildContactFilterCondition,
  type ContactFilterWithAggregator,
} from "./segment";

export type Contact = typeof contacts.$inferSelect;
type ContactListFilter = ContactFilterWithAggregator | ContactFilterWithAggregator[];

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type CreateContactInput = {
  teamId: string;
  email: string;
  name?: string;
  tags?: string[];
  customFields?: CustomFields;
};

/** Find-or-create inside the caller's transaction. Pair it with
 * `afterContactCreated` once the transaction commits. */
export async function createContactInTx(
  tx: Tx,
  { teamId, email, name, tags = [], customFields = {} }: CreateContactInput,
): Promise<{ contact: Contact; created: boolean }> {
  // Someone who reported spam stays unsubscribed even when re-added.
  const complained =
    (await getActiveSuppressionReasons(teamId, [email], tx)).get(
      normalizeEmail(email),
    ) === "complaint";
  const [team] = await tx
    .select({ organizationId: teams.organizationId })
    .from(teams)
    .where(eq(teams.id, teamId))
    .limit(1);
  if (!team) throw new Error("team_not_found");
  const [existing] = await tx
    .select()
    .from(contacts)
    .where(
      and(eq(contacts.teamId, teamId), eq(contacts.email, email.toLowerCase().trim())),
    )
    .limit(1)
    .for("update");
  if (existing) return { contact: existing, created: false };
  if (!complained) {
    await reserveSubscribedContactSlot(tx, team.organizationId, teamId);
  }
  const [created] = await tx
    .insert(contacts)
    .values({
      teamId,
      email: email.toLowerCase().trim(),
      name,
      tags,
      customFields,
      subscribed: !complained,
      unsubscribeToken: generateUniqueId(),
    })
    .onConflictDoNothing({ target: [contacts.teamId, contacts.email] })
    .returning();
  if (created) return { contact: created, created: true };
  const [raced] = await tx
    .select()
    .from(contacts)
    .where(
      and(eq(contacts.teamId, teamId), eq(contacts.email, email.toLowerCase().trim())),
    )
    .limit(1);
  if (!raced) throw new Error("contact_create_race_failed");
  return { contact: raced, created: false };
}

/** Side effects of a new contact, run after its transaction commits.
 * `fireTriggers: false` creates it silently, the way imports and
 * backfilled events do. */
export async function afterContactCreated(
  contact: Contact,
  { fireTriggers = true }: { fireTriggers?: boolean } = {},
) {
  await syncContactCustomFieldValues({
    teamId: contact.teamId,
    contactId: contact.id,
    customFields: contact.customFields as CustomFields,
  });
  if (fireTriggers) {
    await fireEvent({
      teamId: contact.teamId,
      event: EventType.SUBSCRIBER_ADDED,
      contactId: contact.id,
    });
  }
  captureEvent({
    event: "contact_created",
    source: "contacts.create",
    teamId: contact.teamId,
    properties: { contact_id: contact.contactId },
  });
}

export async function createContact(input: CreateContactInput): Promise<Contact> {
  const result = await db.transaction((tx) => createContactInTx(tx, input));
  if (result.created) await afterContactCreated(result.contact);
  return result.contact;
}

/** Shallow-merges incoming custom fields into the current ones. `null` when
 * nothing would change. */
export function mergeCustomFields(
  current: CustomFields,
  incoming: CustomFields,
): CustomFields | null {
  const merged = { ...current, ...incoming };
  return JSON.stringify(merged) === JSON.stringify(current) ? null : merged;
}

export async function findContactByEmail(
  teamId: string,
  email: string,
): Promise<Contact | null> {
  const [row] = await db
    .select()
    .from(contacts)
    .where(
      and(eq(contacts.teamId, teamId), eq(contacts.email, email.toLowerCase().trim())),
    )
    .limit(1);
  return row ?? null;
}

export async function getContactByContactId(
  contactId: string,
): Promise<Contact | null> {
  const [row] = await db
    .select()
    .from(contacts)
    .where(eq(contacts.contactId, contactId))
    .limit(1);
  return row ?? null;
}

export async function getContactById(id: string): Promise<Contact | null> {
  const [row] = await db.select().from(contacts).where(eq(contacts.id, id)).limit(1);
  return row ?? null;
}

export async function getContactByUnsubscribeToken(
  token: string,
): Promise<Contact | null> {
  const [row] = await db
    .select()
    .from(contacts)
    .where(eq(contacts.unsubscribeToken, token))
    .limit(1);
  return row ?? null;
}

interface ContactListQuery {
  searchText?: string;
  filter?: ContactListFilter;
  /** Contacts matching this filter are left out. */
  excludeFilter?: ContactFilterWithAggregator;
}

export function listContactsConditions({
  teamId,
  searchText,
  filter,
  excludeFilter,
}: ContactListQuery & { teamId: string }) {
  const conditions = [eq(contacts.teamId, teamId)];
  if (searchText) {
    conditions.push(
      or(
        ilike(contacts.email, `%${searchText}%`),
        ilike(contacts.name, `%${searchText}%`),
      )!,
    );
  }
  const filters = Array.isArray(filter) ? filter : filter ? [filter] : [];
  for (const contactFilter of filters) {
    const filterCondition = buildContactFilterCondition(contactFilter);
    if (filterCondition) {
      conditions.push(filterCondition);
    }
  }
  const exclusion = buildContactExclusionCondition(excludeFilter);
  if (exclusion) conditions.push(exclusion);
  return and(...conditions);
}

export async function listContacts({
  offset = 1,
  rowsPerPage = itemsPerPage,
  ...query
}: ContactListQuery & {
  teamId: string;
  offset?: number;
  rowsPerPage?: number;
}): Promise<Contact[]> {
  return db
    .select()
    .from(contacts)
    .where(listContactsConditions(query))
    .limit(rowsPerPage)
    .offset((Math.max(offset, 1) - 1) * rowsPerPage);
}

export async function countContacts(
  teamId: string,
  query: ContactListQuery = {},
): Promise<number> {
  const [row] = await db
    .select({ value: count() })
    .from(contacts)
    .where(listContactsConditions({ ...query, teamId }));
  return row?.value ?? 0;
}

export type ContactPatch = Partial<
  Pick<Contact, "name" | "tags" | "subscribed" | "customFields">
>;

/** Updates a contact (public id) inside the caller's transaction, after
 * locking its row. With `mergeCustomFields`, `patch.customFields` is merged
 * into the locked row's fields instead of replacing them. Pair it with
 * `afterContactUpdated` once the transaction commits. */
export async function updateContactInTx(
  tx: Tx,
  teamId: string,
  contactId: string,
  patch: ContactPatch,
  { mergeCustomFields: merge = false }: { mergeCustomFields?: boolean } = {},
): Promise<{ row: Contact; previous: Contact } | null> {
  const [current] = await tx
    .select()
    .from(contacts)
    .where(and(eq(contacts.teamId, teamId), eq(contacts.contactId, contactId)))
    .limit(1)
    .for("update");
  if (!current) return null;
  const effective: ContactPatch = { ...patch };
  if (merge && patch.customFields) {
    const merged = mergeCustomFields(
      current.customFields as CustomFields,
      patch.customFields,
    );
    if (merged) effective.customFields = merged;
    else delete effective.customFields;
  }
  if (effective.subscribed === true && !current.subscribed) {
    const [team] = await tx
      .select({ organizationId: teams.organizationId })
      .from(teams)
      .where(eq(teams.id, teamId))
      .limit(1);
    if (!team) throw new Error("team_not_found");
    await reserveSubscribedContactSlot(tx, team.organizationId, teamId);
  }
  if (Object.keys(effective).length === 0) return { row: current, previous: current };
  const [updated] = await tx
    .update(contacts)
    .set({ ...effective, updatedAt: new Date() })
    .where(eq(contacts.id, current.id))
    .returning();
  return updated ? { row: updated, previous: current } : null;
}

/** Side effects of a contact update, run after its transaction commits:
 * the custom-field index, telemetry, and `contact:property_changed` for
 * each custom field whose value changed (unless `fireTriggers` is false). */
export async function afterContactUpdated(
  { row, previous }: { row: Contact; previous: Contact },
  {
    fireTriggers = true,
    customFieldsWritten = false,
  }: {
    fireTriggers?: boolean;
    /** Rebuild the custom-field index even if the values didn't change. */
    customFieldsWritten?: boolean;
  } = {},
) {
  const before = previous.customFields as CustomFields;
  const after = row.customFields as CustomFields;
  const changedKeys = [
    ...new Set([...Object.keys(before), ...Object.keys(after)]),
  ].filter((key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]));
  if (customFieldsWritten || changedKeys.length > 0) {
    await syncContactCustomFieldValues({
      teamId: row.teamId,
      contactId: row.id,
      customFields: after,
    });
  }
  captureEvent({
    event: "contact_updated",
    source: "contacts.update",
    teamId: row.teamId,
    properties: { contact_id: row.contactId },
  });
  if (!fireTriggers) return;
  for (const key of changedKeys) {
    await fireEvent({
      teamId: row.teamId,
      event: EventType.CONTACT_PROPERTY_CHANGED,
      eventData: key,
      contactId: row.id,
      payload: { key, from: before[key] ?? null, to: after[key] ?? null },
    });
  }
}

export async function updateContact(
  teamId: string,
  contactId: string,
  patch: ContactPatch,
): Promise<Contact | null> {
  const result = await db.transaction((tx) =>
    updateContactInTx(tx, teamId, contactId, patch),
  );
  if (!result) return null;
  await afterContactUpdated(result, {
    customFieldsWritten: Object.hasOwn(patch, "customFields"),
  });
  return result.row;
}

export async function addTagToContact(
  teamId: string,
  contactId: string,
  tag: string,
): Promise<Contact | null> {
  const [row] = await db
    .update(contacts)
    .set({
      tags: sql`array_append(array_remove(${contacts.tags}, ${tag}), ${tag})`,
      updatedAt: new Date(),
    })
    .where(and(eq(contacts.teamId, teamId), eq(contacts.contactId, contactId)))
    .returning();
  if (row) {
    await fireEvent({
      teamId,
      event: EventType.TAG_ADDED,
      eventData: tag,
      contactId: row.id,
    });
    captureEvent({
      event: "contact_tag_added",
      source: "contacts.add_tag",
      teamId,
      properties: { contact_id: row.contactId },
    });
  }
  return row ?? null;
}

export async function removeTagFromContact(
  teamId: string,
  contactId: string,
  tag: string,
): Promise<Contact | null> {
  const [row] = await db
    .update(contacts)
    .set({
      tags: sql`array_remove(${contacts.tags}, ${tag})`,
      updatedAt: new Date(),
    })
    .where(and(eq(contacts.teamId, teamId), eq(contacts.contactId, contactId)))
    .returning();
  if (row) {
    await fireEvent({
      teamId,
      event: EventType.TAG_REMOVED,
      eventData: tag,
      contactId: row.id,
    });
    captureEvent({
      event: "contact_tag_removed",
      source: "contacts.remove_tag",
      teamId,
      properties: { contact_id: row.contactId },
    });
  }
  return row ?? null;
}

export async function deleteContact(teamId: string, contactId: string): Promise<void> {
  // `contact_custom_field_values.contact_id` is now an internal-id FK with
  // `ON DELETE CASCADE`, so deleting the contact row below cascades to its
  // custom field values automatically — no separate delete needed.
  await db
    .delete(contacts)
    .where(and(eq(contacts.teamId, teamId), eq(contacts.contactId, contactId)));
  captureEvent({
    event: "contact_deleted",
    source: "contacts.delete",
    teamId,
    properties: { contact_id: contactId },
  });
}

function scalarValues(value: CustomFieldValue): Array<string | number | boolean> {
  return Array.isArray(value) ? value : [value];
}

function customFieldRow({
  teamId,
  contactId,
  key,
  value,
}: {
  teamId: string;
  contactId: string;
  key: string;
  value: string | number | boolean;
}) {
  if (typeof value === "number") {
    return {
      teamId,
      contactId,
      key,
      valueType: "number",
      valueNumber: value,
    };
  }
  if (typeof value === "boolean") {
    return {
      teamId,
      contactId,
      key,
      valueType: "boolean",
      valueBoolean: value,
    };
  }

  const date = new Date(value);
  if (Number.isFinite(date.getTime())) {
    return {
      teamId,
      contactId,
      key,
      valueType: "date",
      valueText: value,
      valueDate: date,
    };
  }

  return {
    teamId,
    contactId,
    key,
    valueType: "string",
    valueText: value,
  };
}

async function syncContactCustomFieldValues({
  teamId,
  contactId,
  customFields,
}: {
  teamId: string;
  contactId: string;
  customFields: CustomFields;
}) {
  await replaceContactCustomFieldValues(teamId, [{ contactId, customFields }]);
}

/** Rewrites the searchable custom-field index of many contacts (internal
 * ids) in two statements. */
export async function replaceContactCustomFieldValues(
  teamId: string,
  entries: { contactId: string; customFields: CustomFields }[],
) {
  if (entries.length === 0) return;
  await db.delete(contactCustomFieldValues).where(
    and(
      eq(contactCustomFieldValues.teamId, teamId),
      inArray(
        contactCustomFieldValues.contactId,
        entries.map((entry) => entry.contactId),
      ),
    ),
  );

  const rows = entries.flatMap(({ contactId, customFields }) =>
    Object.entries(customFields).flatMap(([key, value]) =>
      scalarValues(value).map((item) =>
        customFieldRow({ teamId, contactId, key, value: item }),
      ),
    ),
  );

  if (rows.length) {
    await db.insert(contactCustomFieldValues).values(rows);
  }
}

export interface ContactDelivery {
  sequenceId: string;
  sequenceTitle: string;
  sequenceType: string;
  emailId: string;
  createdAt: Date | null;
}

/** The broadcasts/sequence emails a contact has actually received, most
 * recent first — surfaced on the contact detail page. `contactId` here is the
 * contact's **internal** id (callers already have the `Contact` row loaded). */
export async function getDeliveriesByContact(
  teamId: string,
  contactId: string,
): Promise<ContactDelivery[]> {
  const rows = await db
    .select({
      sequenceId: sequences.sequenceId,
      emailId: sequenceEmails.emailId,
      createdAt: emailDeliveries.createdAt,
      sequenceTitle: sequences.title,
      sequenceType: sequences.type,
    })
    .from(emailDeliveries)
    .innerJoin(sequences, eq(sequences.id, emailDeliveries.sequenceId))
    .innerJoin(sequenceEmails, eq(sequenceEmails.id, emailDeliveries.emailId))
    .where(
      and(eq(emailDeliveries.teamId, teamId), eq(emailDeliveries.contactId, contactId)),
    )
    .orderBy(desc(emailDeliveries.createdAt));
  return rows;
}
