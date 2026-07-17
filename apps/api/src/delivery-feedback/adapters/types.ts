import type { BounceClass, DeliveryEventType } from "../../config/constants";

export interface VerifyWebhookInput {
    rawBody: Buffer;
    headers: Record<string, string | string[] | undefined>;
    credential: string;
    /** Set only within the 24h post-rotation grace window — see
     * `decryptFeedbackCredentials`. */
    previousCredential?: string;
}

export interface VerifyWebhookResult {
    valid: boolean;
    /** The provider's own idempotency-relevant request id, when the
     * transport exposes one (e.g. Resend/Svix's `svix-id`) — used for
     * receipt-level dedup ahead of event-level idempotency. */
    providerRequestId?: string | null;
}

export interface NormalizedCanonicalEvent {
    /** Deterministic per-(connection, event) idempotency key — replaying the
     * same provider event must resolve to the same key. */
    providerEventKey: string;
    providerMessageId?: string | null;
    recipientEmail?: string | null;
    eventType: DeliveryEventType;
    bounceClass?: BounceClass | null;
    smtpCode?: number | null;
    enhancedStatusCode?: string | null;
    reason?: string | null;
    remoteMta?: string | null;
    occurredAt: Date;
    metadata?: Record<string, unknown>;
}

/**
 * A reviewed adapter for one feedback-capable provider — see
 * `docs/bounces-and-complaints.md`'s provider-specific requirements. Only
 * providers with an adapter registered in `./registry.ts` are presented as
 * feedback-capable anywhere in the API (Non-goals: "A provider must have a
 * reviewed adapter before SendLit presents it as feedback-capable").
 */
export interface ProviderAdapter {
    provider: string;
    /** Must run against the *raw* bytes, before any JSON parsing — signature
     * schemes are defined over the exact wire payload. */
    verify(input: VerifyWebhookInput): VerifyWebhookResult;
    /** Minimal envelope check — throws to reject the receipt with `400`
     * before it's ever stored. Does not fully normalize. */
    validateEnvelope(rawBody: Buffer): void;
    /** Full normalization, called later/asynchronously by the worker.
     * Unsupported-but-valid event types map to `eventType: "unknown"`
     * rather than throwing — an adapter must tolerate additive fields. */
    normalize(rawBody: Buffer): NormalizedCanonicalEvent[];
}
