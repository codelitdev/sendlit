import { Queue } from "bullmq";
import redis from "../services/redis";

/**
 * Background dispatcher for durable webhook receipts — a receipt is always
 * inserted and acknowledged before this queue is touched (see
 * `webhook-route.ts`), so a failed enqueue here never loses data: the
 * recovery poller (`poller.ts`) finds any `pending` receipt BullMQ never
 * picked up. `attempts: 1` is intentional — retry/backoff is modeled on the
 * receipt row itself (`processingAttempts`/`nextAttemptAt`), not BullMQ's,
 * so the poller and the worker share one retry policy.
 */
const feedbackQueue = new Queue("esp-feedback", {
    connection: redis,
    defaultJobOptions: {
        removeOnComplete: true,
        removeOnFail: true,
        attempts: 1,
    },
});

export default feedbackQueue;

export async function enqueueReceiptForProcessing(
    receiptId: string,
): Promise<void> {
    await feedbackQueue.add(
        "process-receipt",
        { receiptId },
        { jobId: receiptId },
    );
}
