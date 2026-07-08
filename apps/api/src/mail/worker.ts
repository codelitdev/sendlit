import { Worker } from "bullmq";
import redis from "../services/redis";
import logger from "../services/log";
import { sendMail } from "./send";
import { captureError } from "../observability/posthog";

const worker = new Worker(
    "mail",
    async (job) => {
        const { to, from, subject, body, headers, teamId } = job.data;
        try {
            await sendMail({ from, to, subject, html: body, headers, teamId });
        } catch (err: any) {
            logger.error(
                {
                    error: err.message,
                    job_id: String(job.id),
                    error_code: err?.code,
                    response_code: err?.responseCode,
                },
                "mail worker failed",
            );
            captureError({
                error: err,
                source: "worker.mail",
                teamId,
                context: {
                    job_id: String(job.id),
                    queue_name: "mail",
                    error_code: err?.code,
                    response_code: err?.responseCode,
                },
            });
        }
    },
    { connection: redis },
);

export default worker;
