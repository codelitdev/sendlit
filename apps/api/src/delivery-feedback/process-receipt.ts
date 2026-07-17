import logger from "../services/log";
import { captureError } from "../observability/posthog";
import { normalizeEmail } from "../utils/email";
import {
    finalSoftBounceSuppressionThreshold,
    type DeliveryEventType,
} from "../config/constants";
import { getProviderAdapter } from "./adapters/registry";
import type { NormalizedCanonicalEvent } from "./adapters/types";
import {
    claimReceiptForProcessing,
    decryptReceiptPayload,
    getWebhookReceiptById,
    markReceiptDeadLetter,
    markReceiptFailedForRetry,
    markReceiptPartial,
    markReceiptProcessed,
    type WebhookReceipt,
} from "./webhook-receipt-queries";
import {
    insertCanonicalEventIfNew,
    linkEventToOutboundMessage,
} from "./delivery-event-queries";
import { correlateOutboundMessage } from "./correlation";
import { applyEventToProjection } from "./projection";
import { addOrStrengthenSuppression } from "./suppression-queries";
import { computeFinalSoftBounceStreak } from "./soft-bounce-streak";
import { recordFeedbackConnectionVerified } from "./feedback-connection-queries";

/**
 * Claims and normalizes one durable receipt into canonical events, applying
 * projection/suppression side effects — the async half of
 * `docs/bounces-and-complaints.md#4-durable-receipt-inbox`. Called by both
 * the BullMQ worker and the recovery poller, so it must be safe to invoke
 * concurrently for the same receipt (the claim is the guard).
 */
export async function processWebhookReceipt(receiptId: string): Promise<void> {
    const claimed = await claimReceiptForProcessing(receiptId);
    if (!claimed) return;

    const receipt = await getWebhookReceiptById(receiptId);
    if (!receipt) return;

    const adapter = getProviderAdapter(receipt.provider);
    if (!adapter) {
        await markReceiptDeadLetter(receiptId, "unsupported_provider");
        return;
    }

    const rawBody = decryptReceiptPayload(receipt);
    if (!rawBody) {
        await markReceiptDeadLetter(receiptId, "missing_payload");
        return;
    }

    let events: NormalizedCanonicalEvent[];
    try {
        events = adapter.normalize(rawBody);
    } catch (err: any) {
        logger.error(
            { error: err.message, receipt_id: receipt.receiptId },
            "feedback receipt normalization failed",
        );
        captureError({
            error: err,
            source: "feedback.normalize",
            context: {
                provider: receipt.provider,
                receipt_id: receipt.receiptId,
            },
        });
        await markReceiptFailedForRetry(receiptId, "normalize_failed");
        return;
    }

    let anyFailed = false;
    for (const event of events) {
        try {
            await processOneEvent(receipt, event);
        } catch (err: any) {
            anyFailed = true;
            logger.error(
                {
                    error: err.message,
                    receipt_id: receipt.receiptId,
                    event_type: event.eventType,
                },
                "feedback event processing failed",
            );
            captureError({
                error: err,
                source: "feedback.process_event",
                context: {
                    provider: receipt.provider,
                    receipt_id: receipt.receiptId,
                    event_type: event.eventType,
                },
            });
        }
    }

    if (anyFailed) {
        await markReceiptPartial(receiptId);
    } else {
        await markReceiptProcessed(receiptId);
        // A fully-processed authenticated receipt is the PRD's definition
        // of a healthy connection — not just the manual "test" action.
        await recordFeedbackConnectionVerified(receipt.connectionId);
    }
}

async function processOneEvent(
    receipt: WebhookReceipt,
    event: NormalizedCanonicalEvent,
): Promise<void> {
    const inserted = await insertCanonicalEventIfNew({
        connectionId: receipt.connectionId,
        receiptId: receipt.id,
        teamId: receipt.teamId,
        provider: receipt.provider,
        providerEventKey: event.providerEventKey,
        providerMessageId: event.providerMessageId ?? null,
        recipientEmail: event.recipientEmail ?? null,
        normalizedRecipient: event.recipientEmail
            ? normalizeEmail(event.recipientEmail)
            : null,
        eventType: event.eventType,
        bounceClass: event.bounceClass ?? null,
        smtpCode: event.smtpCode ?? null,
        enhancedStatusCode: event.enhancedStatusCode ?? null,
        reason: event.reason ?? null,
        remoteMta: event.remoteMta ?? null,
        occurredAt: event.occurredAt,
        receivedAt: receipt.receivedAt,
        metadata: event.metadata ?? {},
    });
    // Duplicate provider event (idempotency key collision) — already fully
    // processed the first time; nothing left to do.
    if (!inserted) return;

    if (event.eventType === "unknown") return;

    const outbound = await correlateOutboundMessage({
        connectionId: receipt.connectionId,
        providerMessageId: event.providerMessageId,
        recipientEmail: event.recipientEmail,
    });

    // A custom connection's receipts always carry `teamId` already (assigned
    // from the connection at receipt time); this only matters for a future
    // platform connection, whose receipts are teamless until a uniquely
    // matched outbound message assigns one — see
    // docs/bounces-and-complaints.md#6-correlation.
    const teamId = receipt.teamId ?? outbound?.teamId ?? null;

    if (outbound && teamId) {
        await linkEventToOutboundMessage(inserted.id, outbound.id, teamId);
        await applyEventToProjection(
            outbound.id,
            event.eventType,
            event.occurredAt,
        );
    }

    await applySuppressionSideEffect({
        teamId,
        recipientEmail:
            event.recipientEmail ?? outbound?.recipientEmail ?? null,
        eventType: event.eventType,
        sourceEventId: inserted.id,
    });
}

async function applySuppressionSideEffect({
    teamId,
    recipientEmail,
    eventType,
    sourceEventId,
}: {
    teamId: string | null;
    recipientEmail: string | null;
    eventType: DeliveryEventType;
    sourceEventId: string;
}): Promise<void> {
    // Never guess: no team (unmatched platform event) or no recipient (a
    // redacted complaint that didn't correlate) means no suppression side
    // effect — see docs/bounces-and-complaints.md#6-correlation.
    if (!teamId || !recipientEmail) return;

    if (eventType === "hard_bounce") {
        await addOrStrengthenSuppression({
            teamId,
            recipientEmail,
            reason: "hard_bounce",
            sourceEventId,
            actorType: "system",
        });
        return;
    }
    if (eventType === "complaint") {
        await addOrStrengthenSuppression({
            teamId,
            recipientEmail,
            reason: "complaint",
            sourceEventId,
            actorType: "system",
        });
        return;
    }
    if (eventType === "suppressed") {
        await addOrStrengthenSuppression({
            teamId,
            recipientEmail,
            reason: "provider_suppression",
            sourceEventId,
            actorType: "system",
        });
        return;
    }
    if (eventType === "soft_bounce") {
        const streak = await computeFinalSoftBounceStreak(
            teamId,
            normalizeEmail(recipientEmail),
        );
        if (streak >= finalSoftBounceSuppressionThreshold) {
            await addOrStrengthenSuppression({
                teamId,
                recipientEmail,
                reason: "repeated_soft_bounce",
                sourceEventId,
                actorType: "system",
            });
        }
    }
}
