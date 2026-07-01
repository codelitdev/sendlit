import { Worker } from "bullmq";
import redis from "../services/redis";
import logger from "../services/log";
import { processOngoingSequence } from "../automation/process-ongoing-sequence";

const worker = new Worker(
    "sequence",
    async (job) => {
        const { ongoingSequenceId } = job.data as { ongoingSequenceId: string };
        try {
            await processOngoingSequence(ongoingSequenceId);
        } catch (err: any) {
            logger.error(
                { error: err.message, job_id: String(job.id), ongoingSequenceId },
                "sequence worker failed",
            );
        }
    },
    { connection: redis },
);

export default worker;
