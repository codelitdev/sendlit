import type { BounceClass, DeliveryEventType } from "../../config/constants";
import {
    createSnsVerifier,
    fetchSnsUrl,
    isValidSubscribeUrl,
    type SnsMessage,
} from "./sns";
import type {
    ControlMessageOutcome,
    NormalizedCanonicalEvent,
    ProviderAdapter,
} from "./types";

/**
 * Amazon SES publishes bounce/complaint/delivery events to an SNS topic,
 * which delivers them to the connection's webhook URL as signed JSON
 * envelopes — see `docs/aws-bounces-and-complaints.md`. There is no
 * customer secret: a message is authentic when it is Amazon-signed *and*
 * its `TopicArn` equals the one configured on the connection.
 *
 * Both SES delivery paths are accepted: configuration-set event publishing
 * (`eventType`, carries message tags) and identity notifications
 * (`notificationType`, no tags).
 */

/** SNS caps messages at 256 KB; the envelope adds a little. */
const MAX_SNS_BODY_BYTES = 512 * 1024;

/** SES message tag stamped at send time with the outbound `msg_...` id —
 * see `delivery-feedback/outbound-send.ts#sesTransportHeaders`. */
export const SES_MESSAGE_TAG = "sendlit_message_id";

/** SES event type → the key holding that event's details. */
const DETAIL_KEYS: Record<string, string> = {
    Bounce: "bounce",
    Complaint: "complaint",
    Delivery: "delivery",
    DeliveryDelay: "deliveryDelay",
    Reject: "reject",
    RenderingFailure: "failure",
};

/** Engagement/lifecycle events a configuration set may also publish. SendLit
 * tracks opens/clicks itself and records sends in the outbound ledger, so
 * these are acknowledged without creating canonical events. */
const IGNORED_EVENT_TYPES = new Set(["Send", "Open", "Click", "Subscription"]);

/** Only these keep their raw payload past processing; `Delivery` is far
 * higher volume and its canonical event row carries all SendLit needs. */
const RETAINED_PAYLOAD_EVENT_TYPES = new Set([
    "Bounce",
    "Complaint",
    "Reject",
    "DeliveryDelay",
    "RenderingFailure",
]);

/** `Permanent` bounces SES didn't even attempt, because the address is on
 * SES's own suppression list — a provider-side suppression. */
const PROVIDER_SUPPRESSION_SUBTYPES = new Set([
    "Suppressed",
    "OnAccountSuppressionList",
]);

const SENDLIT_MESSAGE_ID = /^msg_[A-Za-z0-9]+$/;

const verifySnsMessage = createSnsVerifier();

function isPlainObject(value: unknown): value is Record<string, any> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseJsonObject(text: string): Record<string, any> | null {
    try {
        const parsed = JSON.parse(text);
        return isPlainObject(parsed) ? parsed : null;
    } catch {
        return null;
    }
}

function parseEnvelope(rawBody: Buffer): SnsMessage {
    const envelope = parseJsonObject(rawBody.toString("utf8"));
    if (!envelope) throw new Error("malformed_payload");
    return envelope;
}

/** The SES event inside a `Notification` envelope's `Message` string. */
function parseSesEvent(envelope: SnsMessage): Record<string, any> | null {
    if (envelope.Type !== "Notification") return null;
    if (typeof envelope.Message !== "string") return null;
    return parseJsonObject(envelope.Message);
}

/** Configuration sets use `eventType`, identity notifications use
 * `notificationType`; configuration sets also spell one type with a space
 * ("Rendering Failure"). */
export function sesEventType(event: Record<string, any>): string | null {
    const raw = event.eventType ?? event.notificationType;
    if (typeof raw !== "string") return null;
    return raw.replace(/\s+/g, "") || null;
}

function str(value: unknown): string | null {
    return typeof value === "string" && value ? value : null;
}

function list(value: unknown): any[] {
    return Array.isArray(value) ? value : [];
}

function toDate(value: unknown): Date | null {
    if (typeof value !== "string") return null;
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date : null;
}

/** e.g. `smtp; 550 5.1.1 user unknown` → `550`. */
function parseSmtpCode(value: unknown): number | null {
    const match =
        typeof value === "string" ? value.match(/\b([245]\d\d)\b/) : null;
    return match ? Number(match[1]) : null;
}

/** Tags arrive as `{ name: [value, ...] }`. */
function readSendlitMessageId(tags: unknown): string | null {
    if (!isPlainObject(tags)) return null;
    const values = tags[SES_MESSAGE_TAG];
    const value = Array.isArray(values) ? values[0] : values;
    return typeof value === "string" && SENDLIT_MESSAGE_ID.test(value)
        ? value
        : null;
}

function classifyBounce(
    bounceType: unknown,
    bounceSubType: unknown,
): { eventType: DeliveryEventType; bounceClass: BounceClass } {
    if (bounceType === "Permanent") {
        return {
            eventType: PROVIDER_SUPPRESSION_SUBTYPES.has(String(bounceSubType))
                ? "suppressed"
                : "hard_bounce",
            bounceClass: "permanent",
        };
    }
    // SES only reports a transient bounce once it has stopped retrying, so
    // it's a *final* soft bounce and feeds the repeated-soft-bounce streak.
    if (bounceType === "Transient") {
        return { eventType: "soft_bounce", bounceClass: "transient" };
    }
    return { eventType: "soft_bounce", bounceClass: "undetermined" };
}

/**
 * Pure mapping from one SES event to canonical events — one per affected
 * recipient, keyed `<type>:<SNS MessageId>:<recipient>` so an SNS
 * redelivery collides on the `(connectionId, providerEventKey)` index.
 */
export function normalizeSesEvent(
    event: Record<string, any>,
    snsMessageId: string,
): NormalizedCanonicalEvent[] {
    const type = sesEventType(event);
    if (!type || IGNORED_EVENT_TYPES.has(type)) return [];

    const mail = isPlainObject(event.mail) ? event.mail : {};
    const detailKey = DETAIL_KEYS[type];
    const detail =
        detailKey && isPlainObject(event[detailKey]) ? event[detailKey] : {};
    const destinations = list(mail.destination).map(str).filter(Boolean);

    const make = (
        recipientEmail: string | null,
        fields: Omit<
            NormalizedCanonicalEvent,
            | "providerEventKey"
            | "recipientEmail"
            | "occurredAt"
            | "providerMessageId"
        >,
    ): NormalizedCanonicalEvent => ({
        providerEventKey: `${type}:${snsMessageId}:${recipientEmail ?? ""}`,
        providerMessageId: str(mail.messageId),
        sendlitMessageId: readSendlitMessageId(mail.tags),
        recipientEmail,
        occurredAt:
            toDate(detail.timestamp) ?? toDate(mail.timestamp) ?? new Date(),
        ...fields,
    });

    // An event that names no recipient still yields one (recipient-less)
    // event, correlated through the message id alone.
    const orNone = <T>(items: T[]): (T | null)[] =>
        items.length > 0 ? items : [null];

    switch (type) {
        case "Bounce": {
            const { eventType, bounceClass } = classifyBounce(
                detail.bounceType,
                detail.bounceSubType,
            );
            return orNone(list(detail.bouncedRecipients)).map((recipient) =>
                make(str(recipient?.emailAddress), {
                    eventType,
                    bounceClass,
                    smtpCode: parseSmtpCode(recipient?.diagnosticCode),
                    enhancedStatusCode: str(recipient?.status),
                    reason:
                        str(recipient?.diagnosticCode) ??
                        `${detail.bounceType ?? "Undetermined"}/${detail.bounceSubType ?? "General"}`,
                    remoteMta: str(detail.remoteMtaIp),
                    metadata: {
                        bounceType: str(detail.bounceType),
                        bounceSubType: str(detail.bounceSubType),
                        action: str(recipient?.action),
                    },
                }),
            );
        }
        case "Complaint": {
            // A feedback report explicitly saying "not spam" is not a
            // complaint and must never suppress.
            if (detail.complaintFeedbackType === "not-spam") return [];
            return orNone(list(detail.complainedRecipients)).map((recipient) =>
                make(str(recipient?.emailAddress), {
                    eventType: "complaint",
                    reason: str(detail.complaintFeedbackType),
                    metadata: {
                        complaintFeedbackType: str(
                            detail.complaintFeedbackType,
                        ),
                        complaintSubType: str(detail.complaintSubType),
                    },
                }),
            );
        }
        case "Delivery":
            return orNone(list(detail.recipients).map(str).filter(Boolean)).map(
                (recipient) =>
                    make(recipient, {
                        eventType: "delivered",
                        smtpCode: parseSmtpCode(detail.smtpResponse),
                        remoteMta: str(detail.remoteMtaIp),
                    }),
            );
        case "DeliveryDelay":
            return orNone(list(detail.delayedRecipients)).map((recipient) =>
                make(str(recipient?.emailAddress), {
                    eventType: "delayed",
                    smtpCode: parseSmtpCode(recipient?.diagnosticCode),
                    enhancedStatusCode: str(recipient?.status),
                    reason:
                        str(recipient?.diagnosticCode) ?? str(detail.delayType),
                    remoteMta: str(detail.reportingMTA),
                    metadata: { delayType: str(detail.delayType) },
                }),
            );
        case "Reject":
            return orNone(destinations).map((recipient) =>
                make(recipient, {
                    eventType: "rejected",
                    reason: str(detail.reason),
                }),
            );
        case "RenderingFailure":
            return orNone(destinations).map((recipient) =>
                make(recipient, {
                    eventType: "failed",
                    reason: str(detail.errorMessage),
                    metadata: { templateName: str(detail.templateName) },
                }),
            );
        default:
            return [
                make(null, {
                    eventType: "unknown",
                    metadata: { sesEventType: type },
                }),
            ];
    }
}

async function confirmSubscription(
    envelope: SnsMessage,
): Promise<ControlMessageOutcome> {
    if (
        !isValidSubscribeUrl(envelope.SubscribeURL, String(envelope.TopicArn))
    ) {
        return "subscription_confirm_failed";
    }
    try {
        const response = await fetchSnsUrl(envelope.SubscribeURL as string);
        return response.ok
            ? "subscription_confirmed"
            : "subscription_confirm_failed";
    } catch {
        return "subscription_confirm_failed";
    }
}

export const sesAdapter: ProviderAdapter = {
    provider: "ses",
    credentialless: true,
    maxBodyBytes: MAX_SNS_BODY_BYTES,

    async verify({ rawBody, expectedTopicArn }) {
        if (!expectedTopicArn) return { valid: false };
        const envelope = parseJsonObject(rawBody.toString("utf8"));
        // Checked before the signature so a stray request never triggers a
        // certificate fetch.
        if (!envelope || envelope.TopicArn !== expectedTopicArn) {
            return { valid: false };
        }
        const result = await verifySnsMessage(envelope);
        if (result === "unavailable") return { valid: false, retryable: true };
        return {
            valid: result === "valid",
            providerRequestId: str(envelope.MessageId),
        };
    },

    async handleControl(rawBody) {
        const envelope = parseEnvelope(rawBody);
        if (envelope.Type === "SubscriptionConfirmation") {
            return confirmSubscription(envelope);
        }
        if (envelope.Type === "UnsubscribeConfirmation") return "unsubscribed";
        return null;
    },

    validateEnvelope(rawBody) {
        if (!parseSesEvent(parseEnvelope(rawBody))) {
            throw new Error("malformed_payload");
        }
    },

    normalize(rawBody) {
        const envelope = parseEnvelope(rawBody);
        const event = parseSesEvent(envelope);
        if (!event) throw new Error("malformed_payload");
        return normalizeSesEvent(event, String(envelope.MessageId));
    },

    redactForStorage(rawBody) {
        const envelope = parseEnvelope(rawBody);
        const event = parseSesEvent(envelope);
        if (
            !event ||
            !isPlainObject(event.mail) ||
            !("headers" in event.mail)
        ) {
            return rawBody;
        }
        const { headers: _headers, ...mail } = event.mail;
        return Buffer.from(
            JSON.stringify({
                ...envelope,
                Message: JSON.stringify({ ...event, mail }),
            }),
        );
    },

    retainPayloadAfterProcessing(rawBody) {
        const event = parseSesEvent(parseEnvelope(rawBody));
        const type = event ? sesEventType(event) : null;
        return type !== null && RETAINED_PAYLOAD_EVENT_TYPES.has(type);
    },
};
