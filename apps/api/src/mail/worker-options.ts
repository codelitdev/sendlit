import type { Job, Worker, WorkerOptions } from "bullmq";
import { captureError } from "../observability/posthog";
import redis from "../services/redis";

export const workerOptions: WorkerOptions = {
    connection: redis,
    lockDuration: 5 * 60 * 1000,
    stalledInterval: 30 * 1000,
    maxStalledCount: 2,
};

export function registerWorkerEvents(
    worker: Pick<Worker, "on">,
    queueName: string,
) {
    worker.on("failed", (job: Job | undefined, err: Error) => {
        captureError({
            error: err,
            source: `worker.${queueName}.failed`,
            teamId: getJobTeamId(job),
            context: {
                queue_name: queueName,
                job_id: job?.id ? String(job.id) : undefined,
                job_name: job?.name,
                failed_reason: job?.failedReason,
                attempts_made: job?.attemptsMade,
            },
        });
    });

    worker.on("stalled", (jobId: string) => {
        captureError({
            error: new Error(`BullMQ job stalled in ${queueName}: ${jobId}`),
            source: `worker.${queueName}.stalled`,
            context: {
                queue_name: queueName,
                job_id: jobId,
            },
        });
    });

    worker.on("error", (err: Error) => {
        captureError({
            error: err,
            source: `worker.${queueName}.error`,
            context: {
                queue_name: queueName,
            },
        });
    });
}

function getJobTeamId(job: Job | undefined) {
    const data = job?.data as Record<string, unknown> | undefined;
    return data?.teamId ?? data?.team_id;
}
