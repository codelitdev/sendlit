import type { BillingEngine } from "@codelitdev/billing/workflows";
import { billingWebhookPath, handleBillingWebhook } from "@codelitdev/platform/billing";
import express, { Router } from "express";
import rateLimit from "express-rate-limit";
import { captureError } from "../../observability";
import logger from "../../services/log";
import { pageBillingAlert, recordWebhookSignatureFailure } from "../alerts";
import { readBillingConfig } from "../catalog";
import { billingWorkerId, getBillingEngine } from "../engine";

const router = Router();

const limiter = rateLimit({
  windowMs: 60_000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.ip || "unknown",
});

/** Providers whose webhooks this deployment accepts, or null when billing is
 * not configured (OSS mode or invalid config). */
function webhookBilling(provider: string): {
  billing: BillingEngine | null;
  known: boolean;
} {
  let config: ReturnType<typeof readBillingConfig>;
  try {
    config = readBillingConfig();
  } catch {
    return { billing: null, known: true };
  }
  if (config.deploymentMode !== "cloud") return { billing: null, known: true };
  if (!config.enabledProviders.includes(provider)) {
    return { billing: null, known: false };
  }
  return { billing: getBillingEngine(), known: true };
}

/**
 * Provider webhook ingress, `POST /webhooks/billing/:provider` (Dodo's is
 * `/webhooks/billing/dodo`, unchanged). Must be mounted before
 * `express.json()` so the raw body reaches signature verification.
 */
router.post(
  billingWebhookPath(":provider"),
  limiter,
  express.raw({ type: "application/json", limit: "256kb" }),
  async (req, res) => {
    const provider = String(req.params.provider);
    const { billing, known } = webhookBilling(provider);
    if (!known) return res.status(404).json({ error: "not_found" });
    let failure: unknown;
    const response = await handleBillingWebhook({
      billing,
      provider,
      // Only a real buffer is a body. `undefined` makes Platform answer 400;
      // an empty string would be passed on to signature verification.
      rawBody: Buffer.isBuffer(req.body) && req.body.length > 0 ? req.body : undefined,
      headers: req.headers,
      workerId: billingWorkerId("billing-webhook"),
      onError: (error) => {
        failure = error;
        if (res.headersSent) {
          // The background inbox drain; the worker retries it.
          logger.warn(
            { billing_provider: provider, error: (error as Error)?.message },
            "billing webhook inbox drain failed",
          );
        }
      },
    });
    if (response.status === 400) {
      // A rejected signature or body. Only these count toward the spike
      // alert; a storage failure (503) must not.
      const count = recordWebhookSignatureFailure();
      if (count >= 10) {
        void pageBillingAlert({
          code: "webhook_signature_spike",
          message: "Billing webhook signature failures are spiking.",
          details: { count },
        }).catch(() => undefined);
      }
    } else if (response.status === 503 && failure !== undefined) {
      logger.error(
        { billing_provider: provider, error: (failure as Error)?.message },
        "billing webhook could not be stored",
      );
      captureError({ error: failure, source: "billing.webhook" });
    }
    return res.status(response.status).json(response.body);
  },
);

export default router;
