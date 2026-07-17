import crypto from "crypto";
import type { BounceClass, DeliveryEventType } from "../../config/constants";
import { headerString } from "./header-utils";
import type { NormalizedCanonicalEvent, ProviderAdapter } from "./types";

/**
 * SendGrid's Signed Event Webhook signs `timestamp + rawBody` with ECDSA
 * (P-256/SHA-256) and delivers the signature and timestamp in the
 * `X-Twilio-Email-Event-Webhook-Signature`/`-Timestamp` headers. The
 * verification key shown in SendGrid's Mail Settings is a base64-encoded DER
 * SPKI public key; we PEM-wrap it and verify with Node's built-in `crypto` —
 * exactly what SendGrid's own `@sendgrid/eventwebhook` helper does internally,
 * so no extra dependency or hand-rolled curve math is involved. See
 * `docs/bounces-and-complaints.md`'s SendGrid requirements.
 */
const SIGNATURE_HEADER = "x-twilio-email-event-webhook-signature";
const TIMESTAMP_HEADER = "x-twilio-email-event-webhook-timestamp";

function toPublicKey(base64Der: string): crypto.KeyObject {
    // SendGrid presents the key as single-line base64 DER; PEM-wrapping it is
    // how their library feeds it to OpenSSL.
    const pem = `-----BEGIN PUBLIC KEY-----\n${base64Der}\n-----END PUBLIC KEY-----\n`;
    return crypto.createPublicKey({ key: pem, format: "pem" });
}

function verifySignature(
    verificationKey: string,
    rawBody: Buffer,
    signature: string,
    timestamp: string,
): boolean {
    if (!verificationKey || !signature || !timestamp) return false;
    try {
        const verifier = crypto.createVerify("sha256");
        // Signed content is the timestamp string immediately followed by the
        // exact raw body bytes (including any trailing newline SendGrid adds).
        verifier.update(
            Buffer.concat([Buffer.from(timestamp, "utf8"), rawBody]),
        );
        verifier.end();
        return verifier.verify(
            toPublicKey(verificationKey),
            Buffer.from(signature, "base64"),
        );
    } catch {
        // A malformed key/signature is an auth failure, never a 500.
        return false;
    }
}

const EVENT_TYPE_MAP: Record<string, DeliveryEventType> = {
    delivered: "delivered",
    deferred: "delayed",
    spamreport: "complaint",
    // `dropped` is SendGrid's pre-send filter echo (e.g. "Bounced Address",
    // "Spam Content"). It is mapped to `rejected` and never suppresses on its
    // own — the authoritative suppression signals are the `bounce` and
    // `spamreport` events below, which avoids wrongly blocking a valid address
    // that was dropped for a content/config reason.
    dropped: "rejected",
};

function classifyBounce(event: any): {
    eventType: DeliveryEventType;
    bounceClass: BounceClass;
} {
    // SendGrid tags a soft/temporary block as `type: "blocked"`; a true
    // permanent bounce is `type: "bounce"` (or absent on older payloads).
    if (event.type === "blocked") {
        return { eventType: "soft_bounce", bounceClass: "transient" };
    }
    return { eventType: "hard_bounce", bounceClass: "permanent" };
}

function parsePayload(rawBody: Buffer): any {
    return JSON.parse(rawBody.toString("utf8"));
}

export const sendgridAdapter: ProviderAdapter = {
    provider: "sendgrid",
    verify({ rawBody, headers, credential, previousCredential }) {
        const signature = headerString(headers, SIGNATURE_HEADER);
        const timestamp = headerString(headers, TIMESTAMP_HEADER);
        const valid =
            verifySignature(credential, rawBody, signature, timestamp) ||
            (Boolean(previousCredential) &&
                verifySignature(
                    previousCredential!,
                    rawBody,
                    signature,
                    timestamp,
                ));
        // SendGrid has no per-batch request id header; event-level
        // `sg_event_id` idempotency (below) is the dedup key.
        return { valid, providerRequestId: null };
    },

    validateEnvelope(rawBody) {
        const parsed = parsePayload(rawBody);
        if (!Array.isArray(parsed)) {
            throw new Error("malformed_payload");
        }
    },

    normalize(rawBody): NormalizedCanonicalEvent[] {
        const events = parsePayload(rawBody);
        if (!Array.isArray(events)) return [];

        return events.map((event: any): NormalizedCanonicalEvent => {
            const name = String(event.event ?? "");
            let eventType: DeliveryEventType;
            let bounceClass: BounceClass | null = null;
            if (name === "bounce") {
                const classified = classifyBounce(event);
                eventType = classified.eventType;
                bounceClass = classified.bounceClass;
            } else {
                eventType = EVENT_TYPE_MAP[name] ?? "unknown";
            }

            const sgEventId: string | undefined = event.sg_event_id;
            const sgMessageId: string | undefined = event.sg_message_id;
            const occurredAt =
                typeof event.timestamp === "number"
                    ? new Date(event.timestamp * 1000)
                    : new Date();

            return {
                // `sg_event_id` is globally unique per event; fall back to a
                // deterministic composite only if a payload omits it.
                providerEventKey:
                    sgEventId ??
                    `${sgMessageId ?? "unknown"}:${name}:${event.email ?? ""}`,
                providerMessageId: sgMessageId ?? null,
                recipientEmail: event.email ?? null,
                eventType,
                bounceClass,
                enhancedStatusCode: event.status ?? null,
                reason: event.reason ?? null,
                occurredAt,
                metadata: {},
            };
        });
    },
};
