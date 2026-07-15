import { Worker } from "bullmq";
import logger from "../services/log";
import { processOngoingSequence } from "../automation/process-ongoing-sequence";
import { captureError } from "../observability/posthog";
import { registerWorkerEvents, workerOptions } from "./worker-options";

const worker = new Worker(
    "sequence",
    async (job) => {
        const { ongoingSequenceId } = job.data as { ongoingSequenceId: string };
        try {
            await processOngoingSequence(ongoingSequenceId);
        } catch (err: any) {
            logger.error(
                {
                    error: err.message,
                    job_id: String(job.id),
                    ongoingSequenceId,
                },
                "sequence worker failed",
            );
            captureError({
                error: err,
                source: "worker.sequence",
                context: {
                    job_id: String(job.id),
                    queue_name: "sequence",
                    sequence_id: ongoingSequenceId,
                },
            });
            throw err;
        }
    },
    { ...workerOptions, concurrency: 10 },
);

registerWorkerEvents(worker, "sequence");

export default worker;
