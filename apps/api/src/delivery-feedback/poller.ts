import logger from "../services/log";
import { captureError } from "../observability/posthog";
import {
    getReceiptsDueForProcessing,
    recoverStaleProcessingReceipts,
} from "./webhook-receipt-queries";
import { processWebhookReceipt } from "./process-receipt";

const POLL_INTERVAL_MS = 30 * 1000;

/**
 * Recovers `pending` receipts BullMQ's enqueue missed (a committed receipt
 * is always the recovery source of truth, independent of Redis — PRD
 * acceptance criterion 2) and drives the retry-backoff schedule stored on
 * each receipt row. `processWebhookReceipt` itself claims the receipt
 * first, so running this alongside the BullMQ worker can never double
 * -process one.
 */
export async function startFeedbackReceiptPoller(): Promise<void> {
    // eslint-disable-next-line no-constant-condition
    while (true) {
        try {
            await pollFeedbackReceiptsOnce();
        } catch (err: any) {
            logger.error({ error: err.message }, "feedback poller loop failed");
            captureError({
                error: err,
                source: "feedback.poller.loop",
                severity: "critical",
            });
        }

        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }
}

/** One durable recovery pass. Kept separate from the perpetual loop so missed
 * queue delivery and poison-receipt isolation stay directly testable. */
export async function pollFeedbackReceiptsOnce(): Promise<void> {
    const recovered = await recoverStaleProcessingReceipts();
    if (recovered > 0) {
        logger.info(
            { count: recovered },
            "recovered stale processing webhook receipts",
        );
    }

    const due = await getReceiptsDueForProcessing();
    for (const receipt of due) {
        try {
            await processWebhookReceipt(receipt.id);
        } catch (err: any) {
            logger.error(
                { error: err.message, receipt_id: receipt.receiptId },
                "poller.processReceipt failed",
            );
            captureError({
                error: err,
                source: "feedback.poller.process_receipt",
                context: { receipt_id: receipt.receiptId },
            });
        }
    }
}
