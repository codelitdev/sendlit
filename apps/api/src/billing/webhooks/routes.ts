import express, { Router } from "express";
import rateLimit from "express-rate-limit";
import { getBillingEngine } from "../engine";
import { pageBillingAlert, recordWebhookSignatureFailure } from "../alerts";

const router = Router();

const limiter = rateLimit({
    windowMs: 60_000,
    max: 300,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => req.ip || "unknown",
});

/** Provider webhook ingress must precede express.json() in index.ts. */
router.post(
    "/webhooks/billing/dodo",
    limiter,
    express.raw({ type: "application/json", limit: "256kb" }),
    async (req, res) => {
        const body = Buffer.isBuffer(req.body) ? req.body.toString("utf8") : "";
        if (!body)
            return res.status(400).json({ error: "webhook_body_required" });
        const headers: Record<string, string> = {};
        for (const [key, value] of Object.entries(req.headers)) {
            if (typeof value === "string") headers[key.toLowerCase()] = value;
            else if (Array.isArray(value))
                headers[key.toLowerCase()] = value[0] ?? "";
        }
        try {
            const billing = getBillingEngine();
            const ingested = await billing.ingestWebhook({
                provider: "dodo",
                raw: { body, headers },
            });
            if (ingested.duplicate) {
                return res
                    .status(200)
                    .json({ accepted: true, duplicate: true });
            }
            res.status(202).json({ accepted: true });
            void billing
                .runWebhookInboxBatch({ workerId: `billing-${process.pid}` })
                .catch(() => undefined);
        } catch {
            const count = recordWebhookSignatureFailure();
            if (count >= 10) {
                void pageBillingAlert({
                    code: "webhook_signature_spike",
                    message: "Billing webhook signature failures are spiking.",
                    details: { count },
                }).catch(() => undefined);
            }
            return res.status(400).json({ error: "webhook_signature_invalid" });
        }
    },
);

export default router;
