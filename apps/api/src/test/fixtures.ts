import { defaultEmail } from "@sendlit/email-editor";
import * as schema from "../db/schema";
import type { makeTestDb } from "./db";

/**
 * A renderable email body: a text block carrying Liquid merge tags and a link
 * that the click-tracking rewrite should pick up (`renderEmailToHtml` runs
 * first, then Liquid, then link rewriting — see
 * `automation/process-ongoing-sequence.ts#attemptMailSending`).
 */
export function emailContent({
    text = "Hello {{ subscriber.name }}! Unsub: {{ unsubscribe_link }}",
    linkUrl = "https://example.com/offer",
}: { text?: string; linkUrl?: string } = {}) {
    return {
        ...defaultEmail,
        content: [
            { blockType: "text", settings: { content: text } },
            { blockType: "link", settings: { text: "Click me", url: linkUrl } },
        ],
    };
}

/**
 * Inserts a sequence plus its emails (all published unless overridden),
 * wiring `emailsOrder` in the given order.
 */
export async function seedSequence(
    db: Awaited<ReturnType<typeof makeTestDb>>,
    {
        teamId,
        type = "sequence",
        status = "active",
        report,
        emails,
    }: {
        teamId: string;
        type?: "sequence" | "broadcast";
        status?: string;
        report?: Record<string, unknown>;
        emails: Array<{
            emailId: string;
            subject?: string;
            delayInMillis?: number;
            published?: boolean;
            actionType?: string;
            actionData?: Record<string, unknown>;
        }>;
    },
) {
    const [sequenceRow] = await db
        .insert(schema.sequences)
        .values({
            teamId,
            type,
            status,
            // Broadcasts reach ongoing_sequences via `processRule`, which runs
            // `lockBroadcast` and thus guarantees `report.broadcast` exists
            // before any delivery — `markBroadcastSent`'s jsonb_set relies on
            // that. Mirror it here for `type: "broadcast"` fixtures.
            report:
                report ??
                (type === "broadcast"
                    ? { broadcast: { lockedAt: Date.now(), sentAt: null } }
                    : {}),
            title: "Test sequence",
            emailsOrder: emails.map((e) => e.emailId),
        })
        .returning();

    const emailRows = await db
        .insert(schema.sequenceEmails)
        .values(
            emails.map((e) => ({
                sequenceId: sequenceRow.id,
                emailId: e.emailId,
                subject: e.subject ?? `Subject for ${e.emailId}`,
                content: emailContent(),
                delayInMillis: e.delayInMillis ?? 86400000,
                published: e.published ?? true,
                actionType: e.actionType,
                actionData: e.actionData,
            })),
        )
        .returning();

    return { sequenceRow, emailRows };
}

/** Inserts one ongoing_sequences row (due now unless overridden). */
export async function seedOngoingSequence(
    db: Awaited<ReturnType<typeof makeTestDb>>,
    values: {
        teamId: string;
        sequenceId: string;
        contactId: string;
        nextEmailScheduledTime?: number;
        sentEmailIds?: string[];
        retryCount?: number;
    },
) {
    const [row] = await db
        .insert(schema.ongoingSequences)
        .values({
            nextEmailScheduledTime: Date.now() - 1000,
            ...values,
        })
        .returning();
    return row;
}
