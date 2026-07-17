import { and, eq, inArray } from "drizzle-orm";
import { db } from "../db/client";
import { outboundMessages } from "../db/schema";
import type { DeliveryRoute, OutboundSourceType } from "../config/constants";

export type OutboundMessage = typeof outboundMessages.$inferSelect;

/**
 * Inserts the common outbound-message ledger row *before* transport
 * submission, per `docs/bounces-and-complaints.md#1-outbound-message-ledger`.
 * Exactly one of `campaignDeliveryId`/`transactionalEmailId` must be passed,
 * matching `sourceType`.
 */
export async function createOutboundMessage(input: {
    teamId: string;
    deliveryRoute: DeliveryRoute;
    espConfigId: string | null;
    feedbackConnectionId: string | null;
    sourceType: OutboundSourceType;
    submissionKey?: string | null;
    campaignDeliveryId?: string | null;
    transactionalEmailId?: string | null;
    recipientEmail: string;
    normalizedRecipient: string;
    provider: string | null;
    rfcMessageId: string;
}): Promise<OutboundMessage> {
    const [row] = await db
        .insert(outboundMessages)
        .values({
            teamId: input.teamId,
            deliveryRoute: input.deliveryRoute,
            espConfigId: input.espConfigId,
            feedbackConnectionId: input.feedbackConnectionId,
            sourceType: input.sourceType,
            submissionKey: input.submissionKey ?? null,
            campaignDeliveryId: input.campaignDeliveryId ?? null,
            transactionalEmailId: input.transactionalEmailId ?? null,
            recipientEmail: input.recipientEmail,
            normalizedRecipient: input.normalizedRecipient,
            provider: input.provider,
            rfcMessageId: input.rfcMessageId,
        })
        .onConflictDoNothing({ target: outboundMessages.submissionKey })
        .returning();
    if (row) return row;
    if (!input.submissionKey) {
        throw new Error("outbound_message_not_created");
    }
    const [existing] = await db
        .select()
        .from(outboundMessages)
        .where(eq(outboundMessages.submissionKey, input.submissionKey))
        .limit(1);
    if (!existing) throw new Error("outbound_message_not_created");
    return existing;
}

/** Called right after a successful transport submission. `accepted` never
 * overwrites a terminal status a very-fast webhook may have already
 * projected (see the projection ordering rules) — this only ever transitions
 * a fresh `queued` row, so no guard is needed here beyond the WHERE clause
 * matching the still-queued row. The campaign send path doesn't know its
 * `email_deliveries` row until *after* a successful send (that row is the
 * "sent" log, not a pre-send intent record), so `campaignDeliveryId` is
 * threaded through and linked here rather than at ledger-creation time. */
export async function markOutboundAccepted(
    id: string,
    {
        providerMessageId,
        campaignDeliveryId,
    }: { providerMessageId: string | null; campaignDeliveryId?: string },
): Promise<void> {
    await db
        .update(outboundMessages)
        .set({
            deliveryStatus: "accepted",
            acceptedAt: new Date(),
            lastEventAt: new Date(),
            providerMessageId,
            ...(campaignDeliveryId ? { campaignDeliveryId } : {}),
            updatedAt: new Date(),
        })
        .where(
            and(
                eq(outboundMessages.id, id),
                eq(outboundMessages.deliveryStatus, "queued"),
            ),
        );
}

/** Called only for a *final* transport failure (not a transient retry still
 * in flight) — mirrors the synchronous SMTP `5xx` handling the transactional
 * pipeline already had, now recorded on the shared ledger too. */
export async function markOutboundFailed(id: string): Promise<void> {
    await db
        .update(outboundMessages)
        .set({
            deliveryStatus: "failed",
            lastEventAt: new Date(),
            updatedAt: new Date(),
        })
        .where(
            and(
                eq(outboundMessages.id, id),
                eq(outboundMessages.deliveryStatus, "queued"),
            ),
        );
}

/** Mirrors a synchronous SMTP `5xx` permanent rejection onto the ledger —
 * there is no webhook receipt/event backing this transition (the mail
 * server rejected it inline), so it updates the projection directly rather
 * than going through `email_delivery_events`. Per the projection ordering
 * rules a hard bounce may follow `delivered` (the receiving system first
 * accepted, then later rejected) but never regresses an already-terminal
 * `bounced`/`failed` row. */
export async function markOutboundBounced(id: string): Promise<void> {
    await db
        .update(outboundMessages)
        .set({
            deliveryStatus: "bounced",
            bouncedAt: new Date(),
            lastEventAt: new Date(),
            updatedAt: new Date(),
        })
        .where(
            and(
                eq(outboundMessages.id, id),
                inArray(outboundMessages.deliveryStatus, [
                    "queued",
                    "accepted",
                    "delayed",
                    "delivered",
                ]),
            ),
        );
}

export async function getOutboundMessageById(
    id: string,
): Promise<OutboundMessage | null> {
    const [row] = await db
        .select()
        .from(outboundMessages)
        .where(eq(outboundMessages.id, id))
        .limit(1);
    return row ?? null;
}

/** Batch lookup for building delivery-event list responses — avoids one
 * query per row when enriching a page of events with their outbound
 * message's `espId`/`deliveryRoute`/public `messageId`. */
export async function getOutboundMessagesByIds(
    ids: string[],
): Promise<Map<string, OutboundMessage>> {
    if (ids.length === 0) return new Map();
    const rows = await db
        .select()
        .from(outboundMessages)
        .where(inArray(outboundMessages.id, [...new Set(ids)]));
    return new Map(rows.map((row) => [row.id, row]));
}

export async function getOutboundMessageByMessageId(
    messageId: string,
): Promise<OutboundMessage | null> {
    const [row] = await db
        .select()
        .from(outboundMessages)
        .where(eq(outboundMessages.messageId, messageId))
        .limit(1);
    return row ?? null;
}

/** Used by the transactional worker to load the ledger row created at
 * enqueue time, so it can submit the same `rfcMessageId` and record the
 * transport result. */
export async function getOutboundMessageByTransactionalEmailId(
    transactionalEmailId: string,
): Promise<OutboundMessage | null> {
    const [row] = await db
        .select()
        .from(outboundMessages)
        .where(eq(outboundMessages.transactionalEmailId, transactionalEmailId))
        .limit(1);
    return row ?? null;
}

/** Used by the campaign send path to load the ledger row created just
 * before transport, so it can record the transport result. */
export async function getOutboundMessageByCampaignDeliveryId(
    campaignDeliveryId: string,
): Promise<OutboundMessage | null> {
    const [row] = await db
        .select()
        .from(outboundMessages)
        .where(eq(outboundMessages.campaignDeliveryId, campaignDeliveryId))
        .limit(1);
    return row ?? null;
}
