# PRD: Platform Customers and Managed Delivery

_Status: proposed for review. Date: 2026-07-30. Owners: SendLit API, Web, and
Operations. Scope: platform-customer tenancy, platform-scoped managed outboxes,
team delivery capabilities, hybrid managed/custom routing, managed-delivery
quota, provisioning, feedback correlation, REST/OpenAPI, MCP, and operator
controls._

## Executive summary

SendLit serves two related but distinct customer models:

1. A standalone product such as FrontLit provisions one SendLit team for each
   of its teams. The SendLit team connects and pays for its own email service
   provider (ESP).
2. An embedding SaaS product such as CourseLit provisions one SendLit team for
   each of its schools. The school receives email marketing out of the box,
   sends through infrastructure managed by CourseLit, and has a fixed
   daily/monthly allowance. The school does not initially configure an ESP.

CourseLit is only one example. SendLit must support several unrelated platform
customers, each with its own workspaces, branding, sending infrastructure,
credentials, policies, and quotas. A platform customer may also later let an
individual workspace connect its own ESP without re-provisioning or migrating
the workspace.

This PRD introduces a tenant level above teams:

```text
SendLit
├── standalone teams
│   └── team-owned custom ESPs
└── platform customers
    ├── platform-owned managed outboxes
    └── provisioned teams
        ├── managed delivery
        ├── team-owned custom ESPs
        └── or both
```

A **platform customer** is an application such as CourseLit that embeds
SendLit. A **team** remains SendLit's workspace and data-isolation boundary. A
**managed outbox** is a logical sending connection controlled by a platform
customer and shared by eligible teams. A **custom ESP** remains a team-owned
connection in `esp_configs`.

Delivery is resolved to either:

- `managed`: use a platform-scoped managed outbox and consume managed-delivery
  quota; or
- `custom`: use a pinned team-owned `esp_configs` row and bypass
  managed-delivery quota.

Teams have independent capabilities. A CourseLit school can start as
managed-only and later become hybrid by enabling custom ESPs. Existing
FrontLit/standalone teams remain custom-only. The chosen source is pinned
before work is queued or activated and workers never silently fall back to a
different source.

## Problem

SendLit's current tenant model correctly uses one team per external workspace,
but the current sending and provisioning assumptions cannot safely support
managed embedding at scale:

- `POST /provisioning/teams` is protected by one deployment-wide
  `PROVISIONING_SECRET`. It cannot identify which platform customer made the
  request or restrict that caller to its own teams.
- `teams.externalId` is globally unique. Two platform customers may legitimately
  use the same external identifier.
- User-managed ESP credentials live on each team. Copying one platform ESP
  into every team duplicates credentials, makes rotation expensive, exposes
  the connection through team ESP administration, and loses the distinction
  between platform-funded and customer-funded sends.
- The reserved `platform` delivery route assumes one deployment-wide
  SendLit-provided provider. That does not support several platform customers
  with different providers, sending domains, or reputational boundaries.
- Campaign and transactional paths currently require a custom ESP. The
  reserved route is persisted in parts of the schema but cannot be selected or
  delivered.
- Daily/monthly quota fields live on `accounts`. One account may own several
  teams, so unrelated schools owned by the same administrator share an
  allowance. Conversely, changing a team's owner changes its quota identity.
- Current quota checks are separate from increments and are unsuitable for
  concurrent managed sending. Parallel workers could exceed a limit.
- Sender identity is stored only on custom ESP rows. Managed delivery needs a
  platform-controlled From address with a team-specific display name and
  optional Reply-To.
- A platform customer needs lifecycle controls that a team API key must not
  have: provision, suspend, change entitlement, enable custom ESPs, rotate a
  lost team key, and deprovision.
- Current provisioning turns `ownerEmail` into a SendLit account and owner
  membership. Possession of an email address plus OTP authentication must not
  implicitly authorize a person to inspect a platform-owned workspace or any
  managed sending capability.
- A shared managed provider needs platform-aware rate limiting, feedback
  correlation, abuse controls, and operational health that custom ESPs do not
  require.

Treating a managed platform connection as a virtual or duplicated team ESP
would blur ownership and authorization. Treating CourseLit as a special team
type would make the next embedded customer another special case. The missing
concept is a first-class platform customer with platform-owned managed
outboxes and team-scoped delivery entitlements.

## Relationship to existing architecture and PRDs

This PRD builds on the implemented team, multiple-ESP, transactional-email,
outbound-ledger, feedback, and suppression architecture.

It preserves these invariants:

- A team remains the data boundary for contacts, templates, sequences,
  transactional emails, delivery history, suppressions, settings, media, and
  normal API keys.
- `esp_configs` contains only team-owned custom ESPs.
- A custom send pins one team-owned ESP before activation/enqueue.
- Custom sends do not consume SendLit-managed delivery quota.
- Suppression is team-wide and route-independent.
- An outbound ledger row exists before provider submission.
- Feedback is authenticated, stored durably, normalized asynchronously, and
  correlated to the exact outbound message.
- Authentication/system email remains separate from marketing and
  transactional delivery.

This PRD supersedes only the future managed-delivery assumptions in
[`multiple-esp.md`](./multiple-esp.md) and
[`bounces-and-complaints.md`](./bounces-and-complaints.md):

- The reserved route is renamed from `platform` to `managed`. No production
  send currently uses the reserved route, so it should be renamed before it
  becomes a public or durable compatibility burden.
- Managed provider configuration is platform-customer-scoped, not necessarily
  deployment-wide.
- A managed feedback connection belongs to a managed outbox rather than being
  one global teamless connection.
- Managed quota belongs to a team's entitlement, with an optional additional
  platform-customer pool. It does not belong to the team's owner account.

The word **platform** in this document means an embedding SaaS customer. The
word **managed** describes the delivery route. This naming avoids ambiguity
between SendLit, the embedding platform, and the email provider.

## Product principles and decisions

### Teams remain the workspace boundary

There is one SendLit team per external platform workspace:

- one CourseLit school;
- one store in an ecommerce SaaS;
- one community in a membership platform;
- one FrontLit team; or
- one standalone SendLit workspace.

A platform customer's teams do not share contacts, templates, suppressions,
reports, API keys, or usage allowances. Platform ownership grants lifecycle
authority over those teams; it does not merge their data scope.

For a platform-provisioned team, the platform customer—not the external
workspace administrator—is the SendLit owner. An administrator's email in the
embedding product is not a SendLit authorization grant. Platform teams have no
human `team_members` rows in v1 and are never selectable through email-OTP,
OAuth, or the SendLit dashboard. The embedding platform accesses them with
platform and team API credentials.

### Managed outboxes are logical, stable resources

A managed outbox represents a sending identity and provider route controlled
by one platform customer. Its public ID remains stable while provider
credentials, provider account, API endpoint, or feedback connection rotate.

Teams and queued work pin the logical managed outbox, never raw credentials.
Workers resolve the managed outbox's current active provider configuration at
delivery time. This allows credential rotation and provider migration without
rewriting every team or queued record.

### Capabilities are independent

Every team has explicit delivery capabilities:

```text
managed delivery enabled: true | false
custom ESPs enabled:      true | false
team may change default:  true | false
```

Valid product configurations include:

| Product configuration      | Managed | Custom | Initial default        |
| -------------------------- | ------- | ------ | ---------------------- |
| Existing FrontLit team     | No      | Yes    | Custom                 |
| CourseLit school today     | Yes     | No     | Managed                |
| CourseLit school later     | Yes     | Yes    | Managed or user choice |
| Fully managed embedded app | Yes     | No     | Managed                |
| BYO-ESP embedded app       | No      | Yes    | Custom                 |

Enabling custom ESPs later changes capability and UI only. It does not create a
new team, move contacts, or alter historical delivery records.

### The source is resolved once and delivery fails closed

For transactional email, SendLit resolves and pins the delivery source before
creating the queued message. For a broadcast or sequence, it resolves and pins
the source atomically with activation.

After pinning:

- changing the team's default affects only future activations/enqueues;
- changing which custom ESP is default does not affect active work;
- a missing pinned custom ESP is an error;
- a disabled or unavailable pinned managed outbox is deferred or failed
  according to its lifecycle state;
- SendLit never silently moves a message from custom to managed or managed to
  custom; and
- a retry reuses the same route, logical outbox, outbound row, RFC Message-ID,
  and quota reservation.

Silent fallback is prohibited because it changes sender identity, billing,
quota, feedback correlation, and reputation.

### Managed and custom connections have separate administration

Team ESP CRUD continues to manage only `esp_configs`. Managed outboxes are
never returned by `/settings/esps` and their provider credentials are never
available to team sessions, team API keys, or team MCP clients.

Teams instead receive a read-only sending-options view containing their
assigned managed option, when present, and the custom ESPs they own.

### Sender ownership follows delivery ownership

For a managed send:

- the managed outbox controls the From address and permitted domain;
- the team controls or receives a provisioned display name and Reply-To,
  subject to platform policy; and
- callers cannot provide an arbitrary From address per message.

For a custom send, sender identity continues to come from the pinned custom ESP
configuration.

For example, CourseLit can provision:

```text
From: Jane Doe <no-reply@comm.courselit.app>
Reply-To: jane@school.example
```

The school may edit `Jane Doe` or Reply-To only if CourseLit's policy permits
it. It cannot change `no-reply@comm.courselit.app` through a team API.

## Goals

1. Represent multiple independent SaaS/platform customers in one SendLit
   deployment.
2. Provision one isolated SendLit team per external platform workspace using
   platform-specific credentials and idempotency.
3. Configure one or more managed outboxes per platform customer without
   copying credentials into teams.
4. Allow a team to use managed delivery, custom ESP delivery, or both.
5. Allow a managed-only team to enable custom ESPs later without migration.
6. Pin route and logical outbox consistently for broadcasts, sequences, and
   transactional messages.
7. Enforce daily/monthly managed-delivery quota per team without concurrency
   overshoot.
8. Optionally enforce an aggregate managed-delivery allowance per platform
   customer.
9. Keep custom sends outside managed quota.
10. Provide platform-authorized team lifecycle, entitlement, sender, and key
    management without granting cross-platform access.
11. Ensure an external owner/admin email never creates implicit SendLit
    membership or dashboard access to a platform-owned team.
12. Correlate managed provider feedback to the correct outbound message and
    team without trusting a team identifier in a provider webhook.
13. Preserve the current suppression, idempotency, audit, and delivery-log
    invariants.
14. Generate matching REST/OpenAPI documentation and MCP behavior.
15. Provide migration and compatibility paths for current standalone teams and
    the global provisioning secret.

## Non-goals

- Building a public self-service signup or billing portal for platform
  customers.
- Becoming an MTA or operating mailbox-provider feedback loops directly.
- Letting a team create, update, or inspect a managed outbox.
- Treating a managed outbox as an `esp_configs` row.
- Automatically choosing the cheapest provider across unrelated platform
  customers.
- Silently failing over between managed and custom routes.
- Charging custom-ESP volume against managed-delivery quota.
- Migrating a team between platform customers through a public API. That is a
  privileged support operation because it changes an authorization boundary.
- Cross-team contact, template, suppression, or analytics sharing.
- Batch transactional API changes; `POST /emails` remains one recipient per
  request.
- Designing end-user pricing, invoices, taxes, or payment collection. This PRD
  provides metering and limits that a billing system can consume.
- A platform-administration MCP surface. Platform administration remains
  server-to-server REST in v1.
- A complete platform-customer dashboard in v1. Operator and API surfaces are
  required; a dedicated UI may follow.
- Direct human membership or delegated SendLit-dashboard access for
  platform-owned teams. If introduced later, it requires an explicit
  invitation/delegation model and must not infer access from an external owner
  email.

## Terminology

| Term                | Definition                                                                    |
| ------------------- | ----------------------------------------------------------------------------- |
| Platform customer   | A SaaS/product embedding SendLit, such as CourseLit                           |
| Platform key        | A credential scoped to exactly one platform customer                          |
| Team                | A SendLit workspace and tenant/data boundary                                  |
| External ID         | The platform customer's immutable identifier for one workspace                |
| Managed outbox      | A platform-owned logical sending connection and From identity                 |
| Custom ESP          | A team-owned connection stored in `esp_configs`                               |
| Delivery capability | Whether a team may use managed and/or custom delivery                         |
| Delivery default    | The source resolved when a caller does not explicitly select one              |
| Managed entitlement | A team's limits and permission to consume managed delivery                    |
| Quota reservation   | An atomic allocation held for one managed outbound message                    |
| Sending option      | A read-only client representation of an eligible managed outbox or custom ESP |

## Users and user stories

### Platform developer

- I can provision a team idempotently using my own immutable workspace ID.
- I receive a team API key once and can rotate it if my storage loses or
  exposes it.
- I can update the team's display name, owner, managed sender settings,
  capabilities, and quota without accessing another platform customer's team.
- I can suspend sending immediately without deleting the team's data.
- I can enable custom ESP administration later for selected teams or all new
  teams.
- I can inspect managed usage and quota state for support and billing.

### Platform operator

- I can create and rotate a managed outbox without updating every team.
- I can verify its credentials, sender identity, feedback connection, and
  health before enabling it.
- I can retire an old provider configuration while still accepting delayed
  feedback.
- I can suspend one abusive team without suspending every team on the managed
  outbox.
- I can enforce an aggregate allowance or throughput ceiling for my platform.

### Team administrator

- Through my embedding platform's UI, I can use managed delivery immediately
  when my platform grants it.
- I see the display name, From address, quota, and availability information my
  platform chooses to expose without receiving a SendLit login or seeing a
  managed-outbox resource.
- If custom ESPs are enabled, I can connect and test my own provider.
- If both routes are available and platform policy allows it, I can choose the
  default and select another eligible source for a particular campaign or
  transactional message.
- My custom ESP traffic does not consume the managed allowance.
- I cannot escape a platform suspension, forge a managed From address, or use a
  managed outbox belonging to another platform.

### SendLit operator/support engineer

- I can identify a platform customer, team, managed outbox, outbound message,
  quota reservation, or feedback receipt by public/internal identifiers.
- I can audit provisioning, entitlement, sender, credential, suspension, and
  key-rotation changes without seeing secret values.
- I can disable a compromised platform key or managed outbox.
- I can diagnose quota deferral, provider throttling, invalid feedback, and
  noisy-neighbor behavior.

## Domain model

### Platform customer

Add `platform_customers`:

```text
platform_customers
  id                         uuid PK
  platform_customer_id       text NOT NULL UNIQUE  -- pcus_...
  name                       text NOT NULL
  status                     text NOT NULL          -- active | suspended | closed
  default_managed_outbox_id  uuid nullable
  default_custom_esp_enabled boolean NOT NULL DEFAULT false
  default_team_can_choose    boolean NOT NULL DEFAULT false
  aggregate_daily_limit      integer nullable
  aggregate_monthly_limit    integer nullable
  created_at                 timestamptz
  updated_at                 timestamptz
```

Rules:

- Public IDs follow the repository convention and get a prefix check.
- `null` aggregate limits mean unlimited at that level; a team entitlement is
  still required.
- `default_managed_outbox_id`, when present, must reference an active or draft
  outbox belonging to the same platform customer.
- `suspended` blocks provisioning mutations and new managed dispatch while
  preserving data, queued work, custom delivery policy, and feedback
  ingestion. Whether custom delivery remains available is controlled by the
  suspension action and must be explicit.
- `closed` is terminal and requires an operator workflow; it is not a public
  API action.

### Platform API key

Add `platform_api_keys`:

```text
platform_api_keys
  id                    uuid PK
  platform_api_key_id   text NOT NULL UNIQUE       -- pak_...
  platform_customer_id  uuid NOT NULL FK
  name                  text NOT NULL
  key_prefix            text NOT NULL
  key_hash              text NOT NULL UNIQUE
  scopes                text[] NOT NULL
  expires_at            timestamptz nullable
  last_used_at           timestamptz nullable
  revoked_at             timestamptz nullable
  created_at             timestamptz
```

The plaintext uses a distinct recognizable prefix such as `slp_live_...`, is
shown once, and is stored only as a hash. Supported v1 scopes:

- `teams:provision`
- `teams:read`
- `teams:manage`
- `teams:keys`
- `outboxes:read`
- `outboxes:manage`
- `usage:read`

The authenticated credential determines `platformCustomerId`; request bodies
and headers cannot override it.

### Team affiliation

Extend `teams`:

```text
platform_customer_id  uuid nullable FK -> platform_customers.id
external_id           text nullable
ownership_type        text NOT NULL DEFAULT 'account'  -- account | platform
owner_account_id      uuid nullable FK -> accounts.id
platform_status       text NOT NULL DEFAULT 'active'   -- active | sending_suspended | deprovisioned
```

Constraints and indexes:

- Platform-managed identity is `UNIQUE (platform_customer_id, external_id)`
  where both values are non-null.
- Standalone external IDs, if still supported, use a separate partial unique
  index where `platform_customer_id IS NULL`.
- A team cannot set `externalId` through normal team APIs.
- A platform team cannot change `platformCustomerId` through application code.
- `ownership_type = account` requires non-null `ownerAccountId` and null
  `platformCustomerId`.
- `ownership_type = platform` requires non-null `platformCustomerId` and null
  `ownerAccountId`.
- Platform-owned teams have no `team_members` rows in v1. Provisioning must not
  call `findOrCreateBareAccount`, create an account, or add membership from an
  external administrator email.
- OAuth/email-OTP authorization continues to require a `team_members` row.
  `listTeamsForAccount`, `requireTeam`, the team picker, and OAuth consent must
  therefore never enumerate or select a platform-owned team.
- The owning platform and a team-scoped API key remain valid for their
  respective routes. A platform key does not become a team key implicitly.
- An embedding platform keeps its own workspace-owner/admin identity. SendLit
  does not need or persist `ownerEmail` for authorization.
- `deprovisioned` denies all new team activity but preserves data for the
  configured retention window. Hard deletion is a separate explicit action.

This is an ownership change from the current non-null `teams.ownerAccountId`
model. Making that column nullable is intentional: creating a synthetic or
shared human-login account for the platform would preserve the same confused
authorization boundary and could expose every platform team if that account
were compromised.

### Managed outbox

Add `managed_outboxes`:

```text
managed_outboxes
  id                    uuid PK
  managed_outbox_id     text NOT NULL UNIQUE       -- mob_...
  platform_customer_id  uuid NOT NULL FK
  name                  text NOT NULL
  provider              text NOT NULL
  status                text NOT NULL               -- draft | active | suspended | retiring | retired
  from_email            text NOT NULL
  envelope_from_domain  text nullable
  encrypted_secret      text nullable
  secret_ref            text nullable
  credentials_version   integer NOT NULL DEFAULT 1
  max_messages_per_sec  integer nullable
  max_connections       integer nullable
  last_tested_at        timestamptz nullable
  last_test_status      text nullable
  last_test_error_code  text nullable
  created_at             timestamptz
  updated_at             timestamptz
```

Rules:

- Exactly one of `encrypted_secret` or `secret_ref` may be present for an
  active outbox. An external secrets manager is preferred where available.
- Secrets use a dedicated managed-outbox encryption key and are never returned
  after create/update, logged, captured in analytics, or included in error
  monitoring.
- `from_email` must be syntactically valid and verified with the provider
  before status becomes `active`.
- A managed provider must have reviewed outbound and feedback adapters before
  production activation. Generic SMTP without asynchronous feedback is not an
  acceptable production managed route.
- `suspended` refuses new submissions and retries with an operator-visible
  reason.
- `retiring` cannot be selected for new work, but already pinned work may
  finish during a bounded drain window.
- `retired` never sends. Its non-secret metadata and feedback connection remain
  available for historical correlation and retention.
- Credential rotation increments `credentials_version` but does not change
  `managedOutboxId`.
- Provider migration may either update the logical outbox after validation or
  create a second outbox for an explicit gradual migration. The latter is
  required when From identity, reputation, or rollback boundaries differ.

### Team delivery settings

Add a team singleton `team_delivery_settings`:

```text
team_delivery_settings
  id                         uuid PK
  team_id                    uuid NOT NULL UNIQUE FK
  managed_delivery_enabled   boolean NOT NULL DEFAULT false
  custom_esp_enabled         boolean NOT NULL DEFAULT true
  team_can_change_default    boolean NOT NULL DEFAULT true
  default_delivery_route     text nullable             -- managed | custom
  managed_outbox_id          uuid nullable FK
  managed_from_name          text nullable
  managed_reply_to           text nullable
  managed_sender_editable    boolean NOT NULL DEFAULT false
  updated_by_type            text NOT NULL              -- platform | account | system
  updated_by_id              uuid/text nullable
  created_at                 timestamptz
  updated_at                 timestamptz
```

Invariants:

- At least one of `managed_delivery_enabled` or `custom_esp_enabled` must be
  true for an active team.
- Managed delivery requires a platform customer, an active entitlement, and a
  managed outbox owned by the same platform customer.
- `default_delivery_route = managed` requires managed delivery to be enabled.
- `default_delivery_route = custom` requires custom ESPs to be enabled. It may
  be set before a custom ESP exists, but sending then fails with
  `custom_esp_not_configured`; it never falls through to managed.
- A normal team session may change only the default and editable sender fields,
  and only when the policy permits.
- Disabling custom ESPs does not delete existing `esp_configs`. It makes them
  unavailable for new selection. Active/paused work pinned to one follows the
  platform's requested transition mode: `drain`, `pause`, or `cancel`. The
  default is `drain`.
- Disabling managed delivery follows the same explicit transition model.
- Changing a managed From display name or Reply-To affects future outbound
  messages. Existing outbound rows retain their resolved sender snapshot.

Existing standalone teams are backfilled with:

```text
managed_delivery_enabled = false
custom_esp_enabled = true
team_can_change_default = true
default_delivery_route = custom
```

### Managed-delivery entitlement

Add one entitlement per managed-enabled team:

```text
managed_delivery_entitlements
  id                    uuid PK
  team_id               uuid NOT NULL UNIQUE FK
  daily_limit           integer nullable
  monthly_limit         integer nullable
  status                text NOT NULL  -- active | suspended | expired
  effective_from        timestamptz NOT NULL
  effective_until       timestamptz nullable
  created_at             timestamptz
  updated_at             timestamptz
```

Limits are non-negative. `0` means no managed sends; `null` means unlimited.
Limits apply to accepted provider submissions, not API request count. Plan
names, prices, and billing references may be added later without changing the
delivery boundary.

### Quota buckets and reservations

Do not reuse mutable counters on `accounts`. Add bucketed usage:

```text
managed_quota_buckets
  id                    uuid PK
  team_id               uuid nullable FK
  platform_customer_id  uuid nullable FK
  period_type           text NOT NULL       -- day | month
  period_start          timestamptz NOT NULL
  reserved_count        integer NOT NULL DEFAULT 0
  accepted_count        integer NOT NULL DEFAULT 0
  updated_at             timestamptz

  CHECK exactly one of team_id | platform_customer_id is non-null
  UNIQUE (team_id, period_type, period_start) WHERE team_id IS NOT NULL
  UNIQUE (platform_customer_id, period_type, period_start)
    WHERE platform_customer_id IS NOT NULL

managed_quota_reservations
  id                    uuid PK
  reservation_id        text NOT NULL UNIQUE  -- qrs_...
  outbound_message_id   uuid NOT NULL UNIQUE FK
  team_id               uuid NOT NULL FK
  platform_customer_id  uuid NOT NULL FK
  day_period_start      timestamptz NOT NULL
  month_period_start    timestamptz NOT NULL
  state                 text NOT NULL         -- reserved | committed | released
  release_reason        text nullable
  created_at             timestamptz
  committed_at           timestamptz nullable
  released_at            timestamptz nullable
```

Quota periods are calendar UTC:

- day: `[00:00:00 UTC, next day)`;
- month: first day of the UTC month through the first day of the next month.

This is deterministic, supportable, and does not reuse one reset timestamp for
two different windows. A future billing timezone must create an explicit
versioned policy rather than reinterpret historical buckets.

Reservation rules:

1. Before a managed message becomes dispatchable, create its outbound row and
   reserve one unit against the team's daily/monthly buckets and, when set, the
   platform customer's daily/monthly buckets.
2. All applicable buckets are checked and incremented in one database
   transaction using row locks or conditional upserts. The transaction succeeds
   only when every limit has capacity.
3. A retry reuses the existing reservation.
4. Provider acceptance atomically moves one unit from `reserved_count` to
   `accepted_count` and marks the reservation `committed`.
5. Suppression discovered before submission, permanent pre-acceptance failure,
   cancellation, or terminal rendering/configuration failure releases the
   reservation.
6. A later bounce, complaint, or delivery failure does not refund an accepted
   submission.
7. Stale reservations are reconciled by a scheduled job against outbound and
   queue state. Age alone must not release a reservation while a live job may
   still submit it.

This reservation model prevents parallel workers from overshooting quota while
retaining the rule that only accepted managed submissions count as usage.

## Delivery-source representation

### Persisted route

Replace reserved `platform` values with `managed` in:

- `sequences.deliveryRoute`;
- `transactional_emails.deliveryRoute`;
- `outbound_messages.deliveryRoute`;
- delivery-event schemas and filters; and
- feedback connection scope.

Add nullable `managedOutboxId` internal FKs to sequences, transactional emails,
and outbound messages.

Database checks enforce:

```text
custom:
  esp_config_id/outbox_id is not null
  managed_outbox_id is null

managed:
  esp_config_id/outbox_id is null
  managed_outbox_id is not null
```

Draft sequences may have an unresolved route. Active/paused sequences and
queued/sending transactional messages may not.

`outbound_messages` also stores:

- the resolved From string;
- the provider snapshot used for internal diagnostics/correlation;
- the exact feedback connection selected at submission.

The managed quota reservation is discoverable through its unique
`outbound_message_id`; no reverse FK is required on `outbound_messages`.

Provider metadata is internal and must not expose a managed vendor or account
to team-facing APIs unless the platform customer explicitly opts into that
display.

### Public selection schema

Introduce a delivery-source union:

```jsonc
{
    "deliverySource": {
        "type": "managed",
    },
}
```

or:

```jsonc
{
    "deliverySource": {
        "type": "custom",
        "espId": "esp_...",
    },
}
```

The team-facing managed variant intentionally has no `managedOutboxId`.
Managed-enabled teams have exactly one platform-assigned managed outbox in v1,
and the server resolves its internal FK. The public `mob_...` handle exists
only on platform-management APIs. This prevents a team credential or future
delegated member from enumerating, selecting, or learning a platform-owned
outbox resource. `espId` may be omitted only when the team has a default custom
ESP.

For backward compatibility:

- existing optional `espId` fields remain accepted as an alias for
  `{ type: "custom", espId }`;
- requests containing both `espId` and `deliverySource` return `400`;
- responses use `deliverySource`; and
- `espId` response aliases may remain during one documented deprecation
  window.

Callers cannot submit the raw persisted `deliveryRoute` field.

### Resolution precedence

When no explicit source is supplied:

1. Use `team_delivery_settings.default_delivery_route`.
2. For `custom`, resolve only the team's `isDefault` custom ESP.
3. For `managed`, resolve only the team's assigned/default managed outbox.
4. If `default_delivery_route` is null:
    - choose the sole eligible source when exactly one route is enabled and
      usable;
    - otherwise return `delivery_source_required`.

There is no "arbitrary first row" fallback and no implicit "prefer custom when
present" rule. Adding a custom ESP to a managed team must not unexpectedly move
traffic away from the platform-funded route.

### Sending options

Add:

```text
GET /sending-options
GET /settings/delivery
PATCH /settings/delivery
```

`GET /sending-options` returns team-safe, read-only options:

```jsonc
{
    "items": [
        {
            "type": "managed",
            "name": "CourseLit Email Service",
            "fromName": "Jane Doe",
            "fromEmail": "no-reply@comm.courselit.app",
            "replyTo": "jane@school.example",
            "isDefault": true,
            "available": true,
            "managedBy": "CourseLit",
            "countsAgainstManagedQuota": true,
        },
        {
            "type": "custom",
            "espId": "esp_...",
            "name": "My Amazon SES",
            "fromName": "Acme School",
            "fromEmail": "hello@school.example",
            "isDefault": false,
            "available": true,
            "countsAgainstManagedQuota": false,
        },
    ],
}
```

It never returns `managedOutboxId`, provider identity, provider credentials,
secret references, internal IDs, or a managed provider account identifier. It
describes only the effective managed sending capability and sender identity
that the team would use. An unavailable option includes a stable reason such
as `managed_delivery_unavailable`, `entitlement_suspended`,
`sender_unverified`, or `quota_exhausted`; it does not reveal platform-outbox
health or topology.

`PATCH /settings/delivery` lets an authorized team caller change only fields
made editable by policy: an account member for an account-owned team, or the
embedding platform using the platform team's API key. Platform-owned
capability, quota, and managed-outbox assignment remain immutable here.

## Campaign, sequence, and transactional behavior

### Drafts

- A draft may store an explicit source preference.
- Selecting a foreign, disabled, or unavailable source returns `422`.
- A draft remains editable if its previously selected source later becomes
  unavailable; the availability problem is shown but does not corrupt the
  draft.
- Removing a source selection returns the draft to default resolution at
  activation.

### Broadcast and sequence activation

Activation performs, in one logical operation:

1. Validate team/platform sending status.
2. Resolve the explicit or default source.
3. Confirm route capability and source ownership.
4. Confirm managed entitlement or custom ESP availability.
5. Validate sender identity and required mailing address/footer rules.
6. Pin `deliveryRoute` and the corresponding outbox.
7. Create the automation rule and mark the sequence active.

Failure before step 7 leaves status and rules unchanged.

Managed quota is not reserved for the full matched audience at activation.
Audience membership and future sequence enrollment can change. One unit is
reserved per recipient immediately before that outbound message becomes
dispatchable.

If quota is exhausted during a broadcast or sequence:

- do not mark the recipient failed;
- set the work item to `quota_deferred`;
- schedule it for the earliest applicable UTC reset;
- expose the deferred count in reports/overview; and
- do not consume the normal transport retry budget.

A broadcast can therefore be partially accepted and partially deferred. The
UI/API must disclose this before activation with a non-binding audience/quota
estimate and while delivery is in progress with exact counts.

### Transactional email

`POST /emails` resolves the source and reserves managed quota before returning
`202`.

- If team quota is exhausted, return `429 managed_team_quota_exhausted`.
- If the platform pool is exhausted, return
  `429 managed_platform_quota_exhausted`.
- Include `Retry-After` for the earliest relevant reset.
- Do not create a transactional row or queue job when reservation fails.
- Idempotency lookup occurs before a new reservation. Replaying a successful
  idempotency key returns the original row and never reserves twice.
- A custom transactional send does not perform a managed quota check.

The transaction creating the transactional row, outbound row, reservation, and
queue outbox record must be crash-safe. If BullMQ enqueue remains external to
the database transaction, use the existing durable recovery/reconciliation
pattern so a committed message cannot be lost between PostgreSQL and Redis.

### Sender resolution

Managed sender resolution is:

```text
display name:
  team_delivery_settings.managedFromName
  -> team.name

email:
  managed_outboxes.fromEmail

reply-to:
  explicit per-message replyTo, when policy allows
  -> team_delivery_settings.managedReplyTo
  -> null
```

Every value is validated against CR/LF injection. Per-message Reply-To cannot
change the From identity. Platform policy may prohibit per-message Reply-To.

The fully formatted From value is snapshotted on the outbound message before
submission. Editing settings changes only future outbound rows.

### Route-specific worker behavior

Custom:

- load the pinned team `esp_configs` row;
- validate it still belongs to the team;
- use its cached transport/provider adapter;
- do not check or mutate managed quota; and
- fail closed if the pinned configuration is missing.

Managed:

- load the pinned managed outbox;
- validate it belongs to the team's platform customer;
- validate team, platform, outbox, entitlement, and reservation state;
- resolve the current credentials version;
- apply managed-outbox and team dispatch throttles;
- submit through the managed provider adapter;
- commit quota only after provider acceptance; and
- persist provider/feedback correlation on the outbound ledger.

Development environments may use a test adapter, but they must still validate
the route, ownership, capability, sender, and quota invariants.

## Platform management API

### Authentication boundary

Mount a dedicated router behind `requirePlatformAuth`, separate from
`requireAuth` and `requireTeam`. A platform key authenticates as exactly one
platform customer and does not become a team key implicitly.

Recommended route prefix:

```text
/platform
```

The API may retain `/provisioning/teams` as a compatibility alias during
migration, but new contracts use platform authentication and platform-scoped
resources.

### Team lifecycle routes

```text
POST   /platform/teams
GET    /platform/teams?externalId=<externalId>
GET    /platform/teams/:teamId
PATCH  /platform/teams/:teamId
POST   /platform/teams/:teamId/keys
POST   /platform/teams/:teamId/suspend
POST   /platform/teams/:teamId/resume
DELETE /platform/teams/:teamId
GET    /platform/teams/:teamId/usage
```

Lifecycle routes use SendLit's opaque public `teamId`. External IDs may contain
characters that are awkward or unsafe as path segments and are not globally
unique. The filtered GET provides recovery/lookup by the authenticated
platform's external ID.

Provision request:

```jsonc
{
    "externalId": "school_01J...",
    "name": "Acme School",
    "delivery": {
        "managedDeliveryEnabled": true,
        "customEspEnabled": false,
        "teamCanChangeDefault": false,
        "defaultDeliveryRoute": "managed",
        "managedOutboxId": "mob_...",
        "managedFromName": "Jane Doe",
        "managedReplyTo": "jane@school.example",
        "managedSenderEditable": true,
    },
    "managedQuota": {
        "dailyLimit": 500,
        "monthlyLimit": 10000,
    },
    "mailingAddress": "...",
}
```

Provision response:

```jsonc
{
    "created": true,
    "teamId": "team_...",
    "externalId": "school_01J...",
    "name": "Acme School",
    "apiKey": "sl_live_...", // only when a key was created
}
```

Provisioning invariants:

- The idempotency key is `(authenticated platform customer, externalId)`.
- Repeating an identical request returns the same team with `created: false`.
- A repeated request with immutable-field conflicts returns
  `409 provisioning_conflict` and a field list; it does not silently mutate.
- Mutable fields are changed through `PATCH`, not as side effects of an
  idempotent create retry.
- `apiKey` is shown only once. An idempotent replay cannot retrieve it.
- Creation of the platform-owned team, delivery settings, entitlement, mailing
  address, audit event, and API key hash is one database transaction.
- Provisioning creates no account or `team_members` row. It does not accept
  `ownerEmail`; workspace administrator identities remain in the embedding
  platform.
- A managed outbox in the request must belong to the authenticated platform
  customer.
- Limits cannot exceed platform/customer policy bounds.

`PATCH` supports:

- team name;
- sender display name and Reply-To;
- managed/custom capabilities;
- default route and managed outbox assignment;
- managed quota; and
- sending status.

Capability changes require:

```jsonc
{
    "transition": "drain", // drain | pause | cancel
}
```

when active/paused work is pinned to a route being disabled.

`POST /keys` creates a replacement team key and optionally revokes a named
existing platform-created key after the new plaintext has been returned.
Rotation is never implemented as "show existing key".

`DELETE` defaults to deprovisioning/soft deletion. Hard deletion requires an
explicit privileged parameter, zero active work, external media cleanup, an
audit record, and the existing cascade behavior.

### Managed outbox routes

```text
GET    /platform/outboxes
POST   /platform/outboxes
GET    /platform/outboxes/:managedOutboxId
PATCH  /platform/outboxes/:managedOutboxId
POST   /platform/outboxes/:managedOutboxId/test
POST   /platform/outboxes/:managedOutboxId/rotate-secret
POST   /platform/outboxes/:managedOutboxId/suspend
POST   /platform/outboxes/:managedOutboxId/retire
GET    /platform/outboxes/:managedOutboxId/feedback
PUT    /platform/outboxes/:managedOutboxId/feedback
```

Create/update accepts provider-specific credential input using a discriminated
contract. Responses expose only connection metadata, sender identity, status,
test result, credential presence/version, and feedback health.

Changing `fromEmail`, provider, or feedback identity on an active outbox
requires a verified test and an explicit transition. Secret rotation alone
does not.

### Platform key routes

Platform keys are created/revoked through an operator surface initially. If a
platform self-service surface is later added, it must require a stronger
platform-owner session; a platform API key cannot mint another key with scopes
it does not have.

### Team-facing authorization

Normal team REST/MCP routes enforce delivery settings:

- `/settings/esps` create/update/test/delete returns
  `403 custom_esp_disabled` when custom ESPs are disabled.
- Existing custom ESP rows may still be listed read-only when disabled so a
  future re-enable does not hide configuration unexpectedly.
- Sending with a managed outbox requires managed capability and entitlement.
- Team APIs cannot change quota, managed-outbox assignment, capability, platform
  status, platform affiliation, or locked sender fields.
- Account/session/OAuth middleware never enumerates platform-owned teams,
  because provisioning creates no account membership for them.
- Team-facing APIs expose only a generic managed capability; they never return
  `managedOutboxId` or managed-outbox CRUD/read surfaces.
- Team API keys remain scoped to one team and cannot call `/platform`.

When a platform later enables custom ESPs, its administrator continues using
the embedding platform's UI. The platform backend calls the team's existing
`/settings/esps` routes with that team's API key. Enabling BYO ESP therefore
does not require a SendLit account, email-OTP login, or human membership and
does not expose the platform-owned managed outbox.

## REST, OpenAPI, web client, and MCP

All REST schemas live in `@sendlit/api-contract`; OpenAPI remains generated
from the ts-rest contract. The OpenAPI wrapper adds a `PlatformApiKey` security
scheme and maps only `/platform/*` operations to it.

Required team-facing contract changes:

- delivery-source union on sequences, broadcasts, and transactional sends;
- `GET /sending-options`;
- `GET/PATCH /settings/delivery`;
- overview/usage fields for managed limits, accepted usage, reservations,
  remaining allowance, and next reset;
- delivery logs expose `managed | custom` and the public logical source, not
  provider credentials; team-facing managed logs expose `type: managed`
  without `managedOutboxId`; and
- stable documented errors and `Retry-After`.

Required MCP changes:

- add `list_sending_options`;
- allow `deliverySource` in create/update/start/send tools;
- add get/update delivery-default tools only for team-editable fields;
- make ESP tools explain and enforce `custom_esp_disabled`; and
- never expose platform management, managed credentials, secret references, or
  operator-only state.

Required web changes:

- show "Managed by <platform name>" as a read-only sending option;
- show managed quota separately from custom delivery;
- hide or disable custom ESP setup according to capability;
- when both are available, provide a default selector only if permitted;
- show the pinned source on draft, active, and historical delivery views;
- show quota-deferred recipient counts and reset time; and
- never label a managed outbox as a user ESP.

## Feedback, suppression, and reputation

Extend `esp_feedback_connections` rather than exposing managed connections
through team ESP APIs:

```text
scope              custom | managed
managed_outbox_id  uuid nullable FK
```

Constraints:

- `custom` requires `teamId` and `espConfigId`, and null
  `managedOutboxId`.
- `managed` requires `managedOutboxId`, and null `teamId`/`espConfigId`.
- A managed outbox has at most one non-retiring connection.
- Managed connection configuration/health is visible only to its platform
  customer and SendLit operators.

Managed webhook processing:

1. Select and authenticate the feedback connection from the opaque webhook
   URL and provider signature.
2. Durably store the raw receipt without assigning a team from request data.
3. Normalize provider events.
4. Correlate provider/RFC/SendLit message identifiers to one
   `outbound_messages` row already carrying a team and managed outbox.
5. Apply delivery projection and team-level suppression.

A provider payload, custom argument, or webhook query parameter must never be
trusted to select a team directly. Batches may contain events for several
teams; every event is correlated independently.

Team suppression remains route-independent. A complaint or hard bounce on a
managed send blocks later sends by that team through both managed and custom
routes, and vice versa.

Managed infrastructure also needs platform-level reputation controls:

- metrics per team, managed outbox, and platform customer;
- configurable warning/suspension thresholds for bounce and complaint rates;
- immediate platform-authorized and operator-authorized team suspension;
- provider account/global suppression awareness; and
- an audited review path before resuming a reputation-suspended team.

Platform-wide recipient suppression is a separate safety policy from
team-level suppression. If introduced, it must not expose that another
platform/team sent to the same address and must have its own privacy,
appeal/release, and audit design.

## Rate limiting and fairness

Four controls answer different questions:

1. **Platform API request rate**: key by `platformCustomerId`, with stricter
   limits on provisioning and secret changes than reads.
2. **Team API request rate**: retain team-keyed limits for transactional and
   resource APIs.
3. **Managed volume quota**: use the durable reservation model in this PRD.
4. **Provider dispatch throughput**: enforce a token bucket/concurrency limit
   keyed by `managedOutboxId`, plus a per-team concurrency ceiling.

A single high-volume team must not consume every worker slot or all provider
capacity. The managed scheduler should interleave ready teams within an outbox
and prioritize transactional work without permanently starving campaigns.
Provider `429`/throttle responses are retryable and do not commit quota until
acceptance.

Redis may coordinate short-lived dispatch tokens; PostgreSQL remains the source
of truth for entitlement, durable quota reservation, and delivery state.

## Audit, observability, and operations

Add an append-only platform audit log:

```text
platform_audit_events
  id                    uuid PK
  audit_event_id        text UNIQUE       -- aud_...
  platform_customer_id  uuid NOT NULL
  team_id               uuid nullable
  managed_outbox_id     uuid nullable
  actor_type            text NOT NULL     -- platform_key | account | operator | system
  actor_id               text/uuid nullable
  action                 text NOT NULL
  reason                 text nullable
  before                 jsonb nullable   -- secrets removed
  after                  jsonb nullable   -- secrets removed
  created_at             timestamptz
```

Audit at minimum:

- platform customer status changes;
- platform key create/revoke;
- team provision/deprovision;
- capability/default/entitlement/sender changes;
- team suspension/resumption;
- managed outbox create/provider/from/status changes;
- credential rotation without credential contents;
- feedback connection changes; and
- quota reservation reconciliation performed by an operator.

Metrics:

- managed accepted/failed/deferred/retried by team, platform, and outbox;
- custom vs managed route volume;
- quota reservation latency/conflicts/stale count;
- current reserved/accepted usage;
- queue lag and fairness by source type;
- provider latency, throttle, rejection, bounce, and complaint rates;
- feedback receipt verification/unmatched/dead-letter counts;
- outbox and platform suspension count; and
- platform API authentication/rate-limit failures.

Logs and analytics use internal/public opaque IDs, never provider credentials,
secret refs, full API keys, raw webhook secrets, or message content. Recipient
addresses follow the existing delivery-feedback redaction and retention policy.

Operational runbooks are required for:

- compromised platform key;
- compromised managed provider credential;
- sender-domain verification loss;
- provider outage or throttling;
- platform/team quota dispute;
- stale reservation reconciliation;
- abnormal bounce/complaint rate;
- noisy-neighbor team;
- outbox retirement/provider migration; and
- platform customer closure.

## Security and privacy requirements

- Platform keys are hashed, scoped, revocable, rate-limited, and excluded from
  logs.
- Managed provider secrets are encrypted with a key separate from custom ESP
  encryption, or referenced from an approved secrets manager.
- Team keys cannot authorize platform operations.
- Every platform query includes authenticated `platformCustomerId`; every team
  query retains `teamId`.
- External IDs are treated as identifiers, not secrets.
- Platform callers cannot select a foreign `managedOutboxId`, `teamId`, or
  external ID through body tampering.
- Team callers cannot enable capabilities or increase quota.
- Supplying `ownerEmail`, administrator email, or any other external identity
  must never create an account, membership, session grant, or OAuth grant for a
  platform-owned team.
- Platform-owned teams have no human memberships in v1 and are absent from
  account team lists, team pickers, dashboard routes, and OAuth consent.
- Team-facing sending-option, settings, delivery, and MCP responses never
  return `managedOutboxId`, provider identity, secret state, connection health,
  or platform-outbox metadata. Effective From address and platform display name
  are not secrets and may be returned where needed to compose/send.
- From display name, email, Reply-To, subject, and headers reject CR/LF and
  invalid addresses.
- Managed From domains must be verified before activation and rechecked
  periodically where the provider supports it.
- Provider metadata contains only opaque SendLit correlation IDs, not recipient
  PII or external tenant identifiers.
- Webhook correlation never trusts a caller-supplied team ID.
- A future delegated-human-access feature must require an explicit invitation,
  auditable acceptance, and a separately defined least-privilege view. It must
  not retroactively treat stored external emails as memberships.
- Data export/deletion remains team-scoped. Platform deprovisioning must
  document retention and erasure timing.
- Cross-platform isolation tests are mandatory for every CRUD, delivery,
  usage, feedback, and audit query.

## Failure semantics and error codes

Stable errors:

| Status | Code                               | Meaning                                             |
| ------ | ---------------------------------- | --------------------------------------------------- |
| 400    | `invalid_delivery_source`          | Malformed or conflicting selection                  |
| 401    | `invalid_platform_key`             | Missing/invalid/revoked platform key                |
| 403    | `platform_scope_required`          | Platform key lacks the operation scope              |
| 403    | `custom_esp_disabled`              | Team policy forbids custom ESP use/admin            |
| 403    | `managed_delivery_disabled`        | Team lacks managed capability                       |
| 403    | `team_sending_suspended`           | Platform/operator suspended the team                |
| 404    | `managed_outbox_not_found`         | Missing or foreign outbox                           |
| 409    | `delivery_source_in_use`           | Unsafe disable/delete without transition            |
| 409    | `provisioning_conflict`            | External ID exists with conflicting immutable input |
| 422    | `delivery_source_required`         | Multiple routes exist with no resolvable default    |
| 422    | `custom_esp_not_configured`        | Custom route selected without usable ESP            |
| 422    | `managed_outbox_unavailable`       | Assigned managed source cannot currently send       |
| 422    | `managed_sender_unverified`        | From identity is not verified                       |
| 429    | `managed_team_quota_exhausted`     | Team bucket has no capacity                         |
| 429    | `managed_platform_quota_exhausted` | Aggregate platform pool has no capacity             |

Provider throttle/outage after enqueue is represented in delivery state and
worker retry behavior, not returned as an unrelated team API error.

## Migration and compatibility

### Schema migration

1. Create platform-customer, platform-key, managed-outbox, delivery-settings,
   entitlement, quota, reservation, and audit tables.
2. Add ownership type, nullable platform affiliation, and status columns to
   teams; make `ownerAccountId` nullable under the ownership check.
3. Replace the global unique constraint on `teams.externalId` with scoped
   partial/composite indexes.
4. Add `managedOutboxId` to route-bearing and outbound tables.
5. Rename reserved `platform` enum/schema values to `managed`.
6. Extend feedback connections with managed-outbox scope.
7. Backfill account-owned teams as standalone custom-only. Platform migration
   is an explicit later step because it changes human access.
8. Keep current custom route/outbox values unchanged.
9. Leave account quota fields temporarily readable but stop using them for
   delivery. Remove them only after overview/web/API callers migrate.

Migrations must be additive and safe for a rolling deployment:

- old application versions must not write a route value new workers cannot
  understand;
- workers deploy with dual-read compatibility before producers emit
  `managed`;
- constraints become strict only after backfill;
- indexes are created in the repository's production-safe migration style; and
- rollback never converts a managed send into custom.

### Existing provisioning

Create an internal "Legacy provisioning" platform customer during migration
when teams with non-null `externalId` already exist. Backfill those teams to
that customer so their external IDs remain idempotent.

Before converting an existing provisioned team to `ownership_type = platform`:

1. Verify the embedding platform has stored a working team API key.
2. Remove that team's `team_members` rows and clear `ownerAccountId` in the
   same transaction that assigns platform ownership.
3. Do not delete the former account; it may own unrelated standalone teams.
4. Verify the former account can no longer enumerate, select, or authorize the
   migrated team.
5. Record an audit event containing account ID and team ID, but no email.

This access removal is intentional and must not be hidden inside a generic
backfill. It requires a migration report and platform-by-platform confirmation.

During a time-bounded compatibility window:

- `X-Sendlit-Provisioning-Secret` maps to the legacy platform customer;
- `/provisioning/teams` retains its current response contract;
- the compatibility schema may continue accepting `ownerEmail`, but the value
  is ignored/deprecated and never creates an account or membership;
- new platform-only fields are unavailable through the compatibility route;
- warnings/metrics identify remaining legacy calls; and
- documentation directs callers to platform keys and `/platform/teams`.

Remove global-secret provisioning only after all consumers have a platform key
and stored platform association.

### API compatibility

- Existing standalone custom-only sends behave exactly as before.
- Existing `espId` request fields continue as the custom selection alias.
- Existing ESP REST/MCP routes remain custom-only.
- Public `platform` delivery values were never enabled; rename them before
  managed delivery launches. If any pre-production rows contain the reserved
  value, migrate them explicitly and verify ownership rather than blindly
  renaming.
- Account overview quota fields are deprecated and replaced with managed usage
  fields. Custom-only teams show managed delivery as unavailable, not a
  misleading unused allowance.

## Rollout plan

### Phase 0: terminology and foundations

- Approve this PRD and update conflicting future-route language in adjacent
  docs.
- Add route types/checks and dual-read compatibility.
- Add platform customer/auth/audit tables.
- Backfill standalone and legacy-provisioned teams.

### Phase 1: platform-scoped provisioning

- Implement platform keys and `requirePlatformAuth`.
- Add provision/read/update/key-rotation/suspend/deprovision routes.
- Add scoped external-ID uniqueness and tenant-isolation tests.
- Migrate CourseLit or the first pilot from the global secret.

### Phase 2: managed outboxes

- Add managed-outbox CRUD, secret handling, provider adapter, verification,
  status lifecycle, and test sends.
- Extend feedback connections and outbound correlation.
- Do not enable team traffic until provider feedback and operational alerts are
  healthy.

### Phase 3: hybrid routing

- Add team delivery settings and sending-options APIs.
- Update sequence, broadcast, transactional, worker, REST, MCP, and web
  selection behavior.
- Enable managed-only pilot teams.
- Validate custom-only regression behavior.

### Phase 4: quota and fairness

- Add entitlements, atomic reservations, buckets, reconciliation, usage APIs,
  deferral, reset scheduling, and managed dispatch limits.
- Remove delivery dependence on account quota.
- Load-test concurrent reservation and noisy-neighbor behavior.

### Phase 5: custom-ESP opt-in for platform teams

- Enforce platform capability in team ESP routes/UI.
- Allow selected managed teams to become hybrid.
- Add default selection, transition handling, audit, and pinned-route
  regression tests.

### Phase 6: general availability

- Complete runbooks, dashboards, alerts, retention jobs, platform documentation,
  and support tooling.
- Remove the legacy provisioning secret after measured zero usage.
- Review account quota column removal.

Every phase is feature-flagged by platform customer and managed outbox. No
managed route becomes the implicit default for existing teams.

## Test plan

### Data and migration

- Existing standalone teams backfill custom-only without sender, route, key, or
  ESP changes.
- Existing external IDs move to the legacy platform customer without
  collision.
- Two platform customers can use the same external ID.
- The same platform customer cannot provision the same external ID twice.
- Route check constraints reject mixed custom/managed outbox references.
- Foreign platform/outbox/team relationships fail at query and database
  boundaries.
- Rolling-deploy compatibility reads old and new route values safely.

### Platform authentication and lifecycle

- Valid platform keys access only permitted scopes and their own resources.
- Revoked, expired, malformed, and wrong-scope keys fail consistently.
- Body/header tampering cannot change the authenticated platform.
- Concurrent provisioning of one external ID creates one team and one initial
  key.
- Idempotent replay does not return or create another plaintext key.
- Key rotation returns one new secret and revokes exactly the requested key.
- Suspend/resume/deprovision transitions are audited and idempotent.
- Provisioning any email-shaped metadata creates no account or membership.
- A platform-owned team has zero human memberships and cannot be enumerated,
  selected, or authorized by an account/OAuth session.
- An account whose verified email equals the embedding platform's external
  owner/admin email receives no access, including with case/normalization
  variants or an explicit `X-Sendlit-Team-Id`.
- Migrating an existing team removes only that team's former memberships and
  does not affect the account's unrelated teams.

### Capability and routing matrix

Cover managed-only, custom-only, and hybrid teams for transactional,
broadcast, and sequence paths:

- explicit eligible managed source;
- explicit eligible custom source;
- default managed;
- default custom;
- no default with one eligible route;
- no default with two eligible routes;
- foreign/missing/suspended source;
- adding the first custom ESP to a managed team;
- disabling a route using drain/pause/cancel;
- changing defaults after activation;
- deleting or retiring a pinned source; and
- retries after settings/provider/default changes.

Workers must always use the pinned source and never fallback.

### Sender identity

- Managed From email always comes from the managed outbox.
- Display-name/Reply-To edit permissions follow platform policy.
- Team and per-message input cannot spoof another From address.
- Custom sender behavior remains unchanged.
- CR/LF and malformed-address inputs are rejected.
- Historical outbound rows retain the resolved sender after settings change.

### Quota

- Custom sends do not read, reserve, increment, or decrement managed quota.
- Managed transactional requests reserve once and idempotent replays reserve
  zero additional units.
- Daily and monthly limits are both enforced.
- Team and aggregate platform limits are enforced atomically.
- Hundreds of concurrent requests at the final remaining unit accept exactly
  one unit and never overshoot.
- Provider acceptance commits; pre-acceptance terminal failure releases.
- Retry reuses a reservation; later bounce/complaint does not refund.
- Suppression before transport releases.
- Day/month UTC boundaries create new buckets correctly.
- Campaign/sequence work defers without consuming retry attempts and resumes at
  reset.
- Reconciliation repairs every simulated crash point without double release or
  double commit.

### Managed provider and feedback

- Secret create/rotation never returns or logs plaintext.
- Outbox credential/provider changes invalidate transport caches safely.
- Managed feedback authenticates and correlates events across several teams in
  one batch.
- No provider payload can select a team without an outbound match.
- Out-of-order, duplicate, unmatched, delayed, and retiring-connection events
  preserve existing feedback guarantees.
- Managed hard bounce/complaint suppresses later custom sends and custom
  feedback suppresses later managed sends for the same team/address.
- Outbox suspension stops new dispatch but continues feedback ingestion.

### Fairness, reliability, and load

- One team cannot monopolize all managed outbox concurrency.
- Transactional priority does not permanently starve campaigns.
- Provider throttle responses back off without committing quota.
- PostgreSQL failure, Redis outage, worker crash, duplicate enqueue, and stale
  jobs recover without duplicate provider submissions.
- Load tests meet agreed throughput and p95 latency for provisioning, quota
  reservation, dispatch, and webhook acknowledgement.

### Contract and documentation

- ts-rest contract, OpenAPI, REST handlers, web client, and MCP schemas agree.
- Platform routes use only the `PlatformApiKey` security scheme.
- Team routes cannot be called with a platform key unless explicitly designed.
- Team-facing managed sending-option and delivery-source fixtures contain no
  `managedOutboxId`, provider, credential-state, or connection-health fields.
- Examples contain public IDs only and never credentials.
- Adjacent PRDs and API README no longer describe managed delivery as one
  deployment-wide provider or account quota.

Implementation verification commands:

```bash
pnpm --filter @sendlit/api test
pnpm --filter @sendlit/api typecheck
pnpm --filter @sendlit/api build
pnpm --filter @sendlit/api-contract test
pnpm --filter @sendlit/web typecheck
pnpm lint
pnpm prettier
```

## Acceptance criteria

The feature is production-ready when:

1. Several platform customers can coexist with no cross-platform provisioning,
   outbox, team, usage, feedback, audit, or secret access.
2. Two platform customers can provision the same external ID while one
   platform customer receives one idempotent team for repeated requests.
3. A managed outbox is configured once and serves entitled teams without
   copying credentials into `esp_configs`.
4. Existing custom-only teams send exactly as before and never consume managed
   quota.
5. Managed-only, custom-only, and hybrid teams resolve the documented source
   for transactional, broadcast, and sequence delivery.
6. Adding a custom ESP to a managed team does not change its default
   implicitly.
7. Every queued/active send is pinned, and no failure/retry silently changes
   route or logical outbox.
8. Platform-owned teams have no implicit human membership or account/OAuth
   access. Supplying or authenticating as an external administrator email
   reveals no team or managed-outbox information.
9. Team-facing REST/MCP responses expose only effective managed capability and
   sender information, never `managedOutboxId`, provider identity, credentials,
   connection health, or outbox administration. Team API keys cannot mutate
   managed outboxes, capabilities, affiliation, or quota.
10. Managed From addresses are platform-controlled, verified, and immune to
    per-message spoofing.
11. Team and optional platform quotas cannot be exceeded under concurrent load;
    retries and idempotency do not double-count.
12. Custom delivery bypasses managed quota consistently across all sending
    paths.
13. Quota-deferred campaign work is observable and resumes at the correct UTC
    reset without being marked failed.
14. Managed feedback is authenticated and derives team only from a matched
    outbound row.
15. Suppression remains team-wide and route-independent.
16. Platform/team/outbox suspension and deprovisioning are immediate,
    idempotent, recoverable where documented, and audited.
17. Secret values never appear in API reads, logs, analytics, audit snapshots,
    error monitoring, or fixtures.
18. Managed provider health, feedback health, quota, queue lag, throttling,
    bounce/complaint rate, and stale reservations have dashboards and alerts.
19. OpenAPI, MCP, web behavior, API docs, migration notes, and runbooks match
    the shipped implementation.
20. CourseLit can launch managed-only schools and later enable custom ESPs on
    the same teams without data migration or historical rewrite.
21. A second unrelated platform customer can onboard without adding
    product-specific conditions to team, ESP, or worker code.

## Risks and mitigations

| Risk                                             | Mitigation                                                                        |
| ------------------------------------------------ | --------------------------------------------------------------------------------- |
| CourseLit-specific logic leaks into core routing | Generic platform customer, managed outbox, capability, and entitlement resources  |
| Shared platform key compromises every platform   | One scoped/revocable key set per platform; optional multiple least-privilege keys |
| Platform credential copied into every team       | Store once on managed outbox or in secrets manager                                |
| Team uses another platform's outbox              | Platform ownership checks in API, resolver, worker, and DB constraints            |
| Same external ID collides across platforms       | Composite platform/external-ID uniqueness                                         |
| Owner with multiple teams shares quota           | Team entitlement and scoped usage buckets, never account counters                 |
| Concurrent sends exceed quota                    | Atomic reservation across all applicable buckets                                  |
| Retry consumes quota twice                       | One reservation per outbound message and idempotent state transitions             |
| Custom ESP unexpectedly replaces managed default | Explicit team default; adding ESP never changes route                             |
| Broken custom ESP silently spends platform quota | Fail-closed pinned routes; no cross-route fallback                                |
| Provider rotation breaks queued work             | Stable logical managed outbox; resolve current credential version at send         |
| Provider rotation loses late feedback            | Retiring feedback connections remain ingestible through retention window          |
| Shared provider creates noisy neighbor           | Outbox token bucket, per-team concurrency, fair scheduling, aggregate limits      |
| Abusive team damages managed reputation          | Per-team telemetry, thresholds, suspension, suppression, audit, runbook           |
| Team spoofs managed sender                       | Platform-controlled verified From, validated editable display/Reply-To only       |
| Provider webhook assigns wrong team              | Authenticate connection and correlate only through outbound ledger                |
| External owner email grants SendLit access       | Platform owns the team; no account/membership is created from email               |
| OAuth exposes a platform-owned workspace         | Platform teams have no human memberships and are excluded from account auth paths |
| Deprovision deletes data unexpectedly            | Soft deprovision by default; explicit audited hard-delete workflow                |
| Legacy provisioning breaks during rollout        | Legacy platform backfill, compatibility alias, usage metrics, staged removal      |
| Route terminology remains ambiguous              | Rename unused reserved `platform` route to `managed` before launch                |

## Open questions requiring product/operator decisions

These do not change the core architecture, but must be resolved before the
relevant phase ships:

1. Which managed providers are supported first, and which have complete
   outbound plus feedback adapters?
2. Does the first platform customer store provider credentials in SendLit's
   encrypted database or an external secrets manager?
3. What default daily/monthly limits and aggregate platform limits apply to the
   pilot?
4. May team administrators edit managed display name and Reply-To, or must the
   platform own both?
5. When CourseLit enables custom ESPs, may teams change the default themselves,
   or does CourseLit retain default-route control?
6. What drain window applies when a managed outbox is retired or a capability
   is disabled?
7. What retention period applies after platform deprovisioning?
8. What bounce/complaint thresholds automatically suspend a team or managed
   outbox?
9. Does v1 expose aggregate platform usage only through API, or also through a
   dedicated platform dashboard?
10. Which operator identity and approval flow may hard-delete a platform team
    or close a platform customer?

## Assumptions

- Platform customers are trusted server-to-server integrators but are still
  mutually untrusted tenants.
- One team belongs to at most one platform customer.
- One managed outbox belongs to exactly one platform customer and may serve
  many of that customer's teams.
- A managed-enabled team is assigned exactly one managed outbox in v1, while a
  platform customer may own several and assign different teams to different
  outboxes.
- Teams continue to own their custom ESP configurations.
- Managed delivery is paid/metered by SendLit or the platform customer; custom
  delivery is paid to the team's provider.
- Provider acceptance, not final inbox delivery, is the billable/countable
  managed event.
- Calendar UTC quota windows are acceptable for v1.
- The existing outbound ledger, feedback inbox, delivery projection, and
  suppression system remain the foundation.
- Existing unrelated working-tree changes are preserved.
