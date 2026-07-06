import { and, count, desc, eq, ilike, or, sql } from "drizzle-orm";
import type { CustomFields, CustomFieldValue } from "@sendlit/api-contract";
import { db } from "../db/client";
import {
    contactCustomFieldValues,
    contacts,
    emailDeliveries,
    sequenceEmails,
    sequences,
} from "../db/schema";
// `contacts.contactId` auto-generates via `$defaultFn` (see `db/schema.ts`);
// `generateUniqueId` is only still needed here for `unsubscribeToken`, an
// opaque secret rather than a public resource ID.
import { generateUniqueId } from "../utils/id";
import { EventType, itemsPerPage } from "../config/constants";
import { fireEvent } from "../automation/fire-event";
import {
    buildContactFilterCondition,
    type ContactFilterWithAggregator,
} from "./segment";

export type Contact = typeof contacts.$inferSelect;
type ContactListFilter =
    ContactFilterWithAggregator | ContactFilterWithAggregator[];

export async function createContact({
    teamId,
    email,
    name,
    tags = [],
    customFields = {},
}: {
    teamId: string;
    email: string;
    name?: string;
    tags?: string[];
    customFields?: CustomFields;
}): Promise<Contact> {
    const [contact] = await db
        .insert(contacts)
        .values({
            teamId,
            email: email.toLowerCase().trim(),
            name,
            tags,
            customFields,
            unsubscribeToken: generateUniqueId(),
        })
        .onConflictDoNothing({ target: [contacts.teamId, contacts.email] })
        .returning();

    if (contact) {
        await syncContactCustomFieldValues({
            teamId,
            contactId: contact.id,
            customFields,
        });
        await fireEvent({
            teamId,
            event: EventType.SUBSCRIBER_ADDED,
            contactId: contact.id,
        });
        return contact;
    }

    // Already existed — return the existing row (mirrors CourseLit's
    // createSubscription which is a find-or-create).
    const existing = await findContactByEmail(teamId, email);
    return existing as Contact;
}

export async function findContactByEmail(
    teamId: string,
    email: string,
): Promise<Contact | null> {
    const [row] = await db
        .select()
        .from(contacts)
        .where(
            and(
                eq(contacts.teamId, teamId),
                eq(contacts.email, email.toLowerCase().trim()),
            ),
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
    const [row] = await db
        .select()
        .from(contacts)
        .where(eq(contacts.id, id))
        .limit(1);
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

function listContactsConditions({
    teamId,
    searchText,
    filter,
}: {
    teamId: string;
    searchText?: string;
    filter?: ContactListFilter;
}) {
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
    return and(...conditions);
}

export async function listContacts({
    teamId,
    searchText,
    filter,
    offset = 1,
    rowsPerPage = itemsPerPage,
}: {
    teamId: string;
    searchText?: string;
    filter?: ContactListFilter;
    offset?: number;
    rowsPerPage?: number;
}): Promise<Contact[]> {
    return db
        .select()
        .from(contacts)
        .where(listContactsConditions({ teamId, searchText, filter }))
        .limit(rowsPerPage)
        .offset((Math.max(offset, 1) - 1) * rowsPerPage);
}

export async function countContacts(
    teamId: string,
    {
        searchText,
        filter,
    }: { searchText?: string; filter?: ContactListFilter } = {},
): Promise<number> {
    const [row] = await db
        .select({ value: count() })
        .from(contacts)
        .where(listContactsConditions({ teamId, searchText, filter }));
    return row?.value ?? 0;
}

export async function updateContact(
    teamId: string,
    contactId: string,
    patch: Partial<
        Pick<Contact, "name" | "tags" | "subscribed" | "customFields">
    >,
): Promise<Contact | null> {
    const [row] = await db
        .update(contacts)
        .set({ ...patch, updatedAt: new Date() })
        .where(
            and(eq(contacts.teamId, teamId), eq(contacts.contactId, contactId)),
        )
        .returning();
    if (row && Object.prototype.hasOwnProperty.call(patch, "customFields")) {
        await syncContactCustomFieldValues({
            teamId,
            contactId: row.id,
            customFields: patch.customFields ?? {},
        });
    }
    return row ?? null;
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
        .where(
            and(eq(contacts.teamId, teamId), eq(contacts.contactId, contactId)),
        )
        .returning();
    if (row) {
        await fireEvent({
            teamId,
            event: EventType.TAG_ADDED,
            eventData: tag,
            contactId: row.id,
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
        .where(
            and(eq(contacts.teamId, teamId), eq(contacts.contactId, contactId)),
        )
        .returning();
    if (row) {
        await fireEvent({
            teamId,
            event: EventType.TAG_REMOVED,
            eventData: tag,
            contactId: row.id,
        });
    }
    return row ?? null;
}

export async function deleteContact(
    teamId: string,
    contactId: string,
): Promise<void> {
    // `contact_custom_field_values.contact_id` is now an internal-id FK with
    // `ON DELETE CASCADE`, so deleting the contact row below cascades to its
    // custom field values automatically — no separate delete needed.
    await db
        .delete(contacts)
        .where(
            and(eq(contacts.teamId, teamId), eq(contacts.contactId, contactId)),
        );
}

function scalarValues(
    value: CustomFieldValue,
): Array<string | number | boolean> {
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
    await db
        .delete(contactCustomFieldValues)
        .where(
            and(
                eq(contactCustomFieldValues.teamId, teamId),
                eq(contactCustomFieldValues.contactId, contactId),
            ),
        );

    const rows = Object.entries(customFields).flatMap(([key, value]) =>
        scalarValues(value).map((item) =>
            customFieldRow({ teamId, contactId, key, value: item }),
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
        .innerJoin(
            sequenceEmails,
            eq(sequenceEmails.id, emailDeliveries.emailId),
        )
        .where(
            and(
                eq(emailDeliveries.teamId, teamId),
                eq(emailDeliveries.contactId, contactId),
            ),
        )
        .orderBy(desc(emailDeliveries.createdAt));
    return rows;
}
