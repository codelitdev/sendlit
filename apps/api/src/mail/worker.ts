import { Worker, UnrecoverableError, type Job } from "bullmq";
import logger from "../services/log";
import { sendMail } from "./send";
import {
    appendTrackingPixelToHtml,
    transformLinksForClickTracking,
} from "./render";
import { generatePixelToken } from "../utils/pixel-jwt";
import { getSiteUrl } from "../utils/mail";
import { getTeam } from "../team/queries";
import { incrementMailCount } from "../account/queries";
import {
    getTransactionalEmailById,
    markTransactionalEmailBounced,
    markTransactionalEmailFailed,
    markTransactionalEmailSent,
} from "../transactional/queries";
import { captureError } from "../observability/posthog";
import { registerWorkerEvents, workerOptions } from "./worker-options";

async function processCampaignJob(job: Job) {
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
        throw err;
    }
}

/**
 * Transactional jobs let BullMQ's own `attempts`/backoff drive retries: a
 * transient error rethrows so BullMQ retries it, a permanent SMTP rejection
 * (5xx) throws `UnrecoverableError` so it doesn't, and only the final attempt
 * marks the row `failed`. See `docs/transactional-emails.md#send-pipeline`.
 */
async function processTransactionalJob(job: Job) {
    const { transactionalEmailId } = job.data as {
        transactionalEmailId: string;
    };
    const row = await getTransactionalEmailById(transactionalEmailId);
    // Deleted since enqueue, or a stale duplicate delivery arriving after an
    // earlier attempt already reached a terminal state — nothing to (re)send.
    if (!row || row.status !== "queued") return;

    const team = await getTeam(row.teamId);
    if (!team) {
        await markTransactionalEmailFailed(row.id, "Team not found");
        return;
    }

    // Tracking rewrites are applied here, at send time, from the row's
    // opt-in flags — the stored `html` snapshot stays pre-rewrite (see
    // `transactional/queries.ts#createTransactionalEmail`).
    let html = row.html ?? "";
    if (row.trackClicks) {
        html = transformLinksForClickTracking(
            html,
            (originalUrl, index) => {
                const token = generatePixelToken({
                    type: "txe",
                    txeId: row.txeId,
                    index,
                    link: encodeURIComponent(originalUrl),
                });
                return `${getSiteUrl()}/api/track/click?d=${token}`;
            },
            { txe_id: row.txeId },
        );
    }
    if (row.trackOpens) {
        const pixelToken = generatePixelToken({
            type: "txe",
            txeId: row.txeId,
        });
        const pixelUrl = `${getSiteUrl()}/api/track/open?d=${pixelToken}`;
        html = appendTrackingPixelToHtml(html, pixelUrl);
    }

    try {
        await sendMail({
            from: row.fromEmail || "",
            to: row.toEmail,
            subject: row.subject,
            html,
            headers:
                (row.headers as Record<string, string> | null) ?? undefined,
            teamId: row.teamId,
        });
        await markTransactionalEmailSent(row.id);
        await incrementMailCount(team.ownerAccountId);
    } catch (err: any) {
        const responseCode = err?.responseCode;
        const isPermanentRejection =
            typeof responseCode === "number" &&
            responseCode >= 500 &&
            responseCode < 600;

        const logContext = {
            error: err.message,
            job_id: String(job.id),
            txe_id: row.txeId,
            error_code: err?.code,
            response_code: responseCode,
        };

        if (isPermanentRejection) {
            await markTransactionalEmailBounced(row.id, err.message);
            logger.error(logContext, "transactional mail bounced");
            captureError({
                error: err,
                source: "worker.transactional",
                teamId: row.teamId,
                context: { ...logContext, queue_name: "mail" },
            });
            // No point retrying a permanent rejection.
            throw new UnrecoverableError(err.message);
        }

        const isFinalAttempt = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
        if (isFinalAttempt) {
            await markTransactionalEmailFailed(row.id, err.message);
        }
        logger.error(logContext, "transactional mail worker failed");
        captureError({
            error: err,
            source: "worker.transactional",
            teamId: row.teamId,
            context: { ...logContext, queue_name: "mail" },
        });
        throw err;
    }
}

const worker = new Worker(
    "mail",
    async (job) => {
        if (job.name === "transactional") return processTransactionalJob(job);
        return processCampaignJob(job);
    },
    workerOptions,
);

registerWorkerEvents(worker, "mail");

export default worker;
