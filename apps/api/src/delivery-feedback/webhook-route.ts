import { Router, raw } from "express";
import logger from "../services/log";
import { captureError, captureEvent } from "../observability/posthog";
import {
    decryptFeedbackCredentials,
    getFeedbackConnectionByConnectionId,
    recordFeedbackConnectionError,
    recordFeedbackConnectionReceived,
} from "./feedback-connection-queries";
import { getProviderAdapter } from "./adapters/registry";
import {
    createWebhookReceipt,
    findDuplicateReceipt,
    sanitizeHeaders,
} from "./webhook-receipt-queries";
import { enqueueReceiptForProcessing } from "./feedback-queue";

const MAX_BODY_BYTES = 10 * 1024 * 1024; // 10 MiB — PRD's configurable initial limit

const router = Router();

const WEBHOOK_PATH = "/webhooks/esp/:provider/:connectionId";

/**
 * Public, provider-authenticated webhook receiver —
 * `docs/bounces-and-complaints.md#3-public-webhook-endpoint`. Deliberately
 * outside `/api`, mounted (in `index.ts`) before `requireAuth`/`requireTeam`
 * and before global `express.json()`/`express.urlencoded()`: this route
 * needs the *unmodified raw bytes* for signature verification, and has no
 * session/API-key/CSRF concept at all — every request is instead
 * authenticated by the resolved connection's provider adapter before
 * anything is persisted or acknowledged.
 */
router.post(
    WEBHOOK_PATH,
    raw({ type: "*/*", limit: MAX_BODY_BYTES }),
    async (req, res) => {
        const provider = String(req.params.provider);
        const connectionId = String(req.params.connectionId);

        // 1. Resolve the opaque connection id and confirm the route
        // provider matches it — a mismatch (e.g. a stale/copied URL) is
        // treated identically to "unknown connection" so it leaks nothing.
        const adapter = getProviderAdapter(provider);
        if (!adapter) {
            return res.status(404).json({ error: "not_found" });
        }
        const connection = await getFeedbackConnectionByConnectionId(
            connectionId,
            provider,
        );
        if (!connection) {
            return res.status(404).json({ error: "not_found" });
        }

        const rawBody: Buffer = Buffer.isBuffer(req.body)
            ? req.body
            : Buffer.from(typeof req.body === "string" ? req.body : "");

        const decrypted = decryptFeedbackCredentials(connection);
        if (!decrypted) {
            return res.status(401).json({ error: "unauthorized" });
        }

        // 4. Verify signature/credential.
        let verifyResult;
        try {
            verifyResult = adapter.verify({
                rawBody,
                headers: req.headers as Record<
                    string,
                    string | string[] | undefined
                >,
                credential: decrypted.credential,
                previousCredential: decrypted.previousCredential,
            });
        } catch (err) {
            captureError({
                error: err,
                source: "webhook.verify",
                context: { provider, connection_id: connectionId },
            });
            return res.status(401).json({ error: "unauthorized" });
        }

        if (!verifyResult.valid) {
            captureEvent({
                event: "webhook_signature_invalid",
                source: "webhook.receive",
                properties: { provider, connection_id: connectionId },
            });
            await recordFeedbackConnectionError(
                connection.id,
                "invalid_signature",
            ).catch(() => {});
            return res.status(401).json({ error: "unauthorized" });
        }

        // Authenticated duplicate (same provider request id) — ack without
        // a second receipt/side effect.
        if (verifyResult.providerRequestId) {
            const duplicate = await findDuplicateReceipt(
                connection.id,
                verifyResult.providerRequestId,
            );
            if (duplicate) {
                return res.status(200).json({ status: "ok" });
            }
        }

        // 5. Minimal envelope validation — not full normalization.
        try {
            adapter.validateEnvelope(rawBody);
        } catch {
            captureEvent({
                event: "webhook_malformed_payload",
                source: "webhook.receive",
                properties: { provider, connection_id: connectionId },
            });
            return res.status(400).json({ error: "malformed_payload" });
        }

        // 6. Insert the authenticated raw receipt durably.
        let receipt;
        try {
            receipt = await createWebhookReceipt({
                connectionId: connection.id,
                teamId:
                    connection.scope === "custom" ? connection.teamId : null,
                provider,
                providerRequestId: verifyResult.providerRequestId ?? null,
                rawBody,
                safeHeaders: sanitizeHeaders(
                    req.headers as Record<
                        string,
                        string | string[] | undefined
                    >,
                ),
            });
        } catch (err) {
            captureError({
                error: err,
                source: "webhook.receipt_insert",
                context: { provider, connection_id: connectionId },
            });
            // Provider retry must remain possible.
            return res.status(503).json({ error: "unavailable" });
        }

        // 7. Return 200 only after the insert commits.
        res.status(200).json({ status: "ok" });

        // 8. Background dispatch — a failed enqueue here never loses the
        // committed receipt; the recovery poller (poller.ts) picks it up.
        await recordFeedbackConnectionReceived(connection.id).catch(() => {});
        enqueueReceiptForProcessing(receipt.id).catch((err) => {
            logger.error(
                { error: err.message, receipt_id: receipt.receiptId },
                "failed to enqueue webhook receipt for processing; recovery poller will retry",
            );
        });
    },
);

// Route-scoped error handler: a body over MAX_BODY_BYTES makes `raw()`
// throw before the handler above ever runs. Matched by Express as the next
// error-handling (4-arg) middleware for this path.
router.use(WEBHOOK_PATH, (err: any, _req: any, res: any, next: any) => {
    if (err?.status === 413 || err?.type === "entity.too.large") {
        return res.status(413).json({ error: "payload_too_large" });
    }
    next(err);
});

export default router;
