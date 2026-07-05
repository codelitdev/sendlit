import { and, count, desc, eq, ilike, or, sql } from "drizzle-orm";
import { db } from "../db/client";
import { contacts, emailDeliveries, sequences } from "../db/schema";
import { generateUniqueId } from "../utils/id";
import { EventType, itemsPerPage } from "../config/constants";
import { fireEvent } from "../automation/fire-event";

export type Contact = typeof contacts.$inferSelect;

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
    customFields?: Record<string, string>;
}): Promise<Contact> {
    const [contact] = await db
        .insert(contacts)
        .values({
            teamId,
            contactId: generateUniqueId(),
            email: email.toLowerCase().trim(),
            name,
            tags,
            customFields,
            unsubscribeToken: generateUniqueId(),
        })
        .onConflictDoNothing({ target: [contacts.teamId, contacts.email] })
        .returning();

    if (contact) {
        await fireEvent({
            teamId,
            event: EventType.SUBSCRIBER_ADDED,
            contactId: contact.contactId,
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

export async function listContacts({
    teamId,
    searchText,
    offset = 1,
    rowsPerPage = itemsPerPage,
}: {
    teamId: string;
    searchText?: string;
    offset?: number;
    rowsPerPage?: number;
}): Promise<Contact[]> {
    const conditions = [eq(contacts.teamId, teamId)];
    if (searchText) {
        conditions.push(
            or(
                ilike(contacts.email, `%${searchText}%`),
                ilike(contacts.name, `%${searchText}%`),
            )!,
        );
    }
    return db
        .select()
        .from(contacts)
        .where(and(...conditions))
        .limit(rowsPerPage)
        .offset((Math.max(offset, 1) - 1) * rowsPerPage);
}

export async function countContacts(teamId: string): Promise<number> {
    const [row] = await db
        .select({ value: count() })
        .from(contacts)
        .where(eq(contacts.teamId, teamId));
    return row?.value ?? 0;
}

export async function updateContact(
    teamId: string,
    contactId: string,
    patch: Partial<
        Pick<
            Contact,
            "name" | "tags" | "active" | "subscribedToUpdates" | "customFields"
        >
    >,
): Promise<Contact | null> {
    const [row] = await db
        .update(contacts)
        .set({ ...patch, updatedAt: new Date() })
        .where(
            and(eq(contacts.teamId, teamId), eq(contacts.contactId, contactId)),
        )
        .returning();
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
            contactId,
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
            contactId,
        });
    }
    return row ?? null;
}

export async function deleteContact(
    teamId: string,
    contactId: string,
): Promise<void> {
    await db
        .delete(contacts)
        .where(
            and(eq(contacts.teamId, teamId), eq(contacts.contactId, contactId)),
        );
}

export interface ContactDelivery {
    sequenceId: string;
    sequenceTitle: string;
    sequenceType: string;
    emailId: string;
    createdAt: Date | null;
}

/** The broadcasts/sequence emails a contact has actually received, most
 * recent first — surfaced on the contact detail page. */
export async function getDeliveriesByContact(
    teamId: string,
    contactId: string,
): Promise<ContactDelivery[]> {
    const rows = await db
        .select({
            sequenceId: emailDeliveries.sequenceId,
            emailId: emailDeliveries.emailId,
            createdAt: emailDeliveries.createdAt,
            sequenceTitle: sequences.title,
            sequenceType: sequences.type,
        })
        .from(emailDeliveries)
        .innerJoin(
            sequences,
            eq(sequences.sequenceId, emailDeliveries.sequenceId),
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
