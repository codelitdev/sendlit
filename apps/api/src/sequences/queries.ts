import { and, eq, count, asc } from "drizzle-orm";
import { db } from "../db/client";
import {
    sequences,
    sequenceEmails,
    emailDeliveries,
    emailEvents,
    contacts,
} from "../db/schema";
import { resolveStartingTemplate } from "../templates/queries";
import {
    addRule,
    defaultEmailContent,
    removeRule,
    verifyMandatoryTags,
} from "./helpers";
import {
    EmailActionType,
    EmailEventAction,
    EventType,
    MailType,
    itemsPerPage,
    sequenceDelayBetweenMailsInMillis,
} from "../config/constants";
import { responses } from "../config/strings";
import { captureEvent } from "../observability/posthog";
import type { ContactFilterWithAggregator } from "../contacts/segment";
import type { Email as EmailContent } from "@sendlit/email-editor";
import { syncEmailContentMediaReferences } from "../media/email-content";
import { deleteMediaReferencesForResource } from "../media/queries";

export type Sequence = typeof sequences.$inferSelect;
export type SequenceEmail = typeof sequenceEmails.$inferSelect;
export type HydratedSequence = Sequence & { emails: SequenceEmail[] };

async function hydrate(sequence: Sequence): Promise<HydratedSequence> {
    const emails = await db
        .select()
        .from(sequenceEmails)
        .where(eq(sequenceEmails.sequenceId, sequence.id))
        .orderBy(asc(sequenceEmails.createdAt));
    return { ...sequence, emails };
}

export async function createSequence({
    teamId,
    type,
    templateId,
}: {
    teamId: string;
    type: MailType;
    templateId: string;
}): Promise<HydratedSequence> {
    const template = await resolveStartingTemplate(teamId, templateId);
    if (!template) {
        throw new Error(responses.item_not_found);
    }

    const [sequence] = await db
        .insert(sequences)
        .values({
            teamId,
            type,
            title: template.title || "Untitled",
            triggerType:
                type === "broadcast"
                    ? EventType.DATE_OCCURRED
                    : EventType.SUBSCRIBER_ADDED,
            filter: { aggregator: "or", filters: [] },
        })
        .returning();

    const content = (template.content as EmailContent) || defaultEmailContent;

    const [email] = await db
        .insert(sequenceEmails)
        .values({
            sequenceId: sequence.id,
            content: content as any,
            subject:
                template.title ||
                (type === "broadcast" ? "New broadcast" : "New email"),
            delayInMillis: 0,
            published: false,
        })
        .returning();

    const reconciledContent = await syncEmailContentMediaReferences({
        teamId,
        content,
        resource: {
            resourceType: "SEQUENCE_EMAIL",
            resourceInternalId: email.id,
            resourcePublicId: email.emailId,
            parentResourceInternalId: sequence.id,
            parentResourcePublicId: sequence.sequenceId,
        },
    });
    if (reconciledContent) {
        await db
            .update(sequenceEmails)
            .set({ content: reconciledContent as any, updatedAt: new Date() })
            .where(eq(sequenceEmails.id, email.id));
    }

    const [updated] = await db
        .update(sequences)
        .set({ emailsOrder: [email.emailId] })
        .where(eq(sequences.id, sequence.id))
        .returning();

    captureEvent({
        event: "sequence_created",
        source: "sequences.create",
        teamId,
        properties: {
            sequence_id: updated.sequenceId,
            sequence_type: updated.type,
            template_id: templateId,
        },
    });

    return hydrate(updated);
}

/** Looks up a single `sequence_emails` row by its parent's **internal**
 * `sequences.id` and its own public `emailId` — used by the tracking pixel/
 * click-redirect handlers, which only have public ids from the decoded JWT
 * but need the row's internal `id` to write an `email_deliveries`/`email_events`
 * FK. */
export async function getSequenceEmailByEmailId(
    sequenceId: string,
    emailId: string,
): Promise<SequenceEmail | null> {
    const [row] = await db
        .select()
        .from(sequenceEmails)
        .where(
            and(
                eq(sequenceEmails.sequenceId, sequenceId),
                eq(sequenceEmails.emailId, emailId),
            ),
        )
        .limit(1);
    return row ?? null;
}

export async function getSequenceBySequenceId(
    teamId: string,
    sequenceId: string,
): Promise<HydratedSequence | null> {
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
    if (!row) return null;
    return hydrate(row);
}

export async function listSequences({
    teamId,
    type,
    offset = 1,
    itemsPerPage: perPage = itemsPerPage,
}: {
    teamId: string;
    type: MailType;
    offset?: number;
    itemsPerPage?: number;
}): Promise<HydratedSequence[]> {
    const rows = await db
        .select()
        .from(sequences)
        .where(and(eq(sequences.teamId, teamId), eq(sequences.type, type)))
        .limit(perPage)
        .offset((Math.max(offset, 1) - 1) * perPage);
    return Promise.all(rows.map(hydrate));
}

export async function countSequences(
    teamId: string,
    type: MailType,
): Promise<number> {
    const [row] = await db
        .select({ value: count() })
        .from(sequences)
        .where(and(eq(sequences.teamId, teamId), eq(sequences.type, type)));
    return row?.value ?? 0;
}

export async function updateSequence({
    teamId,
    sequenceId,
    title,
    triggerType,
    triggerData,
    filter,
    emailsOrder,
}: {
    teamId: string;
    sequenceId: string;
    title?: string;
    triggerType?: string;
    triggerData?: string;
    filter?: ContactFilterWithAggregator;
    emailsOrder?: string[];
}): Promise<HydratedSequence | null> {
    const patch: Partial<Sequence> = { updatedAt: new Date() };
    if (title !== undefined) patch.title = title;
    if (triggerType !== undefined) patch.triggerType = triggerType;
    if (triggerData !== undefined) patch.triggerData = triggerData;
    if (filter !== undefined) patch.filter = filter as any;
    if (emailsOrder !== undefined) patch.emailsOrder = emailsOrder;

    const [row] = await db
        .update(sequences)
        .set(patch)
        .where(
            and(
                eq(sequences.teamId, teamId),
                eq(sequences.sequenceId, sequenceId),
            ),
        )
        .returning();
    if (!row) return null;
    captureEvent({
        event: "sequence_updated",
        source: "sequences.update",
        teamId,
        properties: {
            sequence_id: row.sequenceId,
            sequence_type: row.type,
            sequence_status: row.status,
        },
    });
    return hydrate(row);
}

export async function addMailToSequence({
    teamId,
    sequenceId,
    templateId,
}: {
    teamId: string;
    sequenceId: string;
    templateId: string;
}): Promise<HydratedSequence | null> {
    const sequence = await getSequenceBySequenceId(teamId, sequenceId);
    if (!sequence) return null;
    if (sequence.type === "broadcast") {
        throw new Error(responses.action_not_allowed);
    }

    const template = await resolveStartingTemplate(teamId, templateId);
    if (!template) {
        throw new Error(responses.item_not_found);
    }

    const content = (template.content as EmailContent) || defaultEmailContent;

    const [email] = await db
        .insert(sequenceEmails)
        .values({
            sequenceId: sequence.id,
            content: content as any,
            subject: template.title || "New email",
            delayInMillis: sequenceDelayBetweenMailsInMillis,
        })
        .returning();

    const reconciledContent = await syncEmailContentMediaReferences({
        teamId,
        content,
        resource: {
            resourceType: "SEQUENCE_EMAIL",
            resourceInternalId: email.id,
            resourcePublicId: email.emailId,
            parentResourceInternalId: sequence.id,
            parentResourcePublicId: sequence.sequenceId,
        },
    });
    if (reconciledContent) {
        await db
            .update(sequenceEmails)
            .set({ content: reconciledContent as any, updatedAt: new Date() })
            .where(eq(sequenceEmails.id, email.id));
    }

    const [row] = await db
        .update(sequences)
        .set({ emailsOrder: [...sequence.emailsOrder, email.emailId] })
        .where(eq(sequences.id, sequence.id))
        .returning();

    captureEvent({
        event: "sequence_email_added",
        source: "sequences.add_mail",
        teamId,
        properties: {
            sequence_id: sequence.sequenceId,
            sequence_type: sequence.type,
            email_id: email.emailId,
            template_id: templateId,
        },
    });

    return hydrate(row);
}

function isBroadcastLocked(sequence: HydratedSequence): boolean {
    const report = (sequence.report || {}) as any;
    return (
        sequence.type === "broadcast" &&
        ["active", "completed"].includes(sequence.status) &&
        Boolean(report?.broadcast?.lockedAt)
    );
}

export async function updateMailInSequence({
    teamId,
    sequenceId,
    emailId,
    subject,
    content,
    delayInMillis,
    templateId,
    actionType,
    actionData,
    published,
}: {
    teamId: string;
    sequenceId: string;
    emailId: string;
    subject?: string;
    content?: unknown;
    delayInMillis?: number;
    templateId?: string;
    actionType?: EmailActionType;
    actionData?: Record<string, unknown>;
    published?: boolean;
}): Promise<HydratedSequence | null> {
    const sequence = await getSequenceBySequenceId(teamId, sequenceId);
    if (!sequence) return null;
    if (isBroadcastLocked(sequence)) return sequence;

    const email = sequence.emails.find((e) => e.emailId === emailId);
    if (!email) throw new Error(responses.item_not_found);

    if (content) {
        verifyMandatoryTags((content as any).content || []);
        content =
            (await syncEmailContentMediaReferences({
                teamId,
                content: content as EmailContent,
                resource: {
                    resourceType: "SEQUENCE_EMAIL",
                    resourceInternalId: email.id,
                    resourcePublicId: email.emailId,
                    parentResourceInternalId: sequence.id,
                    parentResourcePublicId: sequence.sequenceId,
                },
            })) || content;
    }

    const patch: Partial<SequenceEmail> = { updatedAt: new Date() };
    if (subject !== undefined) patch.subject = subject;
    if (content !== undefined) patch.content = content as any;
    if (delayInMillis !== undefined) patch.delayInMillis = delayInMillis;
    if (templateId !== undefined) patch.templateId = templateId;
    if (published !== undefined) patch.published = published;
    if (actionType !== undefined) patch.actionType = actionType;
    if (actionData !== undefined) patch.actionData = actionData as any;

    await db
        .update(sequenceEmails)
        .set(patch)
        .where(
            and(
                eq(sequenceEmails.sequenceId, sequence.id),
                eq(sequenceEmails.emailId, emailId),
            ),
        );

    captureEvent({
        event: "sequence_email_updated",
        source: "sequences.update_mail",
        teamId,
        properties: {
            sequence_id: sequence.sequenceId,
            sequence_type: sequence.type,
            email_id: email.emailId,
            action_type: actionType,
            template_id: templateId,
        },
    });

    return getSequenceBySequenceId(teamId, sequenceId);
}

export async function deleteMailFromSequence({
    teamId,
    sequenceId,
    emailId,
}: {
    teamId: string;
    sequenceId: string;
    emailId: string;
}): Promise<HydratedSequence | null> {
    const sequence = await getSequenceBySequenceId(teamId, sequenceId);
    if (!sequence) return null;
    if (sequence.type === "broadcast") {
        throw new Error(responses.action_not_allowed);
    }
    if (sequence.emails.length === 1) {
        throw new Error(responses.cannot_delete_last_email);
    }

    const email = sequence.emails.find((item) => item.emailId === emailId);
    if (email) {
        await deleteMediaReferencesForResource({
            teamId,
            resourceType: "SEQUENCE_EMAIL",
            resourceInternalId: email.id,
        });
    }

    await db
        .delete(sequenceEmails)
        .where(
            and(
                eq(sequenceEmails.sequenceId, sequence.id),
                eq(sequenceEmails.emailId, emailId),
            ),
        );

    await db
        .update(sequences)
        .set({
            emailsOrder: sequence.emailsOrder.filter((id) => id !== emailId),
        })
        .where(eq(sequences.id, sequence.id));

    captureEvent({
        event: "sequence_email_deleted",
        source: "sequences.delete_mail",
        teamId,
        properties: {
            sequence_id: sequence.sequenceId,
            sequence_type: sequence.type,
            email_id: emailId,
        },
    });

    return getSequenceBySequenceId(teamId, sequenceId);
}

export async function deleteSequence({
    teamId,
    sequenceId,
}: {
    teamId: string;
    sequenceId: string;
}): Promise<boolean> {
    const sequence = await getSequenceBySequenceId(teamId, sequenceId);
    if (!sequence) return false;

    for (const email of sequence.emails) {
        await deleteMediaReferencesForResource({
            teamId,
            resourceType: "SEQUENCE_EMAIL",
            resourceInternalId: email.id,
        });
    }

    await db
        .delete(sequences)
        .where(
            and(
                eq(sequences.teamId, teamId),
                eq(sequences.sequenceId, sequenceId),
            ),
        );

    captureEvent({
        event: "sequence_deleted",
        source: "sequences.delete",
        teamId,
        properties: {
            sequence_id: sequence.sequenceId,
            sequence_type: sequence.type,
        },
    });

    return true;
}

export async function startSequence({
    teamId,
    sequenceId,
}: {
    teamId: string;
    sequenceId: string;
}): Promise<HydratedSequence> {
    const sequence = await getSequenceBySequenceId(teamId, sequenceId);
    if (!sequence) throw new Error(responses.item_not_found);

    if (!["draft", "paused"].includes(sequence.status)) {
        throw new Error(responses.sequence_already_started);
    }
    if (!sequence.emails.some((e) => e.published)) {
        throw new Error(responses.no_published_emails);
    }

    if (sequence.type === "sequence") {
        // Sender identity is no longer stored per-sequence — the send path
        // always resolves one (sequence outbox -> team esp config -> team
        // name/owner email), so only title/trigger completeness is checked.
        if (!sequence.title || !sequence.triggerType) {
            throw new Error(`${responses.sequence_details_missing}: basics`);
        }
        if (
            [EventType.TAG_ADDED, EventType.TAG_REMOVED].includes(
                sequence.triggerType as any,
            ) &&
            !sequence.triggerData
        ) {
            throw new Error(`${responses.sequence_details_missing}: trigger`);
        }
    }

    // Broadcasts don't require a filter: an empty/null filter means the
    // whole audience (buildContactFilterCondition returns no condition).

    await addRule({
        teamId,
        sequenceId: sequence.id,
        triggerType: sequence.triggerType!,
        triggerData: sequence.triggerData,
        eventDateInMillis:
            sequence.type === "broadcast"
                ? sequence.emails[0].delayInMillis
                : undefined,
    });

    const [row] = await db
        .update(sequences)
        .set({ status: "active", updatedAt: new Date() })
        .where(eq(sequences.id, sequence.id))
        .returning();

    captureEvent({
        event: "sequence_started",
        source: "sequences.start",
        teamId,
        properties: {
            sequence_id: sequence.sequenceId,
            sequence_type: sequence.type,
        },
    });

    return hydrate(row);
}

export async function pauseSequence({
    teamId,
    sequenceId,
}: {
    teamId: string;
    sequenceId: string;
}): Promise<HydratedSequence> {
    const sequence = await getSequenceBySequenceId(teamId, sequenceId);
    if (!sequence) throw new Error(responses.item_not_found);
    if (sequence.status !== "active") {
        throw new Error(responses.sequence_not_active);
    }

    const report = (sequence.report || {}) as any;
    if (
        sequence.type === "broadcast" &&
        (report?.broadcast?.lockedAt ||
            sequence.emails[0].delayInMillis <= Date.now())
    ) {
        throw new Error(responses.mail_already_sent);
    }

    await removeRule({ teamId, sequenceId: sequence.id });

    const [row] = await db
        .update(sequences)
        .set({ status: "paused", updatedAt: new Date() })
        .where(eq(sequences.id, sequence.id))
        .returning();

    captureEvent({
        event: "sequence_paused",
        source: "sequences.pause",
        teamId,
        properties: {
            sequence_id: sequence.sequenceId,
            sequence_type: sequence.type,
        },
    });

    return hydrate(row);
}

/** All of these take the **public** `sequenceId` (unchanged external
 * signature for their route/mcp-tool callers) and resolve to the internal id
 * via a join through `sequences`, since `email_deliveries`/`email_events` now
 * store internal-id FKs. */

export async function getEmailSentCount(sequenceId: string): Promise<number> {
    const [row] = await db
        .select({ value: count() })
        .from(emailDeliveries)
        .innerJoin(sequences, eq(sequences.id, emailDeliveries.sequenceId))
        .where(eq(sequences.sequenceId, sequenceId));
    return row?.value ?? 0;
}

export async function getSubscribers({
    sequenceId,
    page = 1,
    limit = itemsPerPage,
}: {
    sequenceId: string;
    page?: number;
    limit?: number;
}): Promise<string[]> {
    const rows = await db
        .selectDistinct({ contactId: contacts.contactId })
        .from(emailDeliveries)
        .innerJoin(sequences, eq(sequences.id, emailDeliveries.sequenceId))
        .innerJoin(contacts, eq(contacts.id, emailDeliveries.contactId))
        .where(eq(sequences.sequenceId, sequenceId))
        .limit(limit)
        .offset((Math.max(page, 1) - 1) * limit);
    return rows.map((r) => r.contactId);
}

export async function getSubscribersCount(sequenceId: string): Promise<number> {
    const rows = await db
        .selectDistinct({ contactId: emailDeliveries.contactId })
        .from(emailDeliveries)
        .innerJoin(sequences, eq(sequences.id, emailDeliveries.sequenceId))
        .where(eq(sequences.sequenceId, sequenceId));
    return rows.length;
}

async function countDistinctContactsWithEvent(
    sequenceId: string,
    action: string,
): Promise<number> {
    const rows = await db
        .selectDistinct({ contactId: emailEvents.contactId })
        .from(emailEvents)
        .innerJoin(sequences, eq(sequences.id, emailEvents.sequenceId))
        .where(
            and(
                eq(sequences.sequenceId, sequenceId),
                eq(emailEvents.action, action),
            ),
        );
    return rows.length;
}

export async function getSequenceOpenRate(sequenceId: string): Promise<number> {
    const recipients = await getSubscribersCount(sequenceId);
    if (!recipients) return 0;
    const openers = await countDistinctContactsWithEvent(
        sequenceId,
        EmailEventAction.OPEN,
    );
    return openers / recipients;
}

export async function getSequenceClickThroughRate(
    sequenceId: string,
): Promise<number> {
    const recipients = await getSubscribersCount(sequenceId);
    if (!recipients) return 0;
    const clickers = await countDistinctContactsWithEvent(
        sequenceId,
        EmailEventAction.CLICK,
    );
    return clickers / recipients;
}
