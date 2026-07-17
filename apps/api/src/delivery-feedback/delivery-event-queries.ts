import { and, count, desc, eq, gte, lt } from "drizzle-orm";
import { db } from "../db/client";
import { emailDeliveryEvents, outboundMessages } from "../db/schema";
import { itemsPerPage as defaultItemsPerPage } from "../config/constants";
import type {
    BounceClass,
    DeliveryEventType,
    DeliveryRoute,
} from "../config/constants";

export type DeliveryEvent = typeof emailDeliveryEvents.$inferSelect;

/** `reason` is length-limited before storage — an adapter must not copy
 * unbounded provider diagnostic text wholesale (PRD: "Reason fields are
 * length-limited and sanitized"). */
const MAX_REASON_LENGTH = 500;

/**
 * Inserts a canonical event, or returns `null` if one with the same
 * `(connectionId, providerEventKey)` already exists — the unique index is
 * the actual idempotency guarantee; this makes replaying a receipt (retry,
 * duplicate delivery) a safe no-op after the first insert.
 */
export async function insertCanonicalEventIfNew(input: {
    connectionId: string;
    receiptId: string;
    teamId: string | null;
    provider: string;
    providerEventKey: string;
    providerMessageId: string | null;
    recipientEmail: string | null;
    normalizedRecipient: string | null;
    eventType: DeliveryEventType;
    bounceClass: BounceClass | null;
    smtpCode: number | null;
    enhancedStatusCode: string | null;
    reason: string | null;
    remoteMta: string | null;
    occurredAt: Date;
    receivedAt: Date;
    metadata: Record<string, unknown>;
}): Promise<DeliveryEvent | null> {
    const [row] = await db
        .insert(emailDeliveryEvents)
        .values({
            ...input,
            reason: input.reason?.slice(0, MAX_REASON_LENGTH) ?? null,
        })
        .onConflictDoNothing({
            target: [
                emailDeliveryEvents.connectionId,
                emailDeliveryEvents.providerEventKey,
            ],
        })
        .returning();
    return row ?? null;
}

export async function linkEventToOutboundMessage(
    eventId: string,
    outboundMessageId: string,
    teamId: string,
): Promise<void> {
    await db
        .update(emailDeliveryEvents)
        .set({ outboundMessageId, teamId })
        .where(eq(emailDeliveryEvents.id, eventId));
}

export async function getDeliveryEventByEventId(
    teamId: string,
    eventId: string,
): Promise<DeliveryEvent | null> {
    const [row] = await db
        .select()
        .from(emailDeliveryEvents)
        .where(
            and(
                eq(emailDeliveryEvents.teamId, teamId),
                eq(emailDeliveryEvents.eventId, eventId),
            ),
        )
        .limit(1);
    return row ?? null;
}

interface DeliveryEventFilters {
    teamId: string;
    eventType?: DeliveryEventType;
    /** Internal `esp_configs.id` — resolved from the public `espId` by the
     * route layer. */
    espConfigId?: string;
    deliveryRoute?: DeliveryRoute;
    createdAfter?: number;
    createdBefore?: number;
}

function listConditions({
    teamId,
    eventType,
    espConfigId,
    deliveryRoute,
    createdAfter,
    createdBefore,
}: DeliveryEventFilters) {
    const conditions = [eq(emailDeliveryEvents.teamId, teamId)];
    if (eventType)
        conditions.push(eq(emailDeliveryEvents.eventType, eventType));
    if (espConfigId)
        conditions.push(eq(outboundMessages.espConfigId, espConfigId));
    if (deliveryRoute)
        conditions.push(eq(outboundMessages.deliveryRoute, deliveryRoute));
    if (createdAfter !== undefined) {
        conditions.push(
            gte(emailDeliveryEvents.occurredAt, new Date(createdAfter)),
        );
    }
    if (createdBefore !== undefined) {
        conditions.push(
            lt(emailDeliveryEvents.occurredAt, new Date(createdBefore)),
        );
    }
    return and(...conditions);
}

/** `espId`/`deliveryRoute` filters require a join to `outbound_messages` —
 * always joined for simplicity (a left join over an indexed FK is cheap
 * even when the extra filters aren't used). */
export async function listDeliveryEvents({
    offset = 1,
    rowsPerPage = defaultItemsPerPage,
    ...filters
}: DeliveryEventFilters & {
    offset?: number;
    rowsPerPage?: number;
}): Promise<DeliveryEvent[]> {
    const rows = await db
        .select({ event: emailDeliveryEvents })
        .from(emailDeliveryEvents)
        .leftJoin(
            outboundMessages,
            eq(emailDeliveryEvents.outboundMessageId, outboundMessages.id),
        )
        .where(listConditions(filters))
        .orderBy(desc(emailDeliveryEvents.occurredAt))
        .limit(rowsPerPage)
        .offset((Math.max(offset, 1) - 1) * rowsPerPage);
    return rows.map((r) => r.event);
}

export async function countDeliveryEvents(
    filters: DeliveryEventFilters,
): Promise<number> {
    const [row] = await db
        .select({ value: count() })
        .from(emailDeliveryEvents)
        .leftJoin(
            outboundMessages,
            eq(emailDeliveryEvents.outboundMessageId, outboundMessages.id),
        )
        .where(listConditions(filters));
    return row?.value ?? 0;
}
