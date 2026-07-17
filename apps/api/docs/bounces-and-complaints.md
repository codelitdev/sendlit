# PRD: Bounce and Complaint Processing

_Status: proposed for review. Date: 2026-07-16. Owners: SendLit API and Web.
Scope: outbound-message correlation, authenticated ESP feedback ingestion,
delivery events, suppression, reporting, and provider setup UX._

## Executive summary

SendLit is an email orchestration platform, not an email service provider
(ESP). Customers connect an ESP such as Amazon SES, SendGrid, Mailgun,
Postmark, or Resend, and that provider performs the actual delivery.

That boundary does not remove SendLit's need to process delivery feedback. A
successful SMTP or API submission only means the ESP accepted the message. A
bounce, delivery delay, final delivery, or spam complaint can occur minutes or
days later and is known first by the ESP. Provider webhooks are the standard
way to return those asynchronous events to the application that owns the
contact list and future sending decisions.

This PRD adds a provider-adapter layer around a stable SendLit webhook route
with a distinct URL per feedback connection, a durable PostgreSQL inbox,
asynchronous normalization through the existing BullMQ infrastructure, a
common outbound-message ledger, and a per-workspace suppression list. It
intentionally does not add Kafka, a separate ingestion service, or a
general-purpose event platform. That design is production-safe at SendLit's
current scale and can be partitioned or extracted later without changing the
public interface.

The primary outcome is simple: after an address hard-bounces or complains,
SendLit must stop future sends to that address even if the contact is deleted,
reimported, added to another sequence, or used through the transactional API.

## Problem

SendLit currently has three partial views of delivery:

- Campaign opens and clicks are stored in `email_events`; the schema has
  bounce-shaped fields but no ingestion path that populates them.
- Transactional email catches a synchronous SMTP `5xx` response, marks the
  message `bounced`, and avoids retrying it.
- `sendMail` treats an accepted SMTP submission as sent, does not persist the
  returned provider/RFC message identifier, and receives no later feedback.

This is insufficient for an email-marketing product:

- Many permanent failures happen after the ESP accepted the message.
- Spam complaints are necessarily asynchronous.
- A temporary failure and a final bounce have materially different meanings.
- The provider's suppression list does not protect SendLit if a customer
  changes providers, deletes and recreates configuration, or imports the
  address again.
- Delivery logs and dashboard rates cannot be accurate without provider
  events.
- Repeatedly sending to known-invalid or complaining recipients damages the
  customer's reputation and can cause the ESP to pause their account.

## Relationship to multiple ESPs and delivery routes

The implemented [multiple-ESP architecture](./multiple-esp.md) is a
prerequisite and source of truth for routing:

- `esp_configs` is a team-scoped collection of user-managed ESPs identified by
  public `espId`; it is not a team singleton.
- A custom send is pinned to one team-owned `outboxId` before it is queued or
  activated. Feedback must remain associated with that exact ESP, not whichever
  ESP is currently the team's default.
- `deliveryRoute = "custom"` uses the pinned user ESP and does not consume
  SendLit platform quota.
- `deliveryRoute = "platform"` is reserved for a future deployment-managed
  transport. It has no `esp_configs` row, vendor, or credentials in team data
  and is not currently available to clients.
- Suppression is workspace-wide and route-independent. A hard bounce or
  complaint received through one ESP must protect the address if the workspace
  later sends through another custom ESP or the future platform route.

This PRD must not restore the old singleton assumption, resolve feedback using
the current default ESP, expose the platform transport through ESP CRUD, or
charge platform quota for user-managed delivery.

## Product decision

SendLit will expose one provider-specific feedback endpoint per active
user-managed ESP feedback connection and show the exact URL and setup
instructions on that ESP's settings/detail surface:

```text
https://<api-origin>/webhooks/esp/<provider>/<connection-id>
```

`connection-id` is an opaque, high-entropy public identifier such as
`whc_...`. For a custom route it selects the team-owned ESP and provider adapter
but is not a secret. Authentication is performed using the provider's
signature mechanism or, for providers without signed webhooks, a separately
stored credential.

The customer configures the distinct URL for each feedback-capable user ESP.
Two ESP configurations using the same provider still have different connection
IDs, credentials, health, and event namespaces. Changing which ESP is the team
default has no effect on either connection. Automatic provider-side setup may
be added later where an appropriate provider API is available, but manual setup
is the reliable common denominator and is the v1 requirement.

When platform delivery is introduced, its feedback connection is
deployment-managed and absent from team ESP APIs. A platform receipt does not
select a workspace from the URL; the processor derives the team only by
correlating an authenticated provider event to a platform-routed outbound
message.

## Goals

1. Receive bounce, complaint, delivery, delay, rejection, and suppression
   feedback from every explicitly supported ESP.
2. Authenticate provider requests before they can affect delivery state or
   suppress a recipient.
3. Acknowledge a webhook only after it is durably stored, then process it
   asynchronously and idempotently.
4. Correlate every provider event to one SendLit outbound message, workspace,
   source, and recipient whenever the provider supplies enough information.
5. Maintain an immutable event history and a separate current-state
   projection so retries and out-of-order events cannot corrupt status.
6. Suppress future sends after hard bounces and complaints, with a documented
   policy for repeated final soft bounces.
7. Apply suppression to campaign, sequence, and transactional sending and
   recheck immediately before transport.
8. Give workspace owners provider-specific setup, connection health,
   actionable delivery logs, suppression visibility, and reputation metrics.
9. Preserve tenant isolation, minimize retained personal data, and provide
   auditable administrative overrides.
10. Fit the existing Express, PostgreSQL/Drizzle, BullMQ/Redis, ts-rest, and
    OpenAPI architecture.

## Non-goals

- Becoming an ESP, operating an MTA, or enrolling SendLit itself in mailbox
  provider feedback loops.
- Parsing a generic SMTP return-path mailbox or RFC 3464 DSNs in v1. Generic
  SMTP connections retain synchronous SMTP feedback only until a later DSN
  ingestion feature is designed.
- Receiving replies or other inbound email.
- Replacing ESP-native suppression. SendLit suppression complements it.
- Open and click tracking redesign.
- Inferring whether a delivered message reached the inbox rather than spam.
  `delivered` means accepted by the recipient's mail server.
- Automatically correcting, deleting, or changing a contact's email address.
- A universal custom-provider payload mapper in v1. A provider must have a
  reviewed adapter before SendLit presents it as feedback-capable.
- Enabling the reserved platform delivery route. This PRD keeps its future
  feedback boundary compatible but does not expose or configure platform
  sending.
- A Kafka/event-streaming migration at current scale.

## Users and user stories

### Workspace owner

- As an owner, I can see the webhook URL and exact event selections required
  for each of my configured, feedback-capable user ESPs.
- I can enter or rotate the provider's webhook secret/public key without it
  ever being returned in plaintext.
- I can see whether feedback is not configured, awaiting its first event,
  healthy, stale, or failing.
- I can send a provider-supported test event and see that SendLit verified it.
- I can see why and when an address was suppressed.
- I can reactivate an address after an eligible hard/soft-bounce correction,
  with an explicit warning and audit record.
- I cannot casually reactivate a spam complaint.
- I can see bounce and complaint rates and receive warnings before reputation
  damage becomes severe.

### Operator/support engineer

- As an operator, I can find a webhook receipt by receipt ID, provider event
  ID, provider message ID, SendLit message ID, or workspace.
- I can see signature failures, duplicate deliveries, processing lag,
  unmatched events, retry attempts, and dead-lettered receipts without seeing
  secrets or full message content.
- I can safely replay normalization from an already authenticated receipt.
- I can perform a complaint override only through a privileged, audited
  process with a documented reason.

### Recipient

- After my address hard-bounces or I report a message as spam, I do not keep
  receiving subsequent SendLit-managed messages from that workspace.

## Success metrics

- At least 99.9% of authenticated receipts are normalized within five minutes.
- p95 webhook acknowledgement latency is below 500 ms under expected load.
- Duplicate provider deliveries produce exactly one normalized event and one
  suppression side effect.
- No accepted event can cross workspace boundaries.
- At least 95% of events from SendLit-originated messages correlate
  automatically; unmatched events are visible and never silently discarded.
- A new active suppression prevents the next eligible send within 60 seconds,
  and the transport worker always rechecks it immediately before submission.
- Secrets, authorization headers, full email bodies, and complaint report
  content never appear in application logs.
- Provider feedback setup can be completed without SendLit support by a user
  familiar with their ESP dashboard.

## Industry model and standards

The design follows the common pattern exposed by established providers:

```text
SendLit send request
    -> ESP accepts message and returns an identifier
    -> SendLit stores outbound correlation
    -> recipient server/provider produces an asynchronous event
    -> ESP POSTs an authenticated webhook
    -> SendLit durably records and acknowledges it
    -> background worker normalizes the event
    -> delivery projection, reporting, and suppression are updated
```

Provider payloads differ, but their operational requirements converge:

- Amazon SES publishes bounce, complaint, and delivery notifications through
  SNS; one notification may contain one or multiple recipients, and ordering
  is not guaranteed.
- SendGrid batches event objects, signs its event webhook, and retries
  non-`2xx` deliveries for up to 24 hours.
- Mailgun signs requests and retries most unsuccessful webhook deliveries over
  an eight-hour schedule.
- Postmark provides bounce and spam-complaint webhooks, retries non-successful
  requests, and supports HTTP authentication/custom headers rather than HMAC
  webhook signatures.
- Resend signs webhooks using Svix headers and supports automatic retries and
  manual replays.

RFC 3464 defines delivery-status notifications and distinguishes delayed,
delivered, and failed delivery with enhanced status codes. RFC 5965 defines
the Abuse Reporting Format used by feedback loops. SendLit will preserve
standard SMTP/enhanced status information when a provider supplies it, while
using provider webhooks rather than directly operating those protocols in v1.

## Provider support matrix

| Provider            | Feedback transport              | Required authentication                                                                                        | Primary correlation                                               | Required events                                                                                          |
| ------------------- | ------------------------------- | -------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Amazon SES          | HTTPS subscription to SNS topic | Validate SNS signature and certificate chain; require configured `TopicArn`; support subscription confirmation | SES `mail.messageId`, recipient, optional SendLit tag/header      | Bounce, Complaint, Delivery; DeliveryDelay when using event publishing                                   |
| SendGrid            | Event Webhook                   | Signed Event Webhook verification using configured public key; OAuth may be supported later                    | `sg_event_id`, `sg_message_id`, recipient, opaque custom argument | delivered, deferred, bounce, dropped, spamreport                                                         |
| Mailgun             | Webhook                         | HMAC-SHA256 over timestamp and token using signing key; timestamp window and token replay check                | event `id`, message ID, recipient, opaque variables               | delivered, temporary/permanent failed, complained                                                        |
| Postmark            | Webhook                         | Random custom header or HTTP Basic credential; optional IP allowlist as defense in depth                       | event `ID`/`MessageID`, recipient, metadata                       | Delivery, Bounce, SpamComplaint                                                                          |
| Resend              | Webhook                         | Verify raw body and `svix-id`, `svix-timestamp`, `svix-signature` using endpoint signing secret                | `svix-id`, `data.email_id`, `message_id`, recipient               | email.delivered, email.delivery_delayed, email.bounced, email.failed, email.complained, email.suppressed |
| Generic/custom SMTP | SMTP response only in v1        | Existing SMTP authentication                                                                                   | RFC `Message-ID` and SMTP response                                | Synchronous accepted/rejected only; UI must state that asynchronous feedback is unavailable              |

Provider adapters must tolerate additive, unknown payload fields. A newly
observed provider event type is stored as `unknown` and acknowledged after
authentication; it must not fail the entire receipt or mutate suppression.

## Functional requirements

### 1. Outbound-message ledger

Every submitted recipient must have one common outbound record, regardless of
whether it originated from a broadcast, sequence, or transactional API call.
The record must exist before transport submission and be updated with the
transport result.

SendLit currently sends one recipient per transport call. That invariant must
remain for v1 because it makes redacted complaints safely correlatable. Any
future batch-recipient transport must create one outbound row per recipient
and prove recipient-level correlation before release.

Conceptual table:

```text
outbound_messages
  id                       uuid primary key
  message_id               text unique, public msg_ identifier
  team_id                  uuid not null -> teams on delete cascade
  delivery_route           custom | platform
  esp_config_id            uuid nullable -> esp_configs on delete set null
  feedback_connection_id   uuid nullable -> feedback connection on delete set null
  source_type              campaign | transactional
  campaign_delivery_id     uuid nullable -> email_deliveries on delete set null
  transactional_email_id   uuid nullable -> transactional_emails on delete set null
  recipient_email          text not null
  normalized_recipient     text not null
  provider                 text nullable
  rfc_message_id           text nullable
  provider_message_id      text nullable
  delivery_status          queued | accepted | delayed | delivered | bounced | failed
  feedback_status          none | complained
  accepted_at              timestamptz nullable
  delivered_at             timestamptz nullable
  bounced_at               timestamptz nullable
  complained_at            timestamptz nullable
  last_event_at            timestamptz nullable
  created_at/updated_at    timestamptz
```

Constraints and indexes:

- Exactly one source FK is populated.
- `custom` requires the source sequence/transactional row and outbound record
  to reference the same pinned, team-owned ESP. `provider` snapshots that user
  ESP's provider for historical display/correlation.
- `platform` requires a null `esp_config_id` and null provider snapshot on this
  team-owned record. The future deployment adapter may attach an internal
  `feedback_connection_id` for correlation without persisting platform vendor
  or credentials in team ESP data.
- Unique `message_id` with the repository's public-ID check convention.
- Index `(team_id, created_at desc)` for activity pages.
- Index `(feedback_connection_id, provider_message_id)` where both values are
  not null; custom connections also remain scoped to their ESP configuration.
- Index `(team_id, normalized_recipient, created_at desc)` for recipient
  history and suppression investigations.
- Provider IDs are not globally trusted to be unique; all lookups are scoped
  by connection/configuration and recipient where necessary.

The send adapter must:

1. Generate the `msg_...` identifier and an RFC `Message-ID` before sending.
   Each logical submission also has a stable `submission_key`; a worker retry
   reuses that outbound row and RFC `Message-ID` instead of creating a second
   provider-correlation identity.
2. Add only an opaque `msg_...` correlation value through provider-supported
   metadata/custom arguments. It must never add recipient PII to provider
   categories or custom arguments.
3. For a custom route, use only the source row's already-pinned `outboxId` and
   fail closed if it is missing; never resolve the current default as a worker
   fallback.
4. Persist the provider response identifier, accepted timestamp, delivery
   route, and matching feedback connection when configured.
5. Preserve custom-route provider history when the team changes its default,
   edits another ESP, or later deletes an eligible unused configuration.
6. Return a structured transport result instead of discarding Nodemailer's
   `SentMessageInfo`.

Creating delivery feedback does not alter route selection or quota behavior.
Custom/user-ESP sends continue to bypass SendLit quota checks and counters.
When platform delivery exists, only its successful sends consume platform
quota; bounce/complaint processing never increments or refunds those counters.

### 2. Feedback connection

Feedback security and health are lifecycle data, not extra fields mixed into
the SMTP password JSON. Add a separate feedback-connection resource:

```text
esp_feedback_connections
  id                       uuid primary key
  connection_id            text unique, public whc_ identifier
  scope                    custom | platform
  team_id                  uuid nullable -> teams on delete cascade
  esp_config_id            uuid nullable -> esp_configs on delete set null
  provider                 text not null
  encrypted_credentials    text nullable
  expected_topic_arn       text nullable                 # SES
  status                   pending | healthy | stale | error | retiring | disabled
  last_received_at         timestamptz nullable
  last_verified_at         timestamptz nullable
  last_error_code          text nullable
  disabled_at              timestamptz nullable
  created_at/updated_at    timestamptz
```

- A `custom` connection requires both `team_id` and `esp_config_id`; the ESP
  must belong to that team. There is at most one non-retiring connection per
  user ESP configuration.
- A `platform` connection requires null `team_id` and null `esp_config_id`, is
  deployment-managed, and is never returned or mutated through team ESP APIs.
- Secret material uses the existing AES-256-GCM secret utility and is never
  returned after creation.
- Rotation accepts the current and immediately previous credential for no
  longer than 24 hours so provider retries are not lost.
- Changing a user ESP's provider creates a new feedback connection and moves
  the old provider connection into a seven-day `retiring` grace state for
  delayed/retried events. Changing its name, sender identity, or default flag
  does not replace the connection.
- Deleting a user ESP remains subject to the implemented `esp_in_use` rules for
  active/paused sequences and queued transactional sends. Once deletion is
  allowed, its connection retires and retains `team_id` after `esp_config_id`
  becomes null. Historical terminal sends do not block deletion, and late
  authenticated events remain correlatable during the grace period.
- Promoting or deleting the default and automatically promoting another ESP
  has no effect on either ESP's feedback connection.
- Team deletion cascades team-owned connection data. Deleting/replacing an ESP
  must not erase historical normalized events or workspace suppressions.

### 3. Public webhook endpoint

```http
POST /webhooks/esp/:provider/:connectionId
```

This route is public in the sense that it does not use a SendLit user session
or API key. It is authenticated by the provider adapter. It is deliberately
outside the `/api` application namespace to make its machine-to-machine,
provider-authenticated boundary explicit; URL prefixes never substitute for
authentication.

The Express router is mounted before any `requireAuth`/`requireTeam` middleware
and before global JSON parsing. It has no cookie, CSRF, session, or API-key
requirement. Every request must instead pass the provider-specific verification
described in this PRD before it is persisted or acknowledged.

Request handling order is mandatory:

1. Resolve the opaque connection ID and ensure the route provider matches it.
   A custom connection establishes the team/ESP scope; a platform connection
   establishes only the deployment provider scope.
2. Read the unmodified raw request body with a route-scoped raw parser mounted
   before global `express.json()`/`express.urlencoded()` middleware.
3. Enforce a configurable maximum body size, initially 10 MiB.
4. Verify signature/credential, timestamp, expected account/topic, and replay
   protection as supported by that provider.
5. Perform minimal envelope validation; do not fully normalize inline.
6. Insert the authenticated raw receipt durably in PostgreSQL.
7. Return `200` only after the insert commits. Duplicate receipts also return
   `200`.
8. A background dispatcher processes pending receipts. Redis/BullMQ failure
   must not lose a committed receipt.

Responses:

| Condition                           | Response | Behavior                                |
| ----------------------------------- | -------- | --------------------------------------- |
| Valid receipt committed             | `200`    | Process asynchronously                  |
| Authenticated duplicate             | `200`    | No duplicate side effects               |
| Unknown/disabled connection         | `404`    | Generic response; no tenant details     |
| Invalid signature/credential/replay | `401`    | Security metric; sanitized log          |
| Malformed authenticated payload     | `400`    | Store no actionable event; metric       |
| Payload too large                   | `413`    | Alert if a known provider triggers this |
| Database unavailable                | `503`    | Provider retry must remain possible     |

The endpoint must not redirect. Production requires HTTPS/TLS 1.2 or newer.
Rate limiting is applied after cheap connection lookup and before expensive
work, with a high provider-appropriate burst allowance. Capacity overload
returns `503`, not a successful response. Edge controls must not reject valid
provider retries merely because a workspace user is navigating pages.

### 4. Durable receipt inbox

Authenticated HTTP requests are stored before acknowledgement:

```text
esp_webhook_receipts
  id                       uuid primary key
  receipt_id               text unique, public whr_ identifier
  connection_id            uuid not null -> feedback connection
  team_id                  uuid nullable -> teams on delete cascade
  provider                 text not null
  provider_request_id      text nullable
  body_sha256              text not null
  encrypted_payload        text nullable
  safe_headers             jsonb not null default {}
  status                   pending | processing | processed | partial | dead_letter
  processing_attempts      integer not null default 0
  next_attempt_at          timestamptz nullable
  last_error_code          text nullable
  received_at              timestamptz not null
  processed_at             timestamptz nullable
```

- `safe_headers` is an allowlist of non-secret identifiers/timestamps. It
  excludes authorization, cookies, signatures, and credentials.
- `team_id` is populated from a custom feedback connection. It is null for a
  platform receipt because one provider batch may contain messages belonging
  to multiple workspaces; teams are assigned only to individually correlated
  normalized events.
- Raw payloads are encrypted because they can contain recipient addresses,
  subjects, diagnostics, or complaint material. The value is required on
  receipt and becomes null only when the retention purge succeeds.
- Deduplicate by the provider request ID when it is stable. Otherwise use
  provider event IDs during normalization; `body_sha256` helps identify exact
  receipt retries but is not the only event idempotency key.
- A database poller must recover `pending` receipts if enqueueing to BullMQ
  fails after the HTTP request commits.
- A processing lease prevents two workers from processing the same receipt
  indefinitely; stale leases are recoverable.
- Retry normalization with exponential backoff for 24 hours. Schema bugs or
  unsupported payloads go to `dead_letter` with an alert and replay path.

### 5. Canonical delivery events

Each provider adapter converts a receipt into zero or more immutable events:

```text
email_delivery_events
  id                       uuid primary key
  event_id                 text unique, public evt_ identifier
  receipt_id               uuid not null -> webhook receipt
  connection_id            uuid not null -> feedback connection
  team_id                  uuid nullable -> teams on delete cascade
  outbound_message_id      uuid nullable -> outbound_messages on delete set null
  provider                 text not null
  provider_event_key       text not null
  provider_message_id      text nullable
  recipient_email          text nullable
  normalized_recipient     text nullable
  event_type               accepted | delivered | delayed | soft_bounce |
                           hard_bounce | failed | complaint | suppressed |
                           rejected | unknown
  bounce_class             permanent | transient | undetermined nullable
  smtp_code                integer nullable
  enhanced_status_code     text nullable
  reason                   text nullable
  remote_mta               text nullable
  occurred_at              timestamptz not null
  received_at              timestamptz not null
  metadata                 jsonb not null default {}
```

- Unique `(connection_id, provider_event_key)` guarantees event idempotency.
  If a single provider event contains multiple recipients, the derived key
  includes a stable recipient discriminator.
- Reason fields are length-limited and sanitized. Unknown provider fields are
  not copied wholesale into `metadata`.
- Adapter mappings are versioned in code and covered by stored provider
  fixtures. Reprocessing an old receipt uses the current mapping and must be
  deterministic.
- A valid but unsupported event is preserved as `unknown` and has no state or
  suppression side effects.
- Custom events inherit the connection's team even when message correlation is
  pending. Platform events receive `team_id` only from a matched
  `outbound_messages` row. An unmatched platform event remains operator-only
  with null team and can never create a workspace-visible event or suppression.

Canonical definitions:

- `accepted`: the provider accepted the submission; it is not proof of
  delivery.
- `delivered`: the receiving mail server accepted the message; it is not proof
  of inbox placement or reading.
- `delayed`: delivery is still being attempted. It is not a soft-bounce count.
- `soft_bounce`: the provider has stopped attempting this message but
  classifies the recipient failure as temporary.
- `hard_bounce`: final permanent recipient failure.
- `failed`/`rejected`: sending failed for a non-recipient or insufficiently
  classified reason; it suppresses only when the adapter explicitly maps it
  to a permanent recipient failure.
- `complaint`: the recipient/provider reported the message as spam.
- `suppressed`: the ESP refused submission because the address was already on
  its suppression list; SendLit mirrors the provider reason when available.

### 6. Correlation

Correlation priority:

1. Opaque SendLit `msg_...` provider metadata/custom argument.
2. Stored provider message ID scoped to the feedback connection.
3. Stored RFC `Message-ID` scoped to the connection and recipient.
4. Provider message ID plus normalized recipient and a bounded send-time
   window.

The payload never chooses its own workspace. For custom delivery,
`connectionId` resolves the team and exact user ESP, and all correlation
queries include that team/connection scope. For future platform delivery, the
deployment connection resolves no team; only a uniquely matched
`outbound_messages.team_id` may establish tenant ownership. Provider metadata
claiming a team or `espId` is ignored.

When a complaint omits or redacts the recipient, resolve it from the matched
outbound message. Because v1 sends one envelope recipient per message, this is
unambiguous. If it is not unambiguous, store the event as unmatched, alert,
and do not guess which address to suppress.

Unmatched events remain queryable and are retried for 24 hours because the
send-result transaction may commit slightly after a very fast provider event.
After that they remain `unmatched` for operator resolution and reporting. They
are never silently dropped or assigned across tenants.

### 7. Delivery-state projection

Immutable events and current state are separate. Events can be duplicated,
batched, delayed, and out of order.

`outbound_messages.delivery_status` follows these rules:

- `accepted` does not overwrite `delivered`, `bounced`, or `failed`.
- `delayed` does not overwrite `delivered`, `bounced`, or `failed`.
- `delivered` may follow `delayed` and becomes current delivery state.
- A later `hard_bounce`/final `soft_bounce` can follow `delivered` when the
  receiving system first accepted and later rejected the message; `bounced`
  becomes current while both events remain visible.
- An older event cannot regress a newer terminal projection merely because it
  was received later.
- `complaint` is independent `feedback_status = complained`, because a
  complaint normally follows delivery.

Updates use a database transaction and row-level/optimistic guard so two
workers cannot race the projection or suppression side effect.

### 8. Suppression model

Suppression is a dedicated per-workspace resource. It must not be represented
only by `contacts.subscribed` or by the latest message status.

```text
email_suppressions
  id                       uuid primary key
  suppression_id           text unique, public sup_ identifier
  team_id                  uuid not null -> teams on delete cascade
  recipient_email          text nullable
  normalized_recipient     text nullable
  recipient_hash           text not null
  hash_key_version         integer not null
  reason                   hard_bounce | complaint | repeated_soft_bounce |
                           provider_suppression | manual
  source_event_id          uuid nullable -> delivery event on delete set null
  active                   boolean not null default true
  first_suppressed_at      timestamptz not null
  last_suppressed_at       timestamptz not null
  released_at              timestamptz nullable
  released_by              uuid nullable
  release_reason           text nullable
  created_at/updated_at    timestamptz
```

Use one row per `(team_id, recipient_hash)`, enforced by a unique index.
Repeated events update `last_suppressed_at` and preserve the strongest reason:
`complaint`, `hard_bounce`, `provider_suppression`,
`repeated_soft_bounce`, then `manual`. Every add, reason change, and release
also creates an immutable audit action:

```text
email_suppression_actions
  id                       uuid primary key
  team_id                  uuid not null -> teams on delete cascade
  suppression_id           uuid not null -> email_suppressions
  source_event_id          uuid nullable -> delivery event on delete set null
  action                   created | reason_changed | released | reactivated
  actor_type               system | workspace_user | sendlit_operator
  actor_user_id            uuid nullable
  explanation              text nullable
  created_at               timestamptz not null
```

`recipient_hash` is HMAC-SHA256 over the normalized address using a dedicated,
versioned application key; it is not an unsalted SHA digest vulnerable to
dictionary lookup. Key rotation uses dual lookup/write until existing rows are
rewritten to the new version. The presented and normalized addresses can then
be removed for a valid privacy-erasure request while the minimum do-not-send
hash remains.

Suppression policy:

| Signal                                      | Message result                                           | Future sends                                                   |
| ------------------------------------------- | -------------------------------------------------------- | -------------------------------------------------------------- |
| Permanent/hard bounce                       | Mark that message bounced                                | Suppress immediately                                           |
| Spam complaint                              | Mark feedback complained                                 | Suppress immediately                                           |
| Provider says address is already suppressed | Preserve provider reason                                 | Suppress immediately when recipient-specific                   |
| Delivery delay/transient attempt            | Keep message delayed                                     | Do not suppress                                                |
| Final soft bounce                           | Mark that message bounced and increment recipient streak | Suppress after 3 consecutive final soft bounces within 30 days |
| Successful delivery                         | Mark delivered                                           | Reset final-soft-bounce streak                                 |
| Sender/configuration failure                | Mark failed                                              | Do not suppress recipient                                      |

“Consecutive” means distinct outbound messages. Duplicate events for one
message never increase the streak. The threshold is a SendLit product policy,
not a claim that every ESP classifies soft bounces identically.

Suppression applies by default to campaigns, sequences, broadcasts, and
transactional sends. A security or receipt email is not made deliverable by
repeatedly sending it to an invalid or complaining address; there is no
automatic “critical transactional” bypass in v1.

The suppression check occurs twice:

1. Before enqueue/audience expansion, to avoid unnecessary jobs.
2. In the mail worker immediately before transport, to close the race between
   scheduling and receipt of a complaint/bounce.

Suppressed campaign recipients are recorded as skipped with the reason and do
not count as sent or consume quota. A transactional create request returns a
stable non-delivery result (`422 recipient_suppressed`) and does not enqueue.
An already queued job that becomes suppressed exits idempotently as
`suppressed`, not `failed`.

Address normalization is `trim`, Unicode NFC, and lowercase for the full
addr-spec. SendLit must not remove dots, plus-tags, or otherwise apply
provider-specific alias rules. Store the presented address separately for UI,
and compute the suppression HMAC only after normalization.

### 9. Reactivation policy

- Workspace owners may release `hard_bounce`, `repeated_soft_bounce`, and
  `manual` suppressions only after an explicit confirmation that the address
  was corrected or reconfirmed. The release is audited.
- A new hard bounce re-suppresses immediately and cannot be hidden by an old
  release.
- Complaint suppressions cannot be released by a workspace owner in v1.
  Release requires a SendLit operator, documented renewed consent, and any
  provider-side reactivation required by the ESP. Some ESPs intentionally do
  not permit complaint reactivation.
- Releasing SendLit's suppression does not automatically remove an ESP-native
  suppression. The UI must state this clearly.
- Unsubscribe remains a separate consent state. Reactivating a bounce must
  never resubscribe a contact or override an unsubscribe.

### 10. Configuration and web UX

Each user-managed ESP detail/card under Account/ESP settings gains its own
**Delivery feedback** section, conditional on that ESP's provider. It is not a
team-global/default-ESP section.

It shows:

- The exact webhook URL with copy action.
- Required provider event names and provider-specific setup steps.
- Secret/public-key input or generation flow.
- A reminder that the URL is an identifier, not the credential.
- Connection status: `Not configured`, `Waiting for event`, `Healthy`,
  `Stale`, `Error`, or `Unsupported for generic SMTP`.
- Last authenticated event time and last sanitized error.
- Provider test instructions/action when supported.
- Secret rotation and disable actions.

Each `espId` has a distinct URL, credential, connection status, last event,
and test result, even when two configurations use the same provider. The UI
must identify the ESP by name and `espId` near the webhook URL so a user does
not configure it on the wrong provider account. Switching the team's default
ESP does not move, copy, or regenerate feedback configuration.

Changing provider on an existing ESP requires a destructive confirmation: the
old connection becomes `Retiring`, a new connection URL/credential is created
for the new provider, and both states are shown during the grace period.
Deleting an eligible ESP likewise shows that late events are accepted during
retirement. Generic/custom SMTP shows asynchronous feedback as unsupported.

The future platform route does not appear as an ESP item and exposes no
deployment webhook URL, vendor, secret, or health through workspace settings.
Workspace delivery activity may still show normalized platform-route outcomes
without revealing deployment credentials.

Health semantics:

- `pending`: configured but no authenticated event received.
- `healthy`: last authenticated receipt was processed successfully. Absence
  of events alone is not unhealthy when no mail was sent.
- `stale`: messages were accepted by this connection during a configurable
  seven-day window but no feedback/test event has ever been received, or a
  provider reports endpoint failure.
- `error`: recent authenticated receipts repeatedly failed processing or the
  saved credential is invalid during a test.
- `retiring`: no new sends use this connection, but authenticated delayed or
  retried events remain accepted through the seven-day grace period.
- `disabled`: the connection no longer accepts events after retirement or an
  explicit security disable.

Delivery activity adds filters for provider, source, delivery status,
feedback status, bounce class, and date. Detail views show the event timeline,
sanitized provider diagnostic, and suppression outcome.

Contacts show an independent `Suppressed` state with reason/time. The existing
subscribed/unsubscribed state remains separate. Deleting and reimporting a
contact with the same normalized address retains suppression.

The overview should show observed delivery, hard-bounce, soft-bounce, and
complaint counts/rates for 7 and 30 days, with a low-volume notice where a
percentage is statistically noisy.

### 11. Reputation guardrails

SendLit reports rates using its own documented denominator: authenticated
recipient events divided by messages accepted by the ESP in the same window.
The UI notes that an ESP's official account rate may differ because providers
use their own representative volumes and exclusions.

Default operational thresholds:

- Hard-bounce warning at 2%; critical at 5%.
- Complaint warning at 0.05%; critical at 0.1%; emergency at 0.3%.

These are conservative SendLit guardrails. Amazon SES recommends keeping hard
bounces below 5% and complaints below 0.1%; Gmail advises keeping user-reported
spam below 0.1% and avoiding 0.3% or higher.

For v1, thresholds generate in-product/operator alerts. Automatic workspace
pausing is a staged follow-up after enough production data exists to avoid
punishing low-volume senders. The future circuit breaker should pause
non-essential marketing, retain per-recipient suppression, require minimum
event counts, and be reversible with an audit trail.

## Provider-specific requirements

### Amazon SES/SNS

- Support `SubscriptionConfirmation` and `Notification` messages.
- Verify the SNS signature before following any confirmation action.
- Prefer AWS SDK validation and signature version 2 (SHA-256) where the topic
  owner can configure it.
- Require HTTPS certificate URLs, validate that the certificate is issued for
  Amazon SNS, validate the chain, and reject unexpected `TopicArn` values.
- Never blindly fetch `SigningCertURL` or `SubscribeURL`; enforce AWS host,
  scheme, port, DNS/IP, redirect, and timeout rules to prevent SSRF.
- Prefer confirming with the AWS API/token where practical. Any URL-based
  confirmation must pass the same strict allowlist.
- Parse both one-recipient and multi-recipient SES notifications.
- Permanent bounce suppresses. Transient bounce emitted after SES has stopped
  retrying is a final soft bounce. DeliveryDelay is `delayed`, not bounced.
- Complaints may redact recipient details; correlate through SES message ID.
- SES identity/topic setup instructions must warn against configuring both
  duplicate feedback mechanisms without relying on event idempotency.

### SendGrid

- Require Signed Event Webhook for GA; OAuth support is optional future work.
- Verify the signature against the exact raw body and timestamp header using
  Twilio's supported algorithm/library.
- Treat each object in the batch as an independent canonical event.
- Use `sg_event_id` as the base idempotency key and `sg_message_id` plus
  recipient for correlation.
- Map `bounce` to hard/soft based on status/reason classification, `deferred`
  to delayed, `dropped` to rejected/provider-suppressed as indicated, and
  `spamreport` to complaint.
- Do not store PII in SendGrid categories/unique arguments; only the opaque
  SendLit message ID is permitted.

### Mailgun

- Compute HMAC-SHA256 over `timestamp + token` with the signing key and compare
  in constant time.
- Reject timestamps outside a five-minute window and retain used tokens for
  24 hours to reject replay.
- Mailgun event IDs are documented as unique within a day; the canonical key
  must therefore include event date and relevant stable discriminator.
- Map `failed` with permanent severity to hard bounce/rejection according to
  recipient classification, temporary severity to delayed or final soft
  bounce according to delivery status, and `complained` to complaint.
- Returning success stops retries; non-success handling must account for
  Mailgun's event-specific retry behavior, including limited/no retries for
  some delivery notifications.

### Postmark

- Postmark does not currently provide HMAC signature verification for these
  webhooks. Require a high-entropy custom header or HTTP Basic credential and
  compare it in constant time. IP allowlisting is optional defense in depth,
  not the sole credential, because provider ranges can change.
- Prefer provider Webhooks API configuration with `HttpHeaders`/`HttpAuth`.
  Do not place secrets in query strings. If Basic credentials are embedded in
  a URL by a customer, ensure access/proxy logs redact userinfo.
- Enable Delivery, Bounce, and SpamComplaint; set `IncludeContent = false`.
- Use event `ID` when provided and compose a deterministic key with record
  type, message ID, recipient, and timestamp otherwise.
- Hard bounce suppresses; a spam complaint suppresses and is not owner-
  reactivatable. Other bounce types follow the adapter mapping table.
- Return `200` after durable persistence; Postmark retries other responses and
  stops retrying on `403`.

### Resend

- Verify the exact raw payload using the endpoint signing secret and
  `svix-id`, `svix-timestamp`, and `svix-signature` headers.
- Use the maintained Resend/Svix verifier rather than custom cryptography.
- Use `svix-id` as receipt replay/idempotency input and the event/email IDs for
  canonical events.
- Map `email.bounced` to hard bounce because Resend defines it as permanent
  rejection; map `email.delivery_delayed` to delayed,
  `email.complained` to complaint, and `email.suppressed` to provider
  suppression.
- Manual provider replays must remain idempotent.

## Security and abuse prevention

- Webhook payloads are untrusted even after authentication; validate them with
  strict, provider-specific Zod schemas that allow additive unknown fields.
- Signature verification always uses raw bytes and maintained provider/crypto
  libraries where available.
- All shared-secret comparisons are constant-time.
- Signature failures are rate-limited and counted, but logs contain only
  connection ID, provider, request correlation ID, and error code.
- Connection IDs contain at least 128 bits of entropy and never encode team or
  ESP IDs.
- Replay defenses use provider IDs plus timestamp windows where possible;
  idempotency remains required even with replay protection.
- Credentials are encrypted at rest, excluded from API reads, tracing,
  analytics, and error reporting, and rotatable.
- Provider IP allowlists are defense in depth only. Requests behind proxies use
  a correctly bounded trusted-proxy configuration before examining source IP.
- SNS URL fetching has strict SSRF protections and short connect/read timeouts.
- Payload/body limits, nesting limits, string limits, and maximum events per
  receipt prevent resource exhaustion.
- An invalid webhook can never create a suppression, change a message, or
  confirm an SNS subscription.
- Development-only unsigned fixture ingestion, if implemented, must require an
  explicit flag that the production startup check rejects.
- Provider diagnostics are escaped in the web UI and never rendered as HTML.
- Audit records are append-only for application roles.

## Privacy, retention, and deletion

- Do not request or store full complaint content or original message bodies.
  Provider configuration must disable optional content inclusion.
- Raw encrypted webhook receipts are retained for 30 days, then their payload
  and safe headers are deleted while receipt metadata/aggregate status remains.
- Normalized delivery events are retained for 13 months to support annual
  deliverability comparisons; aggregate, non-recipient metrics may remain
  longer.
- Active suppression remains until released or the workspace is deleted.
  Release audit is retained for 24 months.
- User-facing APIs never expose raw provider payloads.
- Team deletion cascades recipient-level records and encrypted receipts.
- A recipient privacy deletion anonymizes the outbound/event email after the
  legal/product retention decision, but must not accidentally reactivate a
  still-required suppression. It removes the presented/normalized address
  while retaining only the versioned HMAC needed to honor the do-not-send
  state. The implementation needs one documented deletion transaction
  covering contacts, outbound messages, events, and suppressions.
- Logs and analytics use public resource IDs rather than recipient addresses.

## Reliability, scale, and performance

Initial architecture:

```text
Express raw webhook route
    -> PostgreSQL esp_webhook_receipts (durable inbox)
    -> BullMQ feedback queue / pending-receipt poller
    -> provider adapter
    -> email_delivery_events
    -> outbound_messages projection
    -> email_suppressions + audit
```

This is appropriate for small and medium providers because PostgreSQL is
already the system of record and BullMQ is already operational. It avoids a
new distributed system while retaining the durable-inbox seam needed for a
future dedicated ingestion service.

Performance requirements:

- Webhook HTTP handling performs one connection lookup, verification, and one
  receipt insert; it does not update contacts or render UI data inline.
- Cache non-secret connection metadata/public verification keys briefly by
  connection ID, with explicit invalidation on rotation/disable. Shared
  secrets must not be placed in general application caches or logs.
- Batch inserts normalized events per receipt.
- Suppression lookup computes the normalized-address HMAC and uses the unique
  `(team_id, recipient_hash)` index without loading contact lists.
- Dashboard metrics use pre-aggregated hourly/daily counters once raw event
  volume makes live aggregation exceed the agreed query budget.
- No synchronous provider API call is made while processing a webhook.
- Database and queue backpressure are observable; a committed receipt is the
  recovery source if Redis is unavailable.

Scale trigger for architectural extraction: sustained feedback traffic above
500 events/second, inbox tables exceeding operational index budgets, or p95
processing lag above one minute despite horizontal workers. At that point the
route/adapter contract remains unchanged while receipt storage may be
partitioned and processing moved to a dedicated service/stream.

## Observability and operations

Metrics, tagged by provider, feedback scope, delivery route, public `espId`
when custom, and environment—but never recipient:

- Webhook requests, accepted, duplicate, invalid signature, replay rejected,
  malformed, oversized, and unavailable.
- Acknowledgement latency and request body size.
- Pending receipt count, oldest pending age, processing duration, retry count,
  dead-letter count, and replay outcome.
- Normalized events by type and provider.
- Correlation success/unmatched rate.
- Projection conflicts and suppression creates/releases.
- Workspace bounce and complaint rates through privacy-safe aggregates.

Alerts:

- Any sustained invalid-signature spike.
- p95 acknowledgement above 500 ms for 15 minutes.
- Oldest pending authenticated receipt above five minutes.
- Any dead-letter receipt in production.
- Unmatched rate above 5% for a provider over a meaningful sample.
- Database insert failures or BullMQ/poller recovery lag.
- Feedback marked stale for a connection that is actively sending.
- Workspace/provider reputation threshold breach.

Structured logs include `receipt_id`, `connection_id`, `event_id`,
`message_id`, custom-route public `esp_id` when available, delivery route,
provider, state transition, and sanitized error code. They do not include email
addresses, subjects, raw payloads, secrets, or signatures. Platform vendor data
remains operational metadata and is not exposed through team ESP APIs.

Runbook capabilities:

- Disable one compromised feedback connection without stopping other teams.
- Rotate a credential/public key with overlap.
- Replay one receipt or a bounded set from durable storage.
- Inspect why an event is unmatched.
- Rebuild outbound current-state projections from normalized events.
- Rebuild active suppressions from events plus suppression audit.
- Drain/retry dead letters after an adapter fix.
- Compare provider dashboard event ID with SendLit receipt/event IDs.

## API and contract surface

Authenticated workspace endpoints belong in `@sendlit/api-contract` so Zod,
ts-rest routes, generated OpenAPI, API clients, and tests stay aligned.
Representative resources:

```text
GET    /settings/esps/:espId/feedback
PUT    /settings/esps/:espId/feedback
POST   /settings/esps/:espId/feedback/rotate
POST   /settings/esps/:espId/feedback/test
DELETE /settings/esps/:espId/feedback

GET    /delivery-events
GET    /delivery-events/:eventId

GET    /suppressions
GET    /suppressions/:suppressionId
POST   /suppressions/:suppressionId/release
```

Feedback is a new collection-aware subresource, so no
`/settings/esp/feedback` singleton alias is introduced. The existing
`/settings/esp` compatibility alias continues to represent only the default
user ESP as defined by `multiple-esp.md`; using it must not make new feedback
APIs default-dependent. Feedback routes validate that `espId` belongs to the
active team and never return a platform connection.

`GET /delivery-events` may filter by public `espId` and `deliveryRoute`.
Suppressions remain workspace-wide and intentionally have no ESP filter that
changes enforcement semantics.

The provider webhook route is documented in OpenAPI as a public
provider-authenticated endpoint but does not use the normal session/API-key
middleware or expose provider payload unions as a customer-facing API.

Pagination uses the repository's existing envelope. Event/suppression lists
support bounded date filters and cursor pagination before GA; offset-only
pagination over an append-heavy event table is not sufficient at scale.

Error codes are stable strings, including:

```text
feedback_not_supported
feedback_not_configured
feedback_invalid_credentials
feedback_test_failed
feedback_connection_retiring
esp_not_found
recipient_suppressed
suppression_not_releasable
suppression_not_found
```

Any implementation must keep generated OpenAPI behavior and the contract
validation test in sync.

## Migration and rollout

### Phase 0: foundations

- Treat the implemented multi-ESP schema and `custom | platform` routing
  invariants as the migration baseline; do not recreate a team ESP singleton
  or a virtual platform `esp_configs` row.
- Add outbound ledger, event, connection, receipt, suppression, and audit
  schema with indexes and cleanup behavior.
- Provision a distinct pending feedback connection/URL for each existing
  feedback-capable user ESP. Generic/custom SMTP remains unsupported. New
  feedback-capable ESPs receive their own connection; no connection is copied
  from or resolved through the team default.
- Change mail transport to return/store RFC and provider message IDs.
- Add an opaque `msg_...` correlation value through reviewed provider
  adapters.
- Add suppression checks to campaign and transactional pipelines.
- Mirror existing synchronous transactional `5xx` handling into canonical
  delivery events/suppression where classification is recipient-permanent.

No historical asynchronous event backfill is promised. Existing rows may be
linked opportunistically only where correlation is provably unique. Existing
sequence and transactional `deliveryRoute`/`outboxId` values are preserved and
copied into new outbound rows; this feature does not rewrite route selection.

No platform feedback connection is provisioned while platform delivery remains
unavailable. When that feature is introduced, authenticated, correlated
feedback processing is a release requirement, and its deployment connection
must remain outside team ESP CRUD.

### Phase 1: ingestion and provider adapters

- Build raw-body route, durable receipt inbox, recovery poller, BullMQ worker,
  canonical adapter interface, idempotency, and dead-letter replay.
- Ship Resend, SendGrid, Mailgun, and Postmark adapters behind per-provider
  flags.
- Add provider-specific fixtures and test-event setup.
- Show configuration health and delivery/suppression logs.

### Phase 2: Amazon SES

- Add SNS signature validation, expected-topic enforcement, safe subscription
  confirmation, multi-recipient normalization, and SES-specific setup UX.
- Exercise the integration with SES mailbox simulator and controlled SNS test
  messages.

SES is a separate phase because secure SNS subscription handling and nested
SES payloads are materially different from direct signed webhooks. It remains
required before the feature is called complete for all providers shown by
SendLit settings.

### Phase 3: hardening and reputation controls

- Complete load/chaos testing, retention jobs, aggregation, alerting, and
  operational replay tooling.
- Run shadow mode: ingest and project events but report proposed suppressions
  without blocking sends for selected internal workspaces.
- Compare against provider dashboards, then enable enforcement per workspace.
- Add conservative reputation warnings; evaluate automatic marketing circuit
  breakers after production data review.

### Deployment safety

- New schema is additive.
- Sending can continue while feedback is disabled.
- Suppression enforcement has a per-workspace kill switch available only to
  operators and produces an audit event.
- Provider adapters have independent rollout flags and metrics.
- Rollback disables ingestion/enforcement but never deletes receipts, events,
  or suppressions.
- Retiring endpoints remain available long enough for documented provider
  retry windows.

## Testing strategy

### Unit tests

- Each provider's valid, malformed, additive-field, multi-event, and
  multi-recipient fixtures.
- Raw-body signature verification, invalid signature, rotated credential,
  timestamp boundary, token replay, and constant-time comparison wrappers.
- Mapping of every required provider event to the canonical model.
- Stable provider event-key generation.
- Delivery projection transitions for every order permutation.
- Hard bounce, complaint, repeated soft bounce, successful reset, and
  provider-suppression rules.
- Email normalization without Gmail-style alias mutation.
- Strongest-reason precedence and release eligibility.

### Integration tests

- Two ESPs in one team, including two accounts using the same provider, receive
  different connection IDs/credentials and cannot cross-correlate events.
- A non-default ESP explicitly pinned to a sequence or transactional send
  correlates through that ESP's feedback connection; changing the team default
  before or after delivery changes nothing.
- Foreign-team `espId` and connection IDs cannot be read, configured, tested,
  or correlated by another team.
- Changing an ESP's provider retires the old connection and creates a new one;
  changing name, sender identity, or default status does not.
- Deletion follows existing `esp_in_use` behavior. An allowed deletion retires
  feedback, preserves historical events/suppressions, and accepts valid late
  events during the grace period.
- Receipt is committed before `200`; DB failure returns non-success.
- Redis unavailable after commit still processes through recovery poller.
- Duplicate HTTP receipts and provider replays cause one side effect.
- Two workers racing one event cannot double-suppress or regress status.
- Correlation through custom ID, provider ID, RFC ID, and unmatched fallback.
- Tenant isolation for connection, event lookup, suppression, and release.
- Suppression checked at enqueue and worker transport boundary.
- Contact deletion/reimport does not remove suppression.
- Team deletion cleans up every new collection according to policy.
- Secret fields are absent from API responses, logs, analytics, and traces.
- Public webhook route bypasses user auth but cannot bypass provider auth.
- User-ESP feedback processing neither checks nor changes platform quota.
- Future platform fixtures may contain multiple workspaces in one receipt;
  tenant ownership is derived per matched outbound message, and unmatched
  events remain teamless/operator-only.
- OpenAPI contract matches authenticated endpoints.

### Provider/sandbox tests

- SendGrid test webhook with signed production-equivalent payload.
- Mailgun signed fixture and provider retry behavior.
- Postmark black-hole bounce and spam-complaint-shaped test payload using the
  configured credential; no full content.
- Resend bounce/delay/complaint test addresses or dashboard test/replay.
- SES mailbox simulator plus SNS subscription/notification flow.

Synthetic `curl` payloads prove parsing only and must not be treated as proof
of production authentication.

### Load and resilience tests

- 10 MiB request limit and large provider batches.
- Burst of at least 100 webhook requests/second and 1,000 events/second in the
  test environment without missing or duplicate normalized events.
- Database latency/failure, Redis outage, worker crash after insert, stale
  processing lease, duplicate enqueue, and out-of-order delivery.
- Retention deletion in bounded batches without table-wide locks.

Repository verification commands during implementation:

```bash
pnpm --filter @sendlit/api test
pnpm --filter @sendlit/api typecheck
pnpm --filter @sendlit/api build
pnpm lint
pnpm prettier
```

## Acceptance criteria

The feature is production-ready when all of the following are true:

1. Every provider presented as feedback-capable has a reviewed adapter,
   authentication, setup guide, fixtures, sandbox verification, and health
   telemetry.
2. An authenticated receipt is durably committed before SendLit returns
   success and can recover without Redis.
3. Replaying any fixture ten times produces one canonical event per logical
   recipient and one suppression action.
4. Events received in any order produce the documented current state.
5. A hard bounce or complaint blocks both campaign and transactional transport
   for the same workspace/address across every custom ESP and the future
   platform route, including already queued work.
6. Deleting/reimporting a contact, changing the default ESP, deleting an
   eligible unused ESP, or switching routes does not bypass an active workspace
   suppression.
7. A delivery delay never suppresses; three consecutive final soft bounces in
   30 days do; a successful delivery resets the streak.
8. Complaint suppression cannot be owner-released, and every permitted release
   is audited.
9. Provider request data cannot select another workspace: custom connections
   are pinned to one team/ESP, platform events derive a team only from a matched
   outbound row, and tenant-isolation tests cover every read/write path.
10. Secrets/raw payloads are encrypted and excluded from logs, API responses,
    error monitoring, and analytics.
11. p95 acknowledgement is below 500 ms and 99.9% of receipts process within
    five minutes under the agreed load test.
12. Dead letters, unmatched events, stale connections, invalid signatures,
    and processing lag have dashboards, alerts, and runbook actions.
13. Retention and team/recipient deletion jobs are tested and bounded.
14. OpenAPI, web client integration, and user documentation match the shipped
    behavior.
15. Multiple ESPs in one team have independent feedback URLs, secrets, health,
    event namespaces, and lifecycle; the selected/pinned ESP—not the current
    default—controls correlation.
16. Feedback APIs are collection-aware under `/settings/esps/:espId`, enforce
    team ownership, expose no platform connection, and introduce no singleton
    feedback alias.
17. Custom-route feedback never consumes or modifies platform quota, and the
    reserved platform route remains unavailable until its deployment adapter
    and feedback connection are production-ready.

## Risks and mitigations

| Risk                                             | Mitigation                                                                                    |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| Forged complaint suppresses arbitrary users      | Provider authentication, opaque connection IDs, replay defense, tenant-scoped correlation     |
| Webhook acknowledged before it is safe           | Commit durable receipt before `200`; recover independently of Redis                           |
| Provider retries create duplicate side effects   | Receipt/event idempotency plus transactional projection/suppression                           |
| Out-of-order events regress delivery state       | Immutable event log and guarded projection rules                                              |
| Complaint recipient is redacted                  | One recipient per outbound message; provider-message correlation; never guess                 |
| Provider payload changes                         | Additive-tolerant schemas, `unknown` event storage, fixtures, adapter alerts                  |
| Postmark lacks HMAC signatures                   | Strong custom credential/Basic Auth, TLS, optional IP allowlist, schema validation, rotation  |
| SNS introduces SSRF                              | AWS signature/topic validation and strict certificate/confirmation URL allowlist              |
| Contact reimport bypasses provider feedback      | Dedicated workspace/address suppression table                                                 |
| Event is attributed to the wrong user ESP        | Distinct per-ESP connection IDs; pinned-outbox correlation; never resolve through the default |
| Default promotion changes feedback routing       | Feedback lifecycle is keyed by immutable ESP/config IDs, not `isDefault`                      |
| Platform batch crosses tenant boundaries         | Platform receipt is teamless; assign team only from a uniquely matched outbound message       |
| Suppression blocks legitimate transactional mail | Clear policy, eligible audited hard/soft release; complaints stay protected                   |
| Raw feedback leaks PII/content                   | Disable content inclusion, encrypt payload, redact logs, 30-day raw retention                 |
| New infrastructure burden                        | PostgreSQL durable inbox and existing BullMQ; extraction seam retained                        |

## Decisions requiring approval

This PRD proposes the following defaults. They are explicit review points, not
implementation ambiguities:

1. Suppression applies to transactional mail as well as marketing, with no
   automatic critical-message bypass.
2. Three consecutive final soft bounces within 30 days suppress; a delivery
   resets the streak.
3. Workspace owners cannot release complaint suppressions.
4. Raw encrypted payload retention is 30 days; normalized events 13 months.
5. Manual provider webhook configuration ships first; automatic provider API
   provisioning is later optimization.
6. Generic/custom SMTP has synchronous feedback only in v1 and is labeled
   accordingly.
7. Amazon SES ships as a separate security-focused phase but is required for
   full provider coverage.
8. Every user ESP owns an independent feedback subresource; there is no
   default-ESP feedback alias.
9. Workspace suppression is shared across all of the team's ESPs and delivery
   routes.
10. Platform feedback is deployment-managed and hidden from ESP CRUD; platform
    delivery remains disabled until that feedback path is available.

## Official references

- [Amazon SES SNS notification contents](https://docs.aws.amazon.com/ses/latest/dg/notification-contents.html)
- [Amazon SES SNS notification configuration](https://docs.aws.amazon.com/ses/latest/dg/configure-sns-notifications.html)
- [Amazon SNS message-signature verification](https://docs.aws.amazon.com/sns/latest/dg/sns-verify-signature-of-message.html)
- [Amazon SES reputation alarms and recommended rates](https://docs.aws.amazon.com/ses/latest/dg/reputationdashboard-cloudwatch-alarm.html)
- [Twilio SendGrid Event Webhook reference](https://www.twilio.com/docs/sendgrid/for-developers/tracking-events/event)
- [Twilio SendGrid webhook security](https://www.twilio.com/docs/sendgrid/for-developers/tracking-events/getting-started-event-webhook-security-features)
- [Twilio SendGrid Event Webhook overview and retry behavior](https://www.twilio.com/docs/sendgrid/for-developers/tracking-events/twilio-sendgrid-event-webhook-overview)
- [Mailgun webhook security](https://documentation.mailgun.com/docs/mailgun/user-manual/webhooks/securing-webhooks)
- [Mailgun webhook retry behavior](https://documentation.mailgun.com/docs/mailgun/user-manual/webhooks/webhook-retries)
- [Mailgun event structure](https://documentation.mailgun.com/docs/mailgun/user-manual/events/event-structure)
- [Postmark webhook overview, protection, and retries](https://postmarkapp.com/developer/webhooks/webhooks-overview)
- [Postmark bounce webhook](https://postmarkapp.com/developer/webhooks/bounce-webhook)
- [Postmark spam-complaint webhook](https://postmarkapp.com/developer/webhooks/spam-complaint-webhook)
- [Postmark Webhooks API](https://postmarkapp.com/developer/api/webhooks-api)
- [Resend webhook verification](https://resend.com/docs/webhooks/verify-webhooks-requests)
- [Resend retry and replay behavior](https://resend.com/docs/webhooks/retries-and-replays)
- [Resend event types](https://resend.com/docs/webhooks/event-types)
- [RFC 3464: Delivery Status Notifications](https://www.rfc-editor.org/info/rfc3464/)
- [RFC 5965: Abuse Reporting Format](https://www.rfc-editor.org/info/rfc5965/)
- [Gmail sender-guideline FAQ](https://support.google.com/mail/answer/14229414)
