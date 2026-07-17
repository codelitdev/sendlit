import crypto from "crypto";
import { and, eq, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { db } from "../db/client";
import { espWebhookReceipts } from "../db/schema";
import { decryptSecret, encryptSecret } from "../utils/secret-crypto";

export type WebhookReceipt = typeof espWebhookReceipts.$inferSelect;

/** Headers stored verbatim on the receipt for operator debugging — anything
 * matching this pattern is dropped instead, since it's the kind of header
 * that could carry a credential/signature (PRD: `safeHeaders` "excludes
 * authorization, cookies, signatures, and credentials"). */
const SENSITIVE_HEADER_PATTERN = /authorization|cookie|signature|secret|token/i;

export function sanitizeHeaders(
    headers: Record<string, string | string[] | undefined>,
): Record<string, string> {
    const safe: Record<string, string> = {};
    for (const [key, value] of Object.entries(headers)) {
        if (SENSITIVE_HEADER_PATTERN.test(key)) continue;
        if (value === undefined) continue;
        safe[key] = Array.isArray(value) ? value.join(", ") : value;
    }
    return safe;
}

export function hashBody(rawBody: Buffer): string {
    return crypto.createHash("sha256").update(rawBody).digest("hex");
}

/** Inserts the durable, authenticated receipt — must be committed before the
 * HTTP response is sent (see
 * `docs/bounces-and-complaints.md#4-durable-receipt-inbox`). The raw payload
 * is encrypted since it can contain recipient addresses, diagnostics, or
 * complaint material. */
export async function createWebhookReceipt({
    connectionId,
    teamId,
    provider,
    providerRequestId,
    rawBody,
    safeHeaders,
}: {
    connectionId: string;
    teamId: string | null;
    provider: string;
    providerRequestId: string | null;
    rawBody: Buffer;
    safeHeaders: Record<string, string>;
}): Promise<WebhookReceipt> {
    const [row] = await db
        .insert(espWebhookReceipts)
        .values({
            connectionId,
            teamId,
            provider,
            providerRequestId,
            bodySha256: hashBody(rawBody),
            encryptedPayload: encryptSecret(rawBody.toString("base64")),
            safeHeaders,
            status: "pending",
        })
        .returning();
    return row;
}

/** Dedupe by the provider's own request id when it's stable (e.g.
 * `svix-id`) — a provider retry of the exact same HTTP delivery must not
 * create a second receipt. */
export async function findDuplicateReceipt(
    connectionId: string,
    providerRequestId: string,
): Promise<WebhookReceipt | null> {
    const [row] = await db
        .select()
        .from(espWebhookReceipts)
        .where(
            and(
                eq(espWebhookReceipts.connectionId, connectionId),
                eq(espWebhookReceipts.providerRequestId, providerRequestId),
            ),
        )
        .limit(1);
    return row ?? null;
}

export async function getWebhookReceiptById(
    id: string,
): Promise<WebhookReceipt | null> {
    const [row] = await db
        .select()
        .from(espWebhookReceipts)
        .where(eq(espWebhookReceipts.id, id))
        .limit(1);
    return row ?? null;
}

export function decryptReceiptPayload(receipt: WebhookReceipt): Buffer | null {
    if (!receipt.encryptedPayload) return null;
    return Buffer.from(decryptSecret(receipt.encryptedPayload), "base64");
}

/** Claims a `pending` receipt for processing — the WHERE guard against the
 * current status is the processing lease: two workers racing this update
 * can't both succeed, so a receipt is never processed twice concurrently. */
export async function claimReceiptForProcessing(id: string): Promise<boolean> {
    const [row] = await db
        .update(espWebhookReceipts)
        .set({ status: "processing" })
        .where(
            and(
                eq(espWebhookReceipts.id, id),
                inArray(espWebhookReceipts.status, ["pending"]),
            ),
        )
        .returning();
    return Boolean(row);
}

export async function markReceiptProcessed(id: string): Promise<void> {
    await db
        .update(espWebhookReceipts)
        .set({ status: "processed", processedAt: new Date() })
        .where(eq(espWebhookReceipts.id, id));
}

/** A partial success (e.g. some events in a multi-event batch normalized,
 * others didn't) — still terminal, since retrying would re-emit the events
 * that already succeeded and idempotency absorbs that, but the PRD models
 * `partial` as its own status for operator visibility. */
export async function markReceiptPartial(id: string): Promise<void> {
    await db
        .update(espWebhookReceipts)
        .set({ status: "partial", processedAt: new Date() })
        .where(eq(espWebhookReceipts.id, id));
}

const RETRY_BACKOFF_MINUTES = [1, 5, 15, 60, 240];

/** Schedules a retry with exponential backoff, or dead-letters once retries
 * have run for 24h (PRD: "Retry normalization with exponential backoff for
 * 24 hours ... unsupported payloads go to dead_letter"). */
export async function markReceiptFailedForRetry(
    id: string,
    errorCode: string,
): Promise<void> {
    const [receipt] = await db
        .select()
        .from(espWebhookReceipts)
        .where(eq(espWebhookReceipts.id, id))
        .limit(1);
    if (!receipt) return;

    const attempts = receipt.processingAttempts + 1;
    const ageMs = Date.now() - receipt.receivedAt.getTime();
    if (ageMs > 24 * 60 * 60 * 1000) {
        await markReceiptDeadLetter(id, errorCode);
        return;
    }

    const backoffMinutes =
        RETRY_BACKOFF_MINUTES[
            Math.min(attempts - 1, RETRY_BACKOFF_MINUTES.length - 1)
        ];
    await db
        .update(espWebhookReceipts)
        .set({
            status: "pending",
            processingAttempts: attempts,
            nextAttemptAt: new Date(Date.now() + backoffMinutes * 60 * 1000),
            lastErrorCode: errorCode,
        })
        .where(eq(espWebhookReceipts.id, id));
}

export async function markReceiptDeadLetter(
    id: string,
    errorCode: string,
): Promise<void> {
    await db
        .update(espWebhookReceipts)
        .set({
            status: "dead_letter",
            lastErrorCode: errorCode,
            processingAttempts: sql`${espWebhookReceipts.processingAttempts} + 1`,
        })
        .where(eq(espWebhookReceipts.id, id));
}

/** Recovery poller query — finds receipts BullMQ never picked up (enqueue
 * failed after the HTTP request already committed the receipt) or whose
 * retry backoff has elapsed. A committed receipt is always the recovery
 * source of truth, independent of Redis (PRD acceptance criterion 2). */
export async function getReceiptsDueForProcessing(
    limit = 50,
): Promise<WebhookReceipt[]> {
    return db
        .select()
        .from(espWebhookReceipts)
        .where(
            and(
                eq(espWebhookReceipts.status, "pending"),
                or(
                    isNull(espWebhookReceipts.nextAttemptAt),
                    lte(espWebhookReceipts.nextAttemptAt, new Date()),
                ),
            ),
        )
        .limit(limit);
}

/** Recovers receipts stuck in `processing` past a reasonable lease window
 * (a worker crashed after claiming but before finishing) — see PRD:
 * "stale leases are recoverable". */
export async function recoverStaleProcessingReceipts(
    staleAfterMinutes = 10,
): Promise<number> {
    const rows = await db
        .update(espWebhookReceipts)
        .set({ status: "pending" })
        .where(
            and(
                eq(espWebhookReceipts.status, "processing"),
                lte(
                    espWebhookReceipts.receivedAt,
                    new Date(Date.now() - staleAfterMinutes * 60 * 1000),
                ),
            ),
        )
        .returning({ id: espWebhookReceipts.id });
    return rows.length;
}
