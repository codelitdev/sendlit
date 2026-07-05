import { Worker } from "bullmq";
import redis from "../services/redis";
import logger from "../services/log";
import { sendMail } from "./send";

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
        }
    },
    { connection: redis },
);

export default worker;
