import { Queue } from "bullmq";
import redis from "../services/redis";

const sequenceQueue = new Queue("sequence", {
    connection: redis,
    defaultJobOptions: {
        // Must be `true` (remove immediately), not a count: jobs are keyed by
        // ongoing-sequence row id for dedup, and a lingering completed job
        // would block enqueueing that row's next email / retry. Send history
        // lives in logs and `email_deliveries` instead.
        removeOnComplete: true,
        removeOnFail: 5000,
    },
});

export default sequenceQueue;
