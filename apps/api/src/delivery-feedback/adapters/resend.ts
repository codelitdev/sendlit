import { Webhook, WebhookVerificationError } from "svix";
import type { DeliveryEventType, BounceClass } from "../../config/constants";
import { headerString } from "./header-utils";
import type {
    NormalizedCanonicalEvent,
    ProviderAdapter,
    VerifyWebhookInput,
} from "./types";

/**
 * Resend signs webhooks using Svix (`svix-id`/`svix-timestamp`/
 * `svix-signature` headers over the endpoint signing secret) — verified
 * here with the maintained `svix` package rather than custom cryptography,
 * per `docs/bounces-and-complaints.md`'s Resend requirements.
 */
function trySvixVerify(
    secret: string,
    rawBody: Buffer,
    headers: VerifyWebhookInput["headers"],
): boolean {
    try {
        new Webhook(secret).verify(rawBody, {
            "svix-id": headerString(headers, "svix-id"),
            "svix-timestamp": headerString(headers, "svix-timestamp"),
            "svix-signature": headerString(headers, "svix-signature"),
        });
        return true;
    } catch (err) {
        if (err instanceof WebhookVerificationError) return false;
        throw err;
    }
}

/** Resend defines `email.bounced` as a permanent rejection — it never
 * retries after emitting it — so it maps to `hard_bounce`, not
 * `soft_bounce`. `email.suppressed` mirrors Resend's own suppression list,
 * which is a provider-side signal distinct from a SendLit bounce/complaint. */
const RESEND_EVENT_TYPE_MAP: Record<string, DeliveryEventType> = {
    "email.delivered": "delivered",
    "email.delivery_delayed": "delayed",
    "email.bounced": "hard_bounce",
    "email.complained": "complaint",
    "email.suppressed": "suppressed",
    "email.failed": "failed",
};

function parsePayload(rawBody: Buffer): any {
    return JSON.parse(rawBody.toString("utf8"));
}

export const resendAdapter: ProviderAdapter = {
    provider: "resend",
    verify({ rawBody, headers, credential, previousCredential }) {
        const providerRequestId = headerString(headers, "svix-id") || null;
        if (trySvixVerify(credential, rawBody, headers)) {
            return { valid: true, providerRequestId };
        }
        if (
            previousCredential &&
            trySvixVerify(previousCredential, rawBody, headers)
        ) {
            return { valid: true, providerRequestId };
        }
        return { valid: false, providerRequestId };
    },

    validateEnvelope(rawBody) {
        const parsed = parsePayload(rawBody);
        if (!parsed || typeof parsed !== "object" || !parsed.type) {
            throw new Error("malformed_payload");
        }
    },

    normalize(rawBody): NormalizedCanonicalEvent[] {
        const parsed = parsePayload(rawBody);
        const type = parsed.type as string;
        const data = parsed.data ?? {};
        const eventType: DeliveryEventType =
            RESEND_EVENT_TYPE_MAP[type] ?? "unknown";
        const emailId: string | undefined = data.email_id;
        const recipientEmail: string | null = Array.isArray(data.to)
            ? (data.to[0] ?? null)
            : (data.to ?? null);
        const bounceClass: BounceClass | null =
            eventType === "hard_bounce" ? "permanent" : null;
        const occurredAt = data.created_at
            ? new Date(data.created_at)
            : new Date();

        return [
            {
                providerEventKey: `${emailId ?? "unknown"}:${type}`,
                providerMessageId: emailId ?? null,
                recipientEmail,
                eventType,
                bounceClass,
                reason: data.bounce?.message ?? data.reason ?? null,
                occurredAt,
                metadata: {},
            },
        ];
    },
};
