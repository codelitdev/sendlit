import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { outboundMessages } from "../db/schema";
import type { DeliveryEventType } from "../config/constants";

const TERMINAL_DELIVERY_STATUSES = new Set(["bounced", "failed"]);

/**
 * Applies one canonical event to the `outbound_messages` current-state
 * projection, per the ordering rules in
 * `docs/bounces-and-complaints.md#7-delivery-state-projection`:
 *
 * - `accepted`/`delayed` never overwrite `delivered`/`bounced`/`failed`.
 * - `delivered` becomes current unless the message is already
 *   `bounced`/`failed` — once permanently rejected, it stays that way (the
 *   projection has no path back to "delivered" for the same message).
 * - A hard/soft bounce may follow `delivered` (the receiving system first
 *   accepted, then later rejected), but never regresses an
 *   already-`bounced`/`failed` row.
 * - `complaint` is an independent `feedback_status`, untouched by
 *   `delivery_status` transitions.
 *
 * Row-locked within a transaction so two workers processing events for the
 * same message concurrently can't race the projection.
 */
export async function applyEventToProjection(
    outboundMessageId: string,
    eventType: DeliveryEventType,
    occurredAt: Date,
): Promise<void> {
    await db.transaction(async (tx) => {
        const [row] = await tx
            .select()
            .from(outboundMessages)
            .where(eq(outboundMessages.id, outboundMessageId))
            .limit(1)
            .for("update");
        if (!row) return;

        const patch: Partial<typeof outboundMessages.$inferInsert> = {
            lastEventAt: occurredAt,
            updatedAt: new Date(),
        };

        switch (eventType) {
            case "accepted":
                if (row.deliveryStatus === "queued") {
                    patch.deliveryStatus = "accepted";
                    patch.acceptedAt = occurredAt;
                }
                break;
            case "delayed":
                if (
                    row.deliveryStatus === "queued" ||
                    row.deliveryStatus === "accepted"
                ) {
                    patch.deliveryStatus = "delayed";
                }
                break;
            case "delivered":
                if (!TERMINAL_DELIVERY_STATUSES.has(row.deliveryStatus)) {
                    patch.deliveryStatus = "delivered";
                    patch.deliveredAt = occurredAt;
                }
                break;
            case "hard_bounce":
            case "soft_bounce":
            case "rejected":
                if (!TERMINAL_DELIVERY_STATUSES.has(row.deliveryStatus)) {
                    patch.deliveryStatus = "bounced";
                    patch.bouncedAt = occurredAt;
                }
                break;
            case "failed":
                if (!TERMINAL_DELIVERY_STATUSES.has(row.deliveryStatus)) {
                    patch.deliveryStatus = "failed";
                }
                break;
            case "complaint":
                patch.feedbackStatus = "complained";
                patch.complainedAt = occurredAt;
                break;
            case "suppressed":
            case "unknown":
                // No projection change — informational only.
                break;
        }

        await tx
            .update(outboundMessages)
            .set(patch)
            .where(eq(outboundMessages.id, row.id));
    });
}
