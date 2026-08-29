import { randomInt } from "node:crypto";

/** Total claim/process attempts before a durable webhook is quarantined. */
export const BILLING_WEBHOOK_MAX_ATTEMPTS = 8;

const INITIAL_RETRY_DELAYS_MS = [
    60 * 1000,
    5 * 60 * 1000,
    30 * 60 * 1000,
    2 * 60 * 60 * 1000,
] as const;

const TAIL_RETRY_DELAY_MS = 8 * 60 * 60 * 1000;
const TAIL_RETRY_JITTER_MS = Math.floor(TAIL_RETRY_DELAY_MS * 0.1);

export type BillingWebhookRetry =
    { status: "quarantined" } | { status: "failed"; delayMs: number };

/** Retry schedule from the billing PRD: 1m, 5m, 30m, 2h, then 8h with jitter,
 * up to eight attempts. `processingAttempts` is the count after the claim
 * increment for the attempt that just failed. */
export function billingWebhookRetry(
    processingAttempts: number,
    jitterMs?: number,
): BillingWebhookRetry {
    if (processingAttempts >= BILLING_WEBHOOK_MAX_ATTEMPTS) {
        return { status: "quarantined" };
    }
    const index = Math.max(0, processingAttempts - 1);
    if (index < INITIAL_RETRY_DELAYS_MS.length) {
        return { status: "failed", delayMs: INITIAL_RETRY_DELAYS_MS[index] };
    }
    const jitter =
        jitterMs ?? randomInt(-TAIL_RETRY_JITTER_MS, TAIL_RETRY_JITTER_MS + 1);
    return { status: "failed", delayMs: TAIL_RETRY_DELAY_MS + jitter };
}
