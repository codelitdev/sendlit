import type { BounceClass, DeliveryEventType } from "../../config/constants";

export interface VerifyWebhookInput {
  rawBody: Buffer;
  headers: Record<string, string | string[] | undefined>;
  credential: string;
  /** Set only within the 24h post-rotation grace window — see
   * `decryptFeedbackCredentials`. */
  previousCredential?: string;
  /** SES only: the SNS topic this connection accepts messages from. */
  expectedTopicArn?: string | null;
}

export interface VerifyWebhookResult {
  valid: boolean;
  /** Verification couldn't complete for a transient reason (e.g. the SNS
   * signing certificate fetch failed) — answered with `503` so the
   * provider retries instead of dropping the event. */
  retryable?: boolean;
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
  /** SendLit's own `msg_...` outbound id, when the provider echoes back
   * metadata stamped at send time (e.g. an SES message tag) — the
   * strongest correlation tier, and the only one available for an event
   * that arrives before the send response is saved. */
  sendlitMessageId?: string | null;
}

/** What an adapter did with an authenticated control message (one that
 * carries no delivery event, e.g. an SNS subscription handshake). */
export type ControlMessageOutcome =
  | "subscription_confirmed"
  | "subscription_confirm_failed"
  | "unsubscribed";

/**
 * A reviewed adapter for one feedback-capable provider — see
 * `docs/bounces-and-complaints.md`'s provider-specific requirements. Only
 * providers with an adapter registered in `./registry.ts` are presented as
 * feedback-capable anywhere in the API (Non-goals: "A provider must have a
 * reviewed adapter before SendLit presents it as feedback-capable").
 */
export interface ProviderAdapter {
  provider: string;
  /** The provider authenticates without a customer-supplied secret (SES:
   * Amazon-signed SNS messages), so the connection is armed by
   * `expectedTopicArn` instead of `encryptedCredentials`. */
  credentialless?: boolean;
  /** Tighter per-provider cap than the route's global body limit. */
  maxBodyBytes?: number;
  /** Must run against the *raw* bytes, before any JSON parsing — signature
   * schemes are defined over the exact wire payload. */
  verify(input: VerifyWebhookInput): VerifyWebhookResult | Promise<VerifyWebhookResult>;
  /** Runs only after `verify` succeeds. Returns `null` for an ordinary
   * event delivery; otherwise the request is a control message that has
   * already been acted on and must not be stored as a receipt. */
  handleControl?(rawBody: Buffer): Promise<ControlMessageOutcome | null>;
  /** Applied to the verified body before it is persisted, e.g. to drop
   * fields SendLit never needs (SES `mail.headers`). */
  redactForStorage?(rawBody: Buffer): Buffer;
  /** Whether the raw payload is worth keeping once the receipt has been
   * processed. High-volume, low-value events (SES `Delivery`) return
   * `false` so only their canonical event row survives. Defaults to
   * keeping it until the regular retention purge. */
  retainPayloadAfterProcessing?(rawBody: Buffer): boolean;
  /** Minimal envelope check — throws to reject the receipt with `400`
   * before it's ever stored. Does not fully normalize. */
  validateEnvelope(rawBody: Buffer): void;
  /** Full normalization, called later/asynchronously by the worker.
   * Unsupported-but-valid event types map to `eventType: "unknown"`
   * rather than throwing — an adapter must tolerate additive fields. */
  normalize(rawBody: Buffer): NormalizedCanonicalEvent[];
}

/** An adapter whose verification needs no I/O (a shared-secret or HMAC
 * check), so callers holding the concrete adapter get a plain result. */
export interface SyncProviderAdapter extends ProviderAdapter {
  verify(input: VerifyWebhookInput): VerifyWebhookResult;
}
