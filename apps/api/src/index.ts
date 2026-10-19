import { createApp } from "./app";
import { startAutomation } from "./automation/start";
import {
  prepareBilling,
  startBillingMaintenance,
  validateBillingConfig,
} from "./billing/lifecycle";
import { createInitialOrganizationOwnerIfMissing } from "./bootstrap";
import { checkDatabaseConnection, pool } from "./db/client";
import {
  startDeliveryLifecycleJobs,
  stopDeliveryLifecycleJobs,
} from "./delivery/lifecycle-jobs";
import feedbackQueue from "./delivery-feedback/feedback-queue";
import feedbackWorker from "./delivery-feedback/feedback-worker";
import { startFeedbackReceiptPoller } from "./delivery-feedback/poller";
import { startRetentionLoop } from "./delivery-feedback/retention-loop";
import { assertSuppressionHashKeyConfigured } from "./delivery-feedback/suppression-hash";
import { checkReadiness, createApiShutdown, type ProcessState } from "./lifecycle";
import {
  startMailDispatchOutbox,
  stopMailDispatchOutbox,
} from "./mail/dispatch-outbox";
import mailQueue from "./mail/queue";
import { closeSendRateLimiter } from "./mail/rate-limit";
import sequenceQueue from "./mail/sequence-queue";
import sequenceWorker from "./mail/sequence-worker";
import mailWorker from "./mail/worker";
import { captureError, getTeamId, shutdownObservability } from "./observability";
import logger from "./services/log";
import { assertEspEncryptionKeyConfigured } from "./utils/secret-crypto";

const state: ProcessState = { started: false, shuttingDown: false };

const app = createApp({
  readiness: () =>
    checkReadiness(state, {
      database: () => pool.query("select 1"),
      redis: () => mailQueue.getJobCounts("wait"),
    }),
});

startMailDispatchOutbox();
startDeliveryLifecycleJobs();

process.on("unhandledRejection", (reason) => {
  logger.error({ error: (reason as Error)?.message }, "Unhandled promise rejection");
  captureError({ error: reason, source: "process.unhandled_rejection" });
});

const port = process.env.PORT || 80;

checkConfig()
  .then(checkDatabaseConnection)
  .then(prepareBilling)
  .then(createInitialOrganizationOwnerIfMissing)
  .then(() => {
    const server = app.listen(port, () => {
      logger.info(`SendLit API running at ${port}`);
    });
    startAutomation();
    const billingMaintenance = startBillingMaintenance();
    startFeedbackReceiptPoller();
    startRetentionLoop();
    state.started = true;

    const shutdown = createApiShutdown({
      server,
      steps: [
        { name: "mail_dispatch_outbox", run: stopMailDispatchOutbox },
        { name: "delivery_lifecycle_jobs", run: stopDeliveryLifecycleJobs },
        { name: "billing_maintenance", run: () => billingMaintenance.stop() },
        // Closing a BullMQ worker waits for the job it is running.
        { name: "mail_worker", run: () => mailWorker.close() },
        { name: "sequence_worker", run: () => sequenceWorker.close() },
        { name: "feedback_worker", run: () => feedbackWorker.close() },
        { name: "mail_queue", run: () => mailQueue.close() },
        { name: "sequence_queue", run: () => sequenceQueue.close() },
        { name: "feedback_queue", run: () => feedbackQueue.close() },
        { name: "send_rate_limiter", run: closeSendRateLimiter },
        { name: "database", run: () => pool.end() },
        { name: "observability", run: () => shutdownObservability(2_000) },
      ],
    });
    for (const signal of ["SIGTERM", "SIGINT"] as const) {
      process.once(signal, () => {
        state.shuttingDown = true;
        logger.info({ signal }, "Shutting down SendLit API");
        shutdown
          .shutdown()
          .then(() => process.exit(0))
          .catch((error) => {
            logger.error({ error: error.message }, "Shutdown did not finish in time");
            process.exit(1);
          });
      });
    }
  })
  .catch((err) => {
    logger.error({ error: err.message }, "Failed to start SendLit API");
    captureError({
      error: err,
      source: "service.startup",
      teamId: getTeamId(),
    });
    process.exit(1);
  });

async function checkConfig() {
  if (!process.env.DB_CONNECTION_STRING) {
    throw new Error("DB_CONNECTION_STRING is not set");
  }
  const authSecret = process.env.BETTER_AUTH_SECRET;
  if (!authSecret || Buffer.byteLength(authSecret, "utf8") < 32) {
    throw new Error(
      "BETTER_AUTH_SECRET is required and must be at least 32 bytes (256 bits). " +
        "Generate one with: openssl rand -base64 48",
    );
  }
  if (!process.env.PIXEL_SIGNING_SECRET) {
    throw new Error("PIXEL_SIGNING_SECRET is not set");
  }
  assertEspEncryptionKeyConfigured();
  assertSuppressionHashKeyConfigured();
  // Billing mode is explicit and fail-closed: OSS must be opted into, and
  // cloud needs a complete, validated catalog and encryption key.
  validateBillingConfig();
}
