import logger from "../services/log";
import { captureError } from "../observability/posthog";
import { purgeExpiredRawReceipts, purgeOldDeliveryEvents } from "./retention";

const RUN_INTERVAL_MS = 60 * 60 * 1000; // hourly — retention is not latency-sensitive

/** Runs the raw-receipt (30-day) and delivery-event (13-month) retention
 * purges on an hourly loop, draining each in bounded batches until a call
 * returns 0 so a large backlog never holds one long-running transaction. */
export async function startRetentionLoop(): Promise<void> {
    // eslint-disable-next-line no-constant-condition
    while (true) {
        try {
            await drainBatches(purgeExpiredRawReceipts, "raw webhook receipts");
            await drainBatches(purgeOldDeliveryEvents, "delivery events");
        } catch (err: any) {
            logger.error({ error: err.message }, "retention loop failed");
            captureError({
                error: err,
                source: "feedback.retention.loop",
                severity: "critical",
            });
        }

        await new Promise((resolve) => setTimeout(resolve, RUN_INTERVAL_MS));
    }
}

async function drainBatches(
    purge: () => Promise<number>,
    label: string,
): Promise<void> {
    let total = 0;
    // eslint-disable-next-line no-constant-condition
    while (true) {
        const count = await purge();
        total += count;
        if (count === 0) break;
    }
    if (total > 0) {
        logger.info({ count: total }, `retention: purged ${label}`);
    }
}
