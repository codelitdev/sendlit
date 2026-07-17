import type { BounceClass, DeliveryEventType } from "../../config/constants";
import { constantTimeEqual, headerString } from "./header-utils";
import type { NormalizedCanonicalEvent, ProviderAdapter } from "./types";

/**
 * Postmark does not sign these webhooks with HMAC — per
 * `docs/bounces-and-complaints.md`'s Postmark requirements, authentication
 * instead uses a high-entropy shared secret, presented either as a custom
 * header (`X-SendLit-Webhook-Secret`, configured via Postmark's Webhooks API
 * `HttpHeaders`) or as the password half of HTTP Basic auth (`HttpAuth`).
 * Both are compared in constant time; IP allowlisting is left to
 * infrastructure as defense in depth, not relied on here.
 */
function extractBasicAuthPassword(
    headers: Record<string, string | string[] | undefined>,
): string | null {
    const auth = headerString(headers, "authorization");
    if (!auth.toLowerCase().startsWith("basic ")) return null;
    try {
        const decoded = Buffer.from(auth.slice(6), "base64").toString("utf8");
        const separatorIndex = decoded.indexOf(":");
        return separatorIndex === -1
            ? decoded
            : decoded.slice(separatorIndex + 1);
    } catch {
        return null;
    }
}

const HARD_BOUNCE_TYPES = new Set([
    "HardBounce",
    "Blocked",
    "ManuallyDeactivated",
    "DMARCPolicy",
]);
const SOFT_BOUNCE_TYPES = new Set([
    "SoftBounce",
    "Transient",
    "DnsError",
    "MailboxFull",
    "SpamNotification",
]);

function parsePayload(rawBody: Buffer): any {
    return JSON.parse(rawBody.toString("utf8"));
}

export const postmarkAdapter: ProviderAdapter = {
    provider: "postmark",
    verify({ headers, credential, previousCredential }) {
        const presented =
            headerString(headers, "x-sendlit-webhook-secret") ||
            extractBasicAuthPassword(headers) ||
            "";
        if (!presented) return { valid: false };
        const candidates = [credential, previousCredential].filter(
            (c): c is string => Boolean(c),
        );
        const valid = candidates.some((c) => constantTimeEqual(presented, c));
        return { valid };
    },

    validateEnvelope(rawBody) {
        const parsed = parsePayload(rawBody);
        if (!parsed || typeof parsed !== "object" || !parsed.RecordType) {
            throw new Error("malformed_payload");
        }
    },

    normalize(rawBody): NormalizedCanonicalEvent[] {
        const data = parsePayload(rawBody);
        const recordType = data.RecordType as string;

        let eventType: DeliveryEventType = "unknown";
        let bounceClass: BounceClass | null = null;
        if (recordType === "Delivery") {
            eventType = "delivered";
        } else if (recordType === "SpamComplaint") {
            eventType = "complaint";
        } else if (recordType === "Bounce") {
            const type = data.Type as string;
            if (HARD_BOUNCE_TYPES.has(type)) {
                eventType = "hard_bounce";
                bounceClass = "permanent";
            } else if (SOFT_BOUNCE_TYPES.has(type)) {
                eventType = "soft_bounce";
                bounceClass = "transient";
            }
        }

        // Bounce/SpamComplaint payloads carry a stable numeric `ID`; the
        // Delivery payload doesn't, so fall back to a composite key.
        const providerEventKey =
            data.ID != null
                ? `${recordType}:${data.ID}`
                : `${recordType}:${data.MessageID ?? "unknown"}:${data.Recipient ?? data.Email ?? ""}`;

        const occurredAt =
            data.BouncedAt || data.DeliveredAt || data.ReceivedAt;

        return [
            {
                providerEventKey,
                providerMessageId: data.MessageID ?? null,
                recipientEmail: data.Email ?? data.Recipient ?? null,
                eventType,
                bounceClass,
                reason: data.Description ?? data.Details ?? null,
                occurredAt: occurredAt ? new Date(occurredAt) : new Date(),
                metadata: {},
            },
        ];
    },
};
