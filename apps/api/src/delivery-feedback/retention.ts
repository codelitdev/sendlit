import { and, eq, inArray, isNotNull, lt } from "drizzle-orm";
import { db } from "../db/client";
import {
    emailDeliveryEvents,
    emailSuppressions,
    espWebhookReceipts,
    outboundMessages,
} from "../db/schema";

const RAW_RECEIPT_RETENTION_DAYS = 30;
const DELIVERY_EVENT_RETENTION_DAYS = 396; // ~13 months

/** Deletes bounded batches to avoid table-wide locks on large tables — see
 * `docs/bounces-and-complaints.md`'s "Retention deletion in bounded
 * batches without table-wide locks" load/resilience requirement. */
const BATCH_SIZE = 500;

/**
 * Deletes the raw encrypted payload/safe headers for receipts older than
 * 30 days — receipt metadata/aggregate status (`status`, timestamps,
 * `bodySha256`) is retained. Run repeatedly (each call handles one bounded
 * batch) until it returns 0.
 */
export async function purgeExpiredRawReceipts(): Promise<number> {
    const cutoff = new Date(
        Date.now() - RAW_RECEIPT_RETENTION_DAYS * 24 * 60 * 60 * 1000,
    );
    const stale = await db
        .select({ id: espWebhookReceipts.id })
        .from(espWebhookReceipts)
        .where(
            and(
                lt(espWebhookReceipts.receivedAt, cutoff),
                isNotNull(espWebhookReceipts.encryptedPayload),
            ),
        )
        .limit(BATCH_SIZE);
    if (stale.length === 0) return 0;

    await db
        .update(espWebhookReceipts)
        .set({ encryptedPayload: null, safeHeaders: {} })
        .where(
            inArray(
                espWebhookReceipts.id,
                stale.map((row) => row.id),
            ),
        );
    return stale.length;
}

/**
 * Deletes normalized delivery events older than 13 months. Run repeatedly
 * until it returns 0 — each call only touches `BATCH_SIZE` rows.
 */
export async function purgeOldDeliveryEvents(): Promise<number> {
    const cutoff = new Date(
        Date.now() - DELIVERY_EVENT_RETENTION_DAYS * 24 * 60 * 60 * 1000,
    );
    const stale = await db
        .select({ id: emailDeliveryEvents.id })
        .from(emailDeliveryEvents)
        .where(lt(emailDeliveryEvents.occurredAt, cutoff))
        .limit(BATCH_SIZE);
    if (stale.length === 0) return 0;

    await db.delete(emailDeliveryEvents).where(
        inArray(
            emailDeliveryEvents.id,
            stale.map((row) => row.id),
        ),
    );
    return stale.length;
}

/**
 * Recipient privacy-erasure: removes the presented/normalized address from
 * every outbound message, delivery event, and suppression row for one
 * team+email, in one transaction, while keeping the versioned do-not-send
 * HMAC on any suppression row so the address stays blocked. Must never
 * accidentally reactivate a still-required suppression, so
 * `emailSuppressions.active`/`reason`/`recipientHash` are left untouched —
 * only the presented/normalized address columns are cleared. Contact
 * deletion/reimport already preserves suppression by construction (the
 * suppression table has no FK to `contacts`), so nothing else needs to run
 * here for that case.
 */
export async function anonymizeRecipientForPrivacyDeletion({
    teamId,
    normalizedRecipient,
}: {
    teamId: string;
    normalizedRecipient: string;
}): Promise<void> {
    await db.transaction(async (tx) => {
        await tx
            .update(outboundMessages)
            .set({ recipientEmail: "", normalizedRecipient: "" })
            .where(
                and(
                    eq(outboundMessages.teamId, teamId),
                    eq(
                        outboundMessages.normalizedRecipient,
                        normalizedRecipient,
                    ),
                ),
            );
        await tx
            .update(emailDeliveryEvents)
            .set({ recipientEmail: null, normalizedRecipient: null })
            .where(
                and(
                    eq(emailDeliveryEvents.teamId, teamId),
                    eq(
                        emailDeliveryEvents.normalizedRecipient,
                        normalizedRecipient,
                    ),
                ),
            );
        await tx
            .update(emailSuppressions)
            .set({ recipientEmail: null, normalizedRecipient: null })
            .where(
                and(
                    eq(emailSuppressions.teamId, teamId),
                    eq(
                        emailSuppressions.normalizedRecipient,
                        normalizedRecipient,
                    ),
                ),
            );
    });
}
