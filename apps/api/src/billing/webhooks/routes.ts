import express, { Router } from "express";
import rateLimit from "express-rate-limit";
import { db } from "../../db/client";
import { billingWebhookEvents } from "../../db/schema";
import { encryptBillingValue } from "../crypto";
import { getBillingProvider } from "../provider-registry";
import {
    claimBillingWebhookEvent,
    processBillingWebhookInboxEvent,
} from "./processor";
import type { CanonicalBillingEvent } from "../provider";
import { pageBillingAlert, recordWebhookSignatureFailure } from "../alerts";

const router = Router();

function serializeCanonicalEvent(event: CanonicalBillingEvent) {
    const snapshot = event.snapshot
        ? {
              ...event.snapshot,
              occurredAt: event.snapshot.occurredAt.toISOString(),
              currentPeriodStartsAt:
                  event.snapshot.currentPeriodStartsAt?.toISOString() ?? null,
              currentPeriodEndsAt:
                  event.snapshot.currentPeriodEndsAt?.toISOString() ?? null,
              paidThroughAt:
                  event.snapshot.paidThroughAt?.toISOString() ?? null,
              trialEndsAt: event.snapshot.trialEndsAt?.toISOString() ?? null,
          }
        : undefined;
    return {
        provider: event.provider,
        providerEventId: event.providerEventId,
        eventType: event.eventType,
        occurredAt: event.occurredAt.toISOString(),
        subscriptionId: event.subscriptionId,
        snapshot,
    };
}
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
        let event;
        let provider;
        try {
            provider = getBillingProvider("dodo");
            event = await provider.parseWebhook({ body, headers });
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
        try {
            const [stored] = await db
                .insert(billingWebhookEvents)
                .values({
                    provider: event.provider,
                    providerEventId: event.providerEventId,
                    eventType: event.eventType,
                    occurredAt: event.occurredAt,
                    // Keep the verified raw headers with the encrypted body so
                    // a later inbox worker can re-verify a replay after the
                    // request process has exited.
                    payloadEncrypted: encryptBillingValue(
                        JSON.stringify({
                            body,
                            headers,
                            canonical: serializeCanonicalEvent(event),
                        }),
                    ),
                    payloadKeyVersion:
                        process.env.BILLING_DATA_ENCRYPTION_KEY_VERSION || "v1",
                    status: "pending",
                })
                .returning({ id: billingWebhookEvents.id });
            if (!stored)
                return res
                    .status(500)
                    .json({ error: "webhook_persistence_failed" });
            await claimBillingWebhookEvent(stored.id);
            res.status(202).json({ accepted: true });
            // Processing is durable and asynchronous; consume the terminal
            // rejection so a quarantined event cannot become an unhandled
            // promise rejection in the API process.
            // Read the durable envelope again in the worker. Subscription
            // events are then refreshed from the provider before projection;
            // provider outages become inbox retries rather than failed webhook
            // deliveries that exist only in the provider's retry queue.
            void processBillingWebhookInboxEvent(stored.id).catch(
                () => undefined,
            );
        } catch (error: any) {
            if (error?.code === "23505") {
                return res
                    .status(200)
                    .json({ accepted: true, duplicate: true });
            }
            return res
                .status(500)
                .json({ error: "webhook_persistence_failed" });
        }
    },
);

export default router;
