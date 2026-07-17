# PRD: Amazon SES Bounce and Complaint Feedback

_Status: proposed for review. Date: 2026-07-17. Owners: SendLit API and Web.
Scope: an Amazon SES feedback adapter delivered over the existing
SES → SNS → HTTPS-webhook path, its SNS subscription-confirmation and
signature-verification requirements, and the minimal interface and UI changes
needed to add it as a third feedback-capable provider._

## Relationship to the base PRD

This document is a **delta** on
[bounces-and-complaints.md](./bounces-and-complaints.md) (henceforth "the base
PRD"), which is implemented. It does not restate the outbound-message ledger,
durable receipt inbox, correlation, delivery-state projection, suppression
model, retention, or REST/MCP surface. Those are provider-agnostic and are
reused unchanged. This PRD adds one reviewed provider adapter and the small
amount of ingestion-layer and UX machinery that Amazon SES specifically
requires and that Postmark/Resend did not.

Read the base PRD's "Provider support matrix" row for Amazon SES and its
"Provider-specific requirements → Amazon SES/SNS" section first; this PRD
elaborates them into an implementable design.

## Executive summary

Amazon SES is already a selectable ESP for SMTP sending (`provider = "ses"` in
`esp_configs`), but it is **not** in `feedbackCapableProviders`, so a
customer's SES ESP shows no delivery-feedback setup. SES therefore silently
loses the asynchronous bounce/complaint signal that the base PRD exists to
capture, and suppression never protects an SES-sending workspace.

Unlike Postmark and Resend — which POST a signed webhook straight to SendLit —
SES does not emit webhooks. It publishes Bounce, Complaint, and Delivery
notifications to an **Amazon SNS topic**, and SNS delivers them to an HTTPS
subscription. That difference introduces three things the two existing adapters
never needed:

1. A distinct **`SubscriptionConfirmation`** message type that must be
   confirmed before any notification will ever arrive, plus its
   `UnsubscribeConfirmation` counterpart.
2. A fundamentally different **authentication model**: SNS signs every message
   with its own private key. SendLit verifies against an X.509 certificate
   fetched from a `SigningCertURL` on the message — there is no shared secret
   or customer-supplied HMAC key.
3. **Outbound network I/O during verification** (fetching and caching the SNS
   signing certificate), which demands strict SSRF protection because the URL,
   though signed-adjacent, originates in an untrusted request body.

We keep the direct SES → SNS → HTTPS path (not SES → SNS → SQS) because the
buffering/retry/isolation that an SQS queue would add is **already provided by
the base PRD's durable-receipt-inbox-before-ack pattern**, and because a direct
HTTPS subscription keeps customer onboarding to a single "subscribe this URL"
step instead of cross-account SQS/IAM provisioning against each tenant's own
SES account. See "Rejected alternatives".

## Problem

- A workspace that sends through SES gets no bounce or complaint feedback, so a
  hard-bounced or complaining address is never suppressed and keeps receiving
  mail — the exact failure the base PRD was built to prevent, left open for one
  of the most common ESPs.
- SES is explicitly listed in the base PRD's support matrix as a target
  provider; its absence from `feedbackCapableProviders` is a known, documented
  gap ("SES/SendGrid/Mailgun … do not yet have a feedback adapter"), not a
  decision that SES feedback is out of scope.
- The existing adapter contract (`ProviderAdapter.verify`) assumes a
  synchronous, shared-secret/HMAC check over raw bytes. SES cannot satisfy that
  contract as written, so adding it is not "one more adapter function" — it
  requires a reviewed, minimal extension of the ingestion interface.

## Goals

1. Add a reviewed `ses` adapter and register it so an SES ESP presents delivery
   feedback exactly like Postmark/Resend do, reusing the entire downstream
   pipeline.
2. Correctly handle the SNS `SubscriptionConfirmation` handshake so a
   customer's subscription becomes active, and record that the connection is
   confirmed.
3. Authenticate every SNS message by verifying its signature against a
   validated Amazon SNS certificate and by requiring the configured
   `TopicArn`, before it can create a receipt, event, or suppression.
4. Fetch the SNS signing certificate (and any confirmation URL) through an
   SSRF-hardened client with a strict AWS-host allowlist, TLS validation,
   redirect refusal, and short timeouts.
5. Parse both single- and multi-recipient SES notifications into the existing
   canonical event shape, mapping permanent/transient bounces, complaints, and
   deliveries per the base PRD's semantics.
6. Extend the feedback UI so an SES connection is set up with its SNS
   `TopicArn` and shows subscription/health state, rather than a "paste a
   secret" field.
7. Keep tenant isolation, idempotency, retention, and audit guarantees
   identical to the base PRD.

## Non-goals

- SES → SNS → SQS ingestion, cross-account IAM, or any pull-based transport
  (see "Rejected alternatives"). May be revisited if SendLit becomes
  AWS-native.
- Automatic SES/SNS resource provisioning (creating the topic, the
  subscription, the configuration set, or identity notification settings) on
  the customer's behalf. v1 documents manual setup, consistent with the base
  PRD's "manual setup is the reliable common denominator" stance.
- `DeliveryDelay` handling beyond mapping it to the existing `delayed` event
  when a customer has enabled event publishing; no new delay-specific behavior.
- SES event publishing via EventBridge/Kinesis Firehose destinations. v1
  supports the SNS destination only.
- SNS message delivery-status logging, raw-message-delivery mode (v1 expects
  the default JSON envelope), or FIFO topics.
- SendGrid and Mailgun adapters (separate future work).
- Changing send-time behavior for SES beyond what the shared outbound ledger
  already does.

## Reused without change (from the base PRD)

The following require no new work and must not be re-implemented:

- The public route `POST /webhooks/esp/:provider/:connectionId`, its raw-body
  handling, 10 MiB limit, and mount order ahead of body parsing and auth.
- The durable receipt inbox (`esp_webhook_receipts`), enqueue-after-commit,
  BullMQ `esp-feedback` worker, and recovery poller.
- `esp_feedback_connections`, including the already-present
  `expected_topic_arn` column and the `scope`/`status`/rotation columns.
- Correlation (`correlateOutboundMessage`), delivery-state projection, the
  canonical `email_delivery_events` table and its
  `(connectionId, providerEventKey)` idempotency index.
- The suppression model, enforcement across every send path, retention loops,
  and the REST/MCP/OpenAPI feedback surface.
- The adapter registry and its startup assertion that every
  `feedbackCapableProvider` has a registered adapter.

The SES adapter plugs into this by emitting the same
`NormalizedCanonicalEvent[]`; everything after normalization is unchanged.

## Provider model: SES over SNS

### Message types

An HTTPS subscription receives POSTs whose JSON body has a top-level `Type`:

- `SubscriptionConfirmation` — sent once when the subscription is created (and
  again if re-subscribed). Contains a `SubscribeURL` and `Token`. Until it is
  confirmed, **no notifications are delivered**. Must be authenticated (signed)
  like any other SNS message before acting on it.
- `Notification` — the actual Bounce/Complaint/Delivery payload. Its `Message`
  field is a JSON string containing the SES notification.
- `UnsubscribeConfirmation` — sent if the subscription is removed. Treated as a
  connection-lifecycle signal; SendLit records it and does not auto-resubscribe.

The base route currently assumes every request is a notification to verify →
store → process. SES needs the route to branch on `Type` for control messages.

### Authentication

Every SNS message body carries `SignatureVersion`, `Signature`,
`SigningCertURL`, and the signed fields. Verification:

1. Require `SignatureVersion` `1` or `2`; prefer `2` (SHA-256). Reject others.
2. Validate `SigningCertURL`: `https` scheme, host matching
   `sns.<region>.amazonaws.com` (and the AWS partition equivalents,
   e.g. `.amazonaws.com.cn`), default port, no credentials, no redirects.
3. Fetch the certificate through the SSRF-hardened client; cache it by URL
   (Amazon rotates infrequently; cache with a bounded TTL and size).
4. Verify the certificate is issued for Amazon SNS and chains to a trusted
   root.
5. Rebuild the canonical string-to-sign from the documented signed fields for
   the message `Type` and verify `Signature` against the certificate's public
   key.
6. Require the message `TopicArn` to equal the connection's configured
   `expected_topic_arn`. A mismatch is rejected exactly like a bad signature
   (no information leak).

There is **no customer-entered secret** for SES. The connection's "credential"
is the pairing of Amazon's verified certificate and the expected `TopicArn`.
`encrypted_credentials` stays null for SES connections; the credential-rotation
grace-window machinery is inert for them.

### Subscription confirmation

On an authenticated `SubscriptionConfirmation` whose `TopicArn` matches:

- Confirm the subscription. Preferred path where practical is the AWS API
  (`ConfirmSubscription` with the `Token`) using SendLit-held credentials;
  otherwise a GET of `SubscribeURL` **through the same SSRF-hardened client and
  host allowlist**. An unauthenticated or ARN-mismatched confirmation is
  ignored and never fetched.
- Move the connection `status` `pending → healthy` is **not** implied by
  confirmation alone; confirmation records a distinct "subscription confirmed"
  fact (reuse `last_verified_at` / a new `subscription_confirmed_at`) and the
  base PRD's definition of `healthy` (a fully processed authenticated receipt)
  continues to govern the health badge.
- Do not create a delivery receipt or canonical event for a control message.
  Acknowledge with `200` after the confirmation attempt is durably recorded.

### Notification parsing and mapping

`Notification.Message` is parsed (it is a JSON string). SES notification
`notificationType`:

- `Bounce`: `bounceType = Permanent` → `hard_bounce` (`bounceClass:
"permanent"`). `bounceType = Transient` → `soft_bounce` (`transient`);
  because SES only emits a transient bounce after it has itself stopped
  retrying, this is treated as a **final** soft bounce and feeds the base PRD's
  repeated-soft-bounce threshold. `bounceType = Undetermined` →
  `soft_bounce` (`undetermined`). Each `bouncedRecipients[]` entry becomes its
  own canonical event; `diagnosticCode`, `status` (enhanced code), and
  `action` are preserved on the event.
- `Complaint`: each `complainedRecipients[]` entry → `complaint`. SES may
  redact the recipient; when absent, correlate through the SES message ID and
  suppress only if a recipient is recoverable (base PRD rule: never guess).
- `Delivery`: each `recipients[]` entry → `delivered`.
- `DeliveryDelay` (only if the customer publishes it): → `delayed`.
- Unknown `notificationType` → `unknown` (stored, acked, no suppression),
  per the base PRD's additive-tolerance rule.

**Idempotency key.** SES notifications carry `mail.messageId` and each
notification has an SNS `MessageId`. The canonical `providerEventKey` is
composed as `<notificationType>:<SNS MessageId>:<recipient>` so that a
multi-recipient notification yields one stable key per recipient and an SNS
redelivery of the same `MessageId` collides on the existing
`(connectionId, providerEventKey)` unique index. `providerMessageId` is
`mail.messageId` for correlation to the outbound ledger.

**Receipt-level dedup.** The SNS `MessageId` is stored as the receipt's
`providerRequestId`, so an at-least-once SNS redelivery is caught at the
receipt layer before reprocessing, exactly like Resend's `svix-id`.

## Interface changes (minimal, reviewed)

These are the only changes to shared ingestion code. They are additive and
default to today's behavior for Postmark/Resend.

### 1. `verify` becomes async-capable

`ProviderAdapter.verify` returns `VerifyWebhookResult | Promise<VerifyWebhookResult>`;
the route already runs in an async handler and simply `await`s it. Postmark and
Resend return synchronously as before. SES awaits the certificate fetch/cache.

`VerifyWebhookInput` gains optional fields the SES adapter needs and the others
ignore: `expectedTopicArn?: string | null`. The `credential`/`previousCredential`
fields remain and are simply empty for SES.

### 2. A request-classification hook for control messages

`ProviderAdapter` gains an optional:

```ts
classifyRequest?(rawBody: Buffer, headers): "notification" | "control";
handleControl?(input): Promise<{ ack: boolean }>; // confirm subscription, etc.
```

Default (absent) means "always a notification", preserving current behavior.
The route, after authenticating, calls `classifyRequest`; a `control` result
routes to `handleControl` (which performs the SSRF-guarded confirmation) and
acks without storing a receipt. Only `notification` requests proceed to
`validateEnvelope` → `createWebhookReceipt` → enqueue.

Verification still happens **before** classification and before any side
effect, so an unauthenticated control message can never confirm a subscription
(base PRD security rule: "An invalid webhook can never … confirm an SNS
subscription").

### 3. SSRF-hardened fetch utility

A new internal helper (e.g. `delivery-feedback/adapters/ses-fetch.ts`) used for
both `SigningCertURL` and `SubscribeURL`:

- Allowlist AWS SNS hosts by exact regex per partition; reject everything else.
- `https` only, default port, reject userinfo, reject non-2xx.
- Refuse redirects (`redirect: "error"`).
- Resolve and pin to the connection; short connect/read timeouts; bounded
  response size.
- No proxy env inheritance.

Certificate results are cached (URL-keyed, TTL + max entries) so steady-state
notification verification does no network I/O.

### 4. Registry + constants

- Add `ses` to `feedbackCapableProviders`.
- Register `sesAdapter` in the adapter registry (the startup assertion then
  guarantees coverage).
- No new `DeliveryEventType`/`BounceClass`/`SuppressionReason` values are
  required; SES maps entirely onto the existing enums.

### 5. Schema

The existing `expected_topic_arn` column already covers the required config.
One optional additive column, `subscription_confirmed_at timestamptz null`, is
proposed to record the handshake distinctly from health. No other schema
change; no destructive migration.

## Correlation and SES-side setup guidance

- Primary correlation is `mail.messageId` → the outbound ledger's stored
  provider message id, matching how SES bounces reference the original send.
- Setup instructions (shown in the UI and README) must tell the customer to:
    - Create/choose an SNS topic in the **same region** as their SES identity and
      subscribe SendLit's connection URL to it (HTTPS).
    - Attach the topic to their SES identity's Bounce and Complaint notifications
      (and Delivery if desired), **or** to a configuration set's event
      destination — but warn against enabling **both** the identity feedback path
      and an overlapping configuration-set destination for the same events
      without relying on idempotency, per the base PRD.
    - Disable inclusion of the original message/headers where optional, matching
      the base PRD's data-minimization requirement.
    - Keep the topic `TopicArn` handy; it is entered into SendLit to arm
      `expected_topic_arn`.

## Web UI

The feedback dialog (`esp-feedback-dialog.tsx`) becomes provider-aware:

- For `ses`, replace the "webhook secret" field with a **`TopicArn`** input
  (required to arm the connection) and show the subscription state:
  `awaiting subscription confirmation` → `subscription confirmed` → the normal
  health badges once a real notification processes.
- Show the same per-connection webhook URL (customers paste it as the SNS HTTPS
  subscription endpoint) and copy button.
- Setup copy is SES-specific: SNS topic + identity/config-set instructions,
  not "paste a signing secret".
- The "Test" affordance for SES sends no synthetic signed SNS message (we
  cannot forge a valid Amazon signature); instead it surfaces subscription and
  last-received state and links to SES's own test tools (e.g. the SES mailbox
  simulator addresses) as the supported way to generate a real bounce/complaint.

The ESP list's existing provider gate (`feedbackCapableProviders.includes`)
automatically starts showing the delivery-feedback action on SES rows once
`ses` is added to the list — no table change needed.

## Security requirements (SES-specific, in addition to the base PRD)

- Signature verification uses the raw bytes and a maintained crypto path;
  reject `SignatureVersion` values outside {1,2}.
- The certificate URL and any confirmation URL are validated against the AWS
  host allowlist **before** any network call; SSRF protections are mandatory
  and unit-tested against hostile URLs (IP-literal hosts, alternate ports,
  redirect-to-internal, `SubscribeURL` pointing off-Amazon, DNS-rebinding
  shapes).
- `TopicArn` mismatch, signature failure, and unconfirmable subscriptions are
  all rejected without leaking which check failed, and are rate-limited and
  counted like other signature failures.
- No SES-held long-lived customer AWS credentials are stored for the webhook
  path; if the AWS-API confirmation path is used, it uses SendLit's own
  narrowly-scoped credentials, not the customer's.
- Logs contain only connection id, provider, region, SNS `MessageId`, and error
  code — never the certificate, signature, diagnostic bodies, or recipient
  addresses.

## Testing strategy

- **Adapter unit tests** with captured (sanitized) SES notification fixtures:
  permanent bounce, transient bounce, undetermined, multi-recipient bounce,
  complaint (with and without recipient), delivery, delivery-delay, and an
  unknown type. Assert the exact canonical events and idempotency keys.
- **Signature verification tests** using a locally generated CA/cert to sign
  valid and tampered messages; assert accept/reject and that tampering any
  signed field fails.
- **SSRF tests** for `ses-fetch`: table of hostile URLs must all be refused;
  only exact AWS SNS hosts pass.
- **Subscription-confirmation tests**: authenticated confirmation triggers
  exactly one confirmation attempt and records the fact; unauthenticated or
  ARN-mismatched confirmation performs no fetch and stores nothing.
- **Route/integration tests** through the real receipt inbox: a valid
  `Notification` produces one receipt, one (or N for multi-recipient) canonical
  events, correct suppression side effects, and `processed` status; an SNS
  redelivery of the same `MessageId` produces no second receipt.
- **Idempotency/multi-recipient**: one notification with three recipients →
  three events, three suppression evaluations, one receipt.
- Reuse the base PRD's suppression-enforcement and projection tests unchanged
  (SES events flow through the same code).

Load/chaos and live-AWS end-to-end (a real SES identity + SNS topic firing at a
deployed URL) are validation steps for a staging environment, not unit-testable
here; the mailbox simulator is the recommended live generator.

## Rollout / phasing

1. Interface changes (async `verify`, `classifyRequest`/`handleControl`,
   `ses-fetch`) with Postmark/Resend behavior unchanged and green.
2. `ses` adapter + registry/constants + optional `subscription_confirmed_at`
   migration.
3. Web UI provider-awareness for SES setup.
4. README/OpenAPI/MCP doc updates (the MCP/REST surface itself is unchanged;
   only provider-capability docs and setup guidance change).
5. Staging validation against a real SES identity via the mailbox simulator.

Each phase keeps the suite, typecheck, build, and lint green, matching the base
PRD's delivery discipline.

## Rejected alternatives

### SES → SNS → SQS → worker (pull-based)

A robust AWS-native pattern (buffering, DLQ, isolation). Rejected for v1
because:

- The buffering/retryability/isolation it provides is **already delivered** by
  the durable-receipt-inbox-before-ack design; adding SQS duplicates it at the
  transport layer.
- SendLit is multi-tenant with **customer-owned** SES accounts. SQS ingestion
  requires per-tenant cross-account IAM (customer-owned queue polled by SendLit,
  or customer SNS publishing cross-account into a SendLit queue) — significant
  onboarding and credential-management burden versus "subscribe this HTTPS URL".
- It introduces a second, divergent ingestion path alongside the HTTP webhook
  route that Postmark/Resend use, for no functional gain at current scale.

It remains the better long-term choice **if** SendLit standardizes on
AWS-native, customer-cross-account infrastructure; this PRD keeps the canonical
event boundary compatible so a future SQS consumer could feed the same
pipeline.

### Customer-supplied shared secret for SES

Not offered by the SES→SNS model; SNS signs with its own key. Verifying
Amazon's signature is the only sound authentication and is required regardless.

## Open questions

- Confirmation path: prefer AWS-API `ConfirmSubscription` (needs SendLit AWS
  credentials + region derivation from `TopicArn`) versus SSRF-guarded
  `SubscribeURL` GET (no credentials, but a body-supplied URL). Proposed: try
  the guarded `SubscribeURL` GET by default since it needs no SendLit AWS
  account, with the API path as an opt-in hardening later.
- Whether to persist SES `region` explicitly on the connection or always derive
  it from `TopicArn`. Proposed: derive from `TopicArn` to avoid a redundant,
  possibly-inconsistent field.
- Whether `DeliveryDelay` should be surfaced in the UI timeline in v1 or simply
  recorded. Proposed: record only.
