import { and, desc, eq, gte } from "drizzle-orm";
import { db } from "../db/client";
import { outboundMessages } from "../db/schema";
import { normalizeEmail } from "../utils/email";
import type { OutboundMessage } from "./outbound-queries";

/** How far back tier-4 (recipient + bounded window) correlation looks — see
 * `docs/bounces-and-complaints.md#6-correlation`, "a bounded send-time
 * window". */
const CORRELATION_WINDOW_DAYS = 7;

/**
 * Correlation priority per `docs/bounces-and-complaints.md#6-correlation`:
 *
 * 1. Opaque SendLit `msg_...` provider metadata/custom argument — not
 *    populated in v1. SendLit sends over generic SMTP relay rather than
 *    each provider's REST API, so provider-supported custom
 *    metadata/arguments (an API-only feature) aren't available; see
 *    `utils/rfc-message-id.ts`.
 * 2. Stored provider message ID scoped to the feedback connection.
 * 3. Stored RFC `Message-ID` scoped to the connection + recipient — not
 *    reachable either in v1: neither adapter's payload echoes the
 *    original RFC header back (Resend/Postmark webhooks report their own
 *    internally-assigned ids, not the submitted `Message-ID`).
 * 4. Provider message ID plus normalized recipient and a bounded
 *    send-time window.
 *
 * In practice this resolves to tier 2 when the event carries a provider
 * message id that matches what the SMTP transport captured (some
 * providers' SMTP relays echo their own id in the final response line —
 * see `mail/send.ts`'s `SendMailResult.providerResponse`), falling back to
 * tier 4. Every query is scoped to `connectionId`, which is itself pinned
 * to one team-owned ESP — a payload can never select its own workspace.
 */
export async function correlateOutboundMessage({
    connectionId,
    providerMessageId,
    recipientEmail,
}: {
    connectionId: string;
    providerMessageId?: string | null;
    recipientEmail?: string | null;
}): Promise<OutboundMessage | null> {
    if (providerMessageId) {
        const rows = await db
            .select()
            .from(outboundMessages)
            .where(
                and(
                    eq(outboundMessages.feedbackConnectionId, connectionId),
                    eq(outboundMessages.providerMessageId, providerMessageId),
                ),
            );
        if (rows.length === 1) return rows[0];
        if (rows.length > 1 && recipientEmail) {
            const normalized = normalizeEmail(recipientEmail);
            const narrowed = rows.filter(
                (row) => row.normalizedRecipient === normalized,
            );
            if (narrowed.length === 1) return narrowed[0];
        }
    }

    if (recipientEmail) {
        const normalized = normalizeEmail(recipientEmail);
        const windowStart = new Date(
            Date.now() - CORRELATION_WINDOW_DAYS * 24 * 60 * 60 * 1000,
        );
        const [row] = await db
            .select()
            .from(outboundMessages)
            .where(
                and(
                    eq(outboundMessages.feedbackConnectionId, connectionId),
                    eq(outboundMessages.normalizedRecipient, normalized),
                    gte(outboundMessages.createdAt, windowStart),
                ),
            )
            .orderBy(desc(outboundMessages.createdAt))
            .limit(1);
        if (row) return row;
    }

    return null;
}
