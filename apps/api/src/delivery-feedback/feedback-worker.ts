import { Worker } from "bullmq";
import { registerWorkerEvents, workerOptions } from "../mail/worker-options";
import { processWebhookReceipt } from "./process-receipt";

const worker = new Worker(
    "esp-feedback",
    async (job) => {
        const { receiptId } = job.data as { receiptId: string };
        await processWebhookReceipt(receiptId);
    },
    { ...workerOptions, concurrency: 5 },
);

registerWorkerEvents(worker, "esp-feedback");

export default worker;
