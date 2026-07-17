import crypto from "crypto";
import type { BounceClass, DeliveryEventType } from "../../config/constants";
import { constantTimeEqual } from "./header-utils";
import type { NormalizedCanonicalEvent, ProviderAdapter } from "./types";

/**
 * Mailgun signs its webhooks by HMAC-SHA256 over `timestamp + token` (both
 * carried in the JSON body's `signature` object, not headers) using the
 * domain's HTTP webhook signing key. Per `docs/bounces-and-complaints.md`'s
 * Mailgun requirements we compare in constant time, reject a stale timestamp
 * outside a five-minute window, and rely on receipt-level dedup for replay:
 * the one-time `token` is returned as `providerRequestId`, so a replayed
 * request collides with its already-stored receipt (retained far longer than
 * Mailgun's 24h replay window) instead of needing a separate token cache.
 */
const TIMESTAMP_WINDOW_SECONDS = 5 * 60;

interface MailgunSignature {
    timestamp: string;
    token: string;
    signature: string;
}

function computeSignature(signingKey: string, sig: MailgunSignature): string {
    return crypto
        .createHmac("sha256", signingKey)
        .update(sig.timestamp + sig.token)
        .digest("hex");
}

function signatureValid(signingKey: string, sig: MailgunSignature): boolean {
    if (!signingKey) return false;
    return constantTimeEqual(computeSignature(signingKey, sig), sig.signature);
}

function parsePayload(rawBody: Buffer): any {
    return JSON.parse(rawBody.toString("utf8"));
}

function extractSignature(parsed: any): MailgunSignature | null {
    const sig = parsed?.signature;
    if (
        !sig ||
        typeof sig.timestamp !== "string" ||
        typeof sig.token !== "string" ||
        typeof sig.signature !== "string"
    ) {
        return null;
    }
    return sig;
}

/** Mailgun `failed` events carry a `severity` and a `reason`; a
 * `suppress-*` reason means the recipient is already on Mailgun's own
 * suppression list, which mirrors a provider-side suppression. */
function classifyFailed(event: any): {
    eventType: DeliveryEventType;
    bounceClass: BounceClass | null;
} {
    const reason = String(event.reason ?? "");
    if (reason.startsWith("suppress-")) {
        return { eventType: "suppressed", bounceClass: null };
    }
    if (event.severity === "permanent") {
        return { eventType: "hard_bounce", bounceClass: "permanent" };
    }
    if (event.severity === "temporary") {
        // A temporary failure means Mailgun will keep retrying — a delay,
        // not a final bounce.
        return { eventType: "delayed", bounceClass: null };
    }
    return { eventType: "soft_bounce", bounceClass: "undetermined" };
}

export const mailgunAdapter: ProviderAdapter = {
    provider: "mailgun",
    verify({ rawBody, credential, previousCredential }) {
        let parsed: any;
        try {
            parsed = parsePayload(rawBody);
        } catch {
            return { valid: false };
        }
        const sig = extractSignature(parsed);
        if (!sig) return { valid: false };

        // Reject a timestamp outside the replay window before trusting the
        // signature's freshness.
        const nowSeconds = Date.now() / 1000;
        const ts = Number(sig.timestamp);
        if (
            !Number.isFinite(ts) ||
            Math.abs(nowSeconds - ts) > TIMESTAMP_WINDOW_SECONDS
        ) {
            return { valid: false, providerRequestId: sig.token };
        }

        const valid =
            signatureValid(credential, sig) ||
            (Boolean(previousCredential) &&
                signatureValid(previousCredential!, sig));
        // The one-time token dedups replays at the receipt layer.
        return { valid, providerRequestId: sig.token };
    },

    validateEnvelope(rawBody) {
        const parsed = parsePayload(rawBody);
        if (
            !parsed ||
            typeof parsed !== "object" ||
            !parsed["event-data"] ||
            typeof parsed["event-data"].event !== "string"
        ) {
            throw new Error("malformed_payload");
        }
    },

    normalize(rawBody): NormalizedCanonicalEvent[] {
        const parsed = parsePayload(rawBody);
        const event = parsed["event-data"] ?? {};
        const name = String(event.event ?? "");

        let eventType: DeliveryEventType;
        let bounceClass: BounceClass | null = null;
        if (name === "delivered") {
            eventType = "delivered";
        } else if (name === "complained") {
            eventType = "complaint";
        } else if (name === "failed") {
            const classified = classifyFailed(event);
            eventType = classified.eventType;
            bounceClass = classified.bounceClass;
        } else {
            eventType = "unknown";
        }

        const occurredAt =
            typeof event.timestamp === "number"
                ? new Date(event.timestamp * 1000)
                : new Date();
        const messageId: string | null =
            event.message?.headers?.["message-id"] ?? null;
        const deliveryStatus = event["delivery-status"] ?? {};
        const id: string = event.id ?? "unknown";

        return [
            {
                // Mailgun event ids are only unique within a day, so the
                // idempotency key is scoped by the event's UTC date.
                providerEventKey: `${occurredAt.toISOString().slice(0, 10)}:${id}`,
                providerMessageId: messageId,
                recipientEmail: event.recipient ?? null,
                eventType,
                bounceClass,
                smtpCode:
                    typeof deliveryStatus.code === "number"
                        ? deliveryStatus.code
                        : null,
                reason:
                    event.reason ??
                    deliveryStatus.message ??
                    deliveryStatus.description ??
                    null,
                occurredAt,
                metadata: {},
            },
        ];
    },
};
