import { type Job, UnrecoverableError, Worker } from "bullmq";
import {
  commitSendReservation,
  releaseSendReservation,
  reserveSend,
} from "../billing/entitlements";
import { evaluateTeamReputation } from "../billing/reputation";
import { db } from "../db/client";
import { resolvePinnedDeliverySource } from "../delivery/queries";
import { commitQuotaForOutbound, releaseQuotaForOutbound } from "../delivery/quota";
import {
  getOutboundMessageByTransactionalEmailId,
  markOutboundAccepted,
  markOutboundBounced,
} from "../delivery-feedback/outbound-queries";
import {
  extractProviderMessageId,
  withCorrelationHeaders,
} from "../delivery-feedback/outbound-send";
import {
  addOrStrengthenSuppression,
  isRecipientSuppressed,
} from "../delivery-feedback/suppression-queries";
import { captureError } from "../observability";
import logger from "../services/log";
import { getTeam } from "../team/queries";
import {
  claimTransactionalEmailForSending,
  markTransactionalEmailBounced,
  markTransactionalEmailFailed,
  markTransactionalEmailSent,
  markTransactionalEmailSuppressed,
  releaseTransactionalEmailClaim,
} from "../transactional/queries";
import { getTrackedClickUrl, getTrackingPixelUrl } from "../utils/mail";
import { generatePixelToken } from "../utils/pixel-jwt";
import { appendTrackingPixelToHtml, transformLinksForClickTracking } from "./render";
import { sendMail } from "./send";
import { registerWorkerEvents, workerOptions } from "./worker-options";

async function processCampaignJob(job: Job) {
  const { to, from, subject, body, headers, teamId } = job.data;
  try {
    await sendMail({
      purpose: "campaign",
      from,
      to,
      subject,
      html: body,
      headers,
      teamId,
    });
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
  const row = await claimTransactionalEmailForSending(transactionalEmailId);
  // Deleted since enqueue, or a stale duplicate delivery arriving after an
  // earlier attempt already reached a terminal state — nothing to (re)send.
  if (!row) return;
  let outbound: Awaited<ReturnType<typeof getOutboundMessageByTransactionalEmailId>> =
    null;

  try {
    const team = await getTeam(row.teamId);
    if (!team) {
      await markTransactionalEmailFailed(row.id, "Team not found");
      return;
    }
    if (!row.outboxId) {
      await markTransactionalEmailFailed(row.id, "Team ESP is not configured.");
      return;
    }
    const pin = await resolvePinnedDeliverySource({
      teamId: row.teamId,
      type: row.deliverySourceType as "organization" | "team",
      espConfigId: row.outboxId,
      espGrantId: row.espGrantId,
    });

    outbound = await getOutboundMessageByTransactionalEmailId(row.id);
    if (outbound) {
      await db.transaction(async (tx) => {
        await reserveSend(tx, {
          organizationId: team.organizationId,
          outboundMessageId: outbound!.id,
          purpose: "transactional",
        });
      });
    }

    // Recheck immediately before transport — closes the race between
    // enqueue and a bounce/complaint that suppressed this recipient in the
    // meantime. Exits idempotently as `suppressed`, never `failed`. See
    // docs/bounces-and-complaints.md#8-suppression-model.
    if (await isRecipientSuppressed(row.teamId, row.toEmail)) {
      await markTransactionalEmailSuppressed(row.id);
      if (outbound) {
        await releaseQuotaForOutbound(outbound.id, "suppressed");
        await releaseSendReservation(outbound.id);
      }
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
          return getTrackedClickUrl(token);
        },
        { txe_id: row.txeId },
      );
    }
    if (row.trackOpens) {
      const pixelToken = generatePixelToken({
        type: "txe",
        txeId: row.txeId,
      });
      const pixelUrl = getTrackingPixelUrl(pixelToken);
      html = appendTrackingPixelToHtml(html, pixelUrl);
    }

    const result = await sendMail({
      purpose: "transactional",
      from: row.fromEmail || "",
      to: row.toEmail,
      subject: row.subject,
      html,
      text: row.text ?? undefined,
      headers: withCorrelationHeaders(
        outbound,
        (row.headers as Record<string, string> | null) ?? undefined,
      ),
      teamId: row.teamId,
      espConfigId: row.outboxId,
      secretVersion: pin.secretVersion,
      messageId: outbound?.rfcMessageId ?? undefined,
    });
    await markTransactionalEmailSent(row.id);
    if (outbound) {
      await markOutboundAccepted(outbound.id, {
        providerMessageId: extractProviderMessageId(
          outbound.provider,
          result.providerResponse,
        ),
      });
      await commitQuotaForOutbound(outbound.id);
      await commitSendReservation(outbound.id);
    }
  } catch (err: any) {
    const responseCode = err?.responseCode;
    const isPermanentRejection =
      typeof responseCode === "number" && responseCode >= 500 && responseCode < 600;

    const logContext = {
      error: err.message,
      job_id: String(job.id),
      txe_id: row.txeId,
      error_code: err?.code,
      response_code: responseCode,
    };

    if (isPermanentRejection) {
      await markTransactionalEmailBounced(row.id, err.message);
      if (outbound) {
        await markOutboundBounced(outbound.id);
        await evaluateTeamReputation(row.teamId).catch(() => undefined);
        await releaseQuotaForOutbound(outbound.id, "provider_rejected");
        await releaseSendReservation(outbound.id);
      }
      // Mirrors this synchronous SMTP signal into the suppression
      // system directly — there is no webhook receipt/event backing
      // it, so `sourceEventId` stays null (both fields are nullable
      // for exactly this case; see docs/bounces-and-complaints.md's
      // Phase 0 requirement to mirror synchronous 5xx handling).
      await addOrStrengthenSuppression({
        teamId: row.teamId,
        recipientEmail: row.toEmail,
        reason: "hard_bounce",
        actorType: "system",
        explanation: `Synchronous SMTP ${responseCode} rejection`,
      });
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
      if (outbound) {
        await releaseQuotaForOutbound(outbound.id, "terminal_failure");
        await releaseSendReservation(outbound.id);
      }
    } else {
      await releaseTransactionalEmailClaim(row.id);
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
