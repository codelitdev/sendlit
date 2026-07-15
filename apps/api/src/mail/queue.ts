import { Queue } from "bullmq";
import redis from "../services/redis";

const mailQueue = new Queue("mail", { connection: redis });

export default mailQueue;

/**
 * Enqueues a single transactional send — distinguished from campaign jobs by
 * job name (`"transactional"` vs `"mail"`) so `mail/worker.ts` can branch on
 * `job.name` and apply the retry/bounce-classification behavior transactional
 * mail needs but campaign mail doesn't (see `docs/transactional-emails.md`).
 * The payload is just the row id — the worker loads everything else
 * (`to`/`from`/`html`/tracking flags) from `transactional_emails` itself, so
 * there's one source of truth instead of a stale copy riding along in Redis.
 */
export async function addTransactionalMailJob({
    transactionalEmailId,
}: {
    transactionalEmailId: string;
}) {
    await mailQueue.add(
        "transactional",
        { transactionalEmailId },
        {
            jobId: transactionalEmailId,
            priority: 1,
            attempts: 3,
            backoff: { type: "exponential", delay: 30_000 },
        },
    );
}

export async function addMailJob({
    to,
    subject,
    body,
    from,
    teamId,
    headers,
}: {
    to: string[];
    subject: string;
    body: string;
    from: string;
    teamId: string;
    headers?: Record<string, string>;
}) {
    for (const recipient of to) {
        await mailQueue.add(
            "mail",
            {
                to: recipient,
                subject,
                body,
                from,
                teamId,
                headers,
            },
            {
                attempts: 3,
                backoff: { type: "exponential", delay: 30_000 },
            },
        );
    }
}
