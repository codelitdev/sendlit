import { and, desc, eq, gte, inArray, isNotNull } from "drizzle-orm";
import { db } from "../db/client";
import { emailDeliveryEvents } from "../db/schema";
import { finalSoftBounceWindowDays } from "../config/constants";

/**
 * Counts the recipient's current consecutive final-soft-bounce streak —
 * "consecutive" meaning distinct outbound messages, so duplicate/retried
 * events for one message never inflate it and a `delivered` event always
 * resets it (see `docs/bounces-and-complaints.md#8-suppression-model`).
 * Walks the most recent `delivered`/`soft_bounce` event per outbound
 * message within the rolling window, newest first, counting leading
 * `soft_bounce` entries until a `delivered` (or the window edge) is hit.
 */
export async function computeFinalSoftBounceStreak(
    teamId: string,
    normalizedRecipient: string,
): Promise<number> {
    const windowStart = new Date(
        Date.now() - finalSoftBounceWindowDays * 24 * 60 * 60 * 1000,
    );

    const perMessage = await db
        .selectDistinctOn([emailDeliveryEvents.outboundMessageId], {
            outboundMessageId: emailDeliveryEvents.outboundMessageId,
            eventType: emailDeliveryEvents.eventType,
            occurredAt: emailDeliveryEvents.occurredAt,
        })
        .from(emailDeliveryEvents)
        .where(
            and(
                eq(emailDeliveryEvents.teamId, teamId),
                eq(
                    emailDeliveryEvents.normalizedRecipient,
                    normalizedRecipient,
                ),
                inArray(emailDeliveryEvents.eventType, [
                    "delivered",
                    "soft_bounce",
                ]),
                gte(emailDeliveryEvents.occurredAt, windowStart),
                isNotNull(emailDeliveryEvents.outboundMessageId),
            ),
        )
        .orderBy(
            emailDeliveryEvents.outboundMessageId,
            desc(emailDeliveryEvents.occurredAt),
        );

    const chronological = [...perMessage].sort(
        (a, b) => b.occurredAt.getTime() - a.occurredAt.getTime(),
    );

    let streak = 0;
    for (const event of chronological) {
        if (event.eventType === "soft_bounce") {
            streak += 1;
        } else {
            break;
        }
    }
    return streak;
}
