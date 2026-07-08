import { Worker } from "bullmq";
import redis from "../services/redis";
import logger from "../services/log";
import { processOngoingSequence } from "../automation/process-ongoing-sequence";
import { captureError } from "../observability/posthog";

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
        }
    },
    { connection: redis, concurrency: 10 },
);

export default worker;
