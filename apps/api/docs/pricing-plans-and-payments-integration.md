# PRD: Pricing plans, entitlements, and payments integration

_Status: implementation-ready product and architecture specification. Date:
2026-08-28. Owners: SendLit API, Web, and Operations. Initial payment provider:
Dodo Payments. Source of truth: the SendLit pricing specification in
`product-marketing/sendlit/pricing.md`._

## Executive summary

SendLit will offer four plans:

- **OSS**: the full self-hosted product, with no SendLit plan limits or
  checkout;
- **Free**: managed cloud, one team, 1,000 subscribed contacts, and 3,000
  sends per calendar month;
- **Pro**: managed cloud at the configured monthly or yearly price, with up to
  five teams, 10,000 subscribed contacts, and shared organization mailboxes;
  and
- **Business**: managed cloud at the configured monthly or yearly price, with
  up to 25 teams, no published contact cap, shared organization mailboxes, and
  the provisioning API.

Billing belongs to an **organization**. A login is never billed, team and
organization members are never seats, and each paid organization has its own
subscription. A user can be invited to any number of organizations without
being charged.

Dodo Payments is the first card, tax, invoice, checkout, and portal provider.
Provider-specific SDK types, product IDs, webhook payloads, and status names
must remain inside a billing-provider adapter. SendLit owns the canonical plan
catalog, entitlement decisions, usage counters, grace-period behavior, and
organization billing projection. Replacing Dodo with Stripe, Lemon Squeezy,
Paddle, Polar, or another provider must not require changing domain policy or
product-facing API contracts.

Plan enforcement will be centralized, but not implemented only as Express
middleware. REST middleware can resolve and attach an organization plan, but
MCP tools and background workers do not traverse Express, and capacity limits
must be checked in the same database transaction as the protected write. The
durable design is:

```text
                     ┌───────────────────────────┐
REST ─ auth/context ─┤                           │
MCP ─ auth/context ──┤ Entitlement/policy engine ├─ domain guards ─ DB writes
Workers ─ team/org ──┤                           │                 or transport
                     └───────────────────────────┘
                               ▲
                               │
                  canonical plan + payment state
```

REST uses thin middleware over this engine for coarse feature gates and a
consistent error response. Every protected domain mutation and final send
boundary uses the same engine directly. This keeps pricing policy in one place
without creating REST-only bypasses or race-prone count checks.

## Goals

1. Make every cloud organization Free, Pro, or Business and every self-hosted
   installation effectively OSS.
2. Implement organization-scoped checkout, subscription lifecycle, billing
   portal access, trials, payment recovery, and cancellation without billing
   accounts or teams.
3. Enforce all published plan capabilities and capacity limits consistently
   across REST, MCP, dashboard actions, provisioning, automations, and workers.
4. Keep plan definitions and policy decisions independent from Dodo product
   objects and webhook vocabulary.
5. Preserve data on downgrade and provide stable, actionable limit errors with
   organization-specific upgrade links.
6. Reuse one provider customer for later checkouts by the same authenticated
   payer while keeping one subscription per paid organization.
7. Make webhook processing signed, idempotent, replay-safe, and repairable by
   reconciliation.
8. Give organization owners a clear plan, usage, upgrade, and billing workflow
   in the existing Organizations area.
9. Preserve complete OSS functionality only under explicit OSS deployment
   mode, without requiring a cloud billing provider.

## Non-goals

- Charging per email on Pro or Business
- Selling extra team or contact packs
- Charging per user, member, or seat
- Building a SendLit invoice, tax, card, or payment-method UI
- Adding Platform, Enterprise, or another public plan
- Including the later SendLit Send delivery product
- Licensing or remotely restricting OSS installations
- Making provider product data the entitlement source of truth
- Exposing checkout, portal, invoices, or payment methods through MCP
- Supporting multiple simultaneous active subscriptions for one organization

## Locked product decisions

### Billing boundary

- The organization is the plan, subscription, usage, and entitlement boundary.
- Each paid organization has one subscription. Two Pro organizations cost
  twice the configured Pro price for the selected interval.
- A team inherits its parent organization's effective plan. Teams are never
  individually billed.
- The authenticated user who starts checkout is the billing manager/payer for
  that subscription. This is separate from organization membership.
- Organization members and team members remain unlimited and free on every
  plan.
- Invited organization membership does not count toward the one-Free-org rule.

### Catalog

| Policy                                            |               OSS |        Free |        Pro |         Business |
| ------------------------------------------------- | ----------------: | ----------: | ---------: | ---------------: |
| Deployment                                        |       Self-hosted |       Cloud |      Cloud |            Cloud |
| Monthly price                                     |                $0 |          $0 | Configured |       Configured |
| Yearly price                                      |                $0 |          $0 | Configured |       Configured |
| Teams                                             |         Unlimited |           1 |          5 |    25 by default |
| Subscribed contacts per organization              |         Unlimited |       1,000 |     10,000 | No published cap |
| SendLit send charge                               |              None |        None |       None |             None |
| Cloud send allowance                              | Unlimited locally | 3,000/month |   Fair use |         Fair use |
| Team ESP                                          |               Yes |         Yes |        Yes |              Yes |
| Shared organization mailbox and grants            |               Yes |          No |        Yes |              Yes |
| Provisioning and organization API keys            |               Yes |          No |         No |              Yes |
| Sequences, transactional, REST, MCP, React blocks |               Yes |         Yes |        Yes |              Yes |
| “Sent with SendLit” on marketing mail             |               Off |          On |        Off |              Off |

Business `teamsLimitOverride` and `contactsLimitOverride` support negotiated
capacity without creating a fifth plan or an add-on catalog. A null contact
limit means no published product cap, not permission to exhaust storage.

### Prices, intervals, and trials

| Catalog key      | Amount source                         | Trial                    |
| ---------------- | ------------------------------------- | ------------------------ |
| `pro_month`      | `BILLING_PRO_MONTH_AMOUNT_MINOR`      | 14 days                  |
| `pro_year`       | `BILLING_PRO_YEAR_AMOUNT_MINOR`       | None; charge immediately |
| `business_month` | `BILLING_BUSINESS_MONTH_AMOUNT_MINOR` | None                     |
| `business_year`  | `BILLING_BUSINESS_YEAR_AMOUNT_MINOR`  | None; charge immediately |

- Paid amounts and currency are deployment configuration, not code constants.
  Amounts use positive integer minor units; never parse money from floating
  point or a preformatted string.
- The client reads the active offers from SendLit's billing-catalog endpoint.
  It never contains plan amounts or provider product IDs in the bundle and
  never supplies an authoritative amount to checkout.
- The server resolves canonical `plan` and `interval` plus catalog revision to
  the configured amount, currency, and provider product ID.
- Changing a price requires updating the payment-provider product, its product
  ID/amount environment values, and the monotonically increasing catalog
  revision. It does not require a source-code change.
- The Pro monthly trial can be redeemed once per verified SendLit account and
  normalized verified email. Eligibility is reserved atomically when checkout
  starts and becomes permanently redeemed when the provider creates a
  `trialing` or `active` subscription. Changing the account email does not
  restore eligibility.
- SendLit owns the upgrade, downgrade, and billing-interval-change experience.
  The provider remains responsible for charging the stored payment method,
  tax, invoices, and payment failures. SendLit calls the provider's
  subscription API through its adapter and never requires a provider portal
  for a plan change. Cancellation, invoice payment, and card updates remain in
  the provider portal.
- An upgrade (including a move from monthly to yearly) takes effect
  immediately with the provider's supported proration policy. A downgrade
  (including yearly to monthly) takes effect at the next billing date by
  default. SendLit persists the requested transition and does not change
  entitlements until a verified provider snapshot confirms it.
- SendLit changes effective paid entitlements only from a verified webhook or
  provider reconciliation result, never from a checkout return URL.

### One owned Free organization

- Creating an active Free organization or becoming an owner of one is allowed
  only when the user does not already own an active Free organization.
- Admin/member invitations do not count. Promoting an invited user to `owner`
  does count and uses the same policy guard.
- A second organization can be created through a paid checkout flow. Until
  payment or trial activation is confirmed, it is `pending_payment`, cannot
  send, and does not count as the user's Free organization.
- Provider-driven cancellation or expiry must never fail and must never delete
  data. It may leave a user owning more than one downgraded Free organization.
  This is the deliberate non-retroactive exception to the creation rule: the
  user cannot create or acquire another Free organization, but existing paid
  data is not frozen merely to enforce the signup anti-farming rule.
- Pending-payment organizations must not create a default team until
  activation. After every checkout attempt has expired, they may be marked
  `abandoned` and hidden from the normal organization picker, but the row and
  checkout correlation records are retained. A late provider event must never
  activate a tombstoned or reassigned organization; it is quarantined for
  operator review and the provider subscription is cancelled/refunded through
  an explicit support workflow when appropriate.

### Downgrades

- Downgrades never delete organizations, teams, contacts, ESP configurations,
  grants, templates, sequences, or logs.
- Teams in `active` or `sending_suspended` status count toward the team cap;
  archived teams do not. An over-limit organization cannot create another
  team.
- Every subscribed contact in the organization counts, including contacts in
  archived teams. The same email in two teams counts twice. Transactional-only
  recipients are not contacts and do not count.
- When subscribed contacts exceed the effective cap, existing contacts remain
  available for export, unsubscribe, and deletion. New subscribed contacts,
  re-subscription, subscribed-contact imports, new sequence enrollment, and
  marketing sends are blocked until usage is below the cap or the organization
  upgrades. Transactional sends to transactional-only recipients continue.
- On downgrade to Free, existing shared mailboxes and grants remain stored and
  readable but cannot be created, changed, activated, granted, or used for a
  new send. Team ESP delivery remains available.
- On Business to Pro, all mutating provisioning operations stop immediately.
  Existing organization keys remain stored so they can be audited/revoked, but
  authentication through them does not bypass the plan.
- A cancellation scheduled for period end retains paid entitlements through
  `currentPeriodEndsAt`. At expiry, the organization becomes Free.

### Payment failure

- `past_due` starts a seven-day grace period and notifies the billing manager
  and organization owners.
- Paid plan features remain available during grace.
- If payment has not recovered when `graceEndsAt` passes, all new marketing
  and transactional sends stop at both acceptance and worker boundaries.
  Reads, exports, cleanup, billing management, and plan recovery remain
  available.
- Recovery before or after the deadline restores sending without data
  migration.

## Current platform baseline

The implementation must extend, not replace, these existing boundaries:

- `organizations` is already the durable customer boundary above teams.
- `organization_members` and `team_members` are independent authorization
  relationships.
- `POST /organizations/:organizationId/teams`, `POST /teams`, MCP
  `create_team`, and `POST /provisioning/teams` are separate team-creation
  paths that currently call the same team query layer.
- Organization ESPs, grants, delivery policies, scoped organization keys, and
  the provisioning lifecycle already exist.
- Team resource routers use `requireAuth` and `requireTeam`.
- REST request/response schemas live in `packages/api-contract`; those
  contracts validate the API, generate OpenAPI, and power the web client.
- MCP tools call domain/query functions directly and therefore do not pass
  through REST middleware.
- `outbound_messages` is already a common per-recipient ledger for campaigns,
  sequences, and transactional sends.
- Organization-ESP quota reservations already demonstrate the required atomic
  reserve/commit/release pattern.
- Bounce and complaint receipts, normalized events, suppressions, and pinned
  delivery sources already exist, but automated reputation-plan enforcement
  does not.
- The Account page currently contains a Free-plan billing placeholder. This is
  incorrect because accounts are not billed.
- The Organizations page is the existing organization/team management
  surface. Plan and upgrade controls belong there, including the action shown
  on each team item; the action always upgrades that team's parent
  organization.

## Canonical plan and entitlement model

### Plan catalog

Create one provider-neutral catalog in `apps/api/src/billing/plans.ts` (or an
equivalent module):

```ts
type PlanId = "oss" | "free" | "pro" | "business";
type BillingInterval = "month" | "year";
type PaymentStatus =
    | "free"
    | "checkout_pending"
    | "trialing"
    | "active"
    | "past_due"
    | "cancel_at_period_end"
    | "cancelled"
    | "expired";

type PlanPolicy = {
    teamsLimit: number | null;
    subscribedContactsLimit: number | null;
    monthlySendsLimit: number | null;
    sharedOrganizationMailbox: boolean;
    provisioning: boolean;
    organizationApiKeys: boolean;
    marketingBranding: boolean;
    fairUse: boolean;
};

type BillingOffer = {
    catalogKey: "pro_month" | "pro_year" | "business_month" | "business_year";
    catalogRevision: number;
    plan: "pro" | "business";
    interval: BillingInterval;
    currency: string;
    amountMinor: number;
    provider: BillingProviderId;
    providerProductId: string;
    trialDays: number;
};
```

Plan policy, default limits, grace duration, ramp limits, and abuse thresholds
must be exported from this domain catalog or its adjacent policy configuration.
They must not be duplicated in routes, React components, MCP tools, workers,
or a Dodo adapter.

`BillingOffer` is loaded from validated deployment configuration through a
provider-neutral catalog loader. It is not declared as a literal array with
amounts in TypeScript. Provider IDs remain private even though the public API
returns the other display fields.

`PaymentStatus` is a public presentation value derived from checkout attempts,
the current subscription, `cancelAtPeriodEnd`, and time boundaries. It is not
a provider status or a database state machine; in particular,
`cancel_at_period_end` is derived while the underlying subscription remains
`active` or `trialing`.

Current provider catalog mappings and amounts are separate, versioned
configuration:

```text
pro_month       -> BILLING_PRO_MONTH_AMOUNT_MINOR       + DODO_PRO_MONTH_PRODUCT_ID
pro_year        -> BILLING_PRO_YEAR_AMOUNT_MINOR        + DODO_PRO_YEAR_PRODUCT_ID
business_month  -> BILLING_BUSINESS_MONTH_AMOUNT_MINOR  + DODO_BUSINESS_MONTH_PRODUCT_ID
business_year   -> BILLING_BUSINESS_YEAR_AMOUNT_MINOR   + DODO_BUSINESS_YEAR_PRODUCT_ID
```

Startup validation must reject cloud mode when any required product ID, API
key, price amount, currency, or webhook key is missing/invalid, when the
catalog revision is not a positive integer, or when two catalog keys map to
the same provider product unexpectedly. Keep reverse mappings for every product ID
referenced by a nonterminal or retained subscription, including products from
a provider no longer used for new checkout. A catalog mapping must not be
removed until no subscription or webhook reconciliation can reference it.

### Effective plan resolution

`getOrganizationEntitlements(organizationId)` returns one canonical snapshot:

```ts
type OrganizationEntitlements = {
    organizationId: string;
    plan: PlanId;
    interval: BillingInterval | null;
    paymentStatus: PaymentStatus;
    teamsLimit: number | null;
    subscribedContactsLimit: number | null;
    monthlySendsLimit: number | null;
    sharedOrganizationMailbox: boolean;
    provisioning: boolean;
    organizationApiKeys: boolean;
    marketingBranding: boolean;
    canSend: boolean;
    graceEndsAt: Date | null;
};
```

Resolution rules:

1. `SENDLIT_DEPLOYMENT_MODE=oss` is the only way to enter OSS mode. Every
   organization resolves to OSS and provider checkout, portal, webhooks, and
   all plan limits are disabled.
2. `SENDLIT_DEPLOYMENT_MODE=cloud` is the only way to enter cloud mode. An
   organization without a current entitlement-bearing subscription resolves
   to Free.
3. `trialing`, `active`, and `past_due` before the grace deadline retain the
   selected paid plan. `cancelAtPeriodEnd` is an attribute, not a status.
4. `past_due` after grace retains the paid feature shape for display but sets
   `canSend` false.
5. A `cancelled` subscription retains paid entitlements only when
   `cancelAtPeriodEnd` is true and the verified `paidThroughAt` is still in
   the future. Immediate cancellation (`cancelAtPeriodEnd=false`) drops paid
   access immediately even if a future `paidThroughAt` remains. `expired`
   grants none. The plan projection then resolves to Free.
6. Limit overrides replace only their named limit and never enable another
   plan's capabilities.

Deployment mode is deliberately not inferred from `NODE_ENV`, a missing API
key, or the presence of a provider variable. Startup fails closed when the
mode is absent, when OSS mode has a checkout provider configured, or when
cloud mode lacks a valid checkout provider, enabled-provider set, credentials,
webhook keys, or complete product catalog. Cloud always enforces plan gates;
it must never silently fall back to OSS or Free semantics.

The database projection is the low-latency entitlement source. Do not call the
payment provider during an ordinary API request or worker job. Webhooks and a
reconciliation process update the projection.

V1 uses request/job-local memoization only, not a process-local entitlement
cache. If a distributed cache is added later, entries must be keyed/versioned
by `projection_version`, invalidated after transaction commit, bounded to 30
seconds, and bypassed at the final send boundary. Deadline, bucket, lease, and
paid-through comparisons use PostgreSQL UTC time so API/worker clock skew
cannot grant extra entitlement.

## Persistence

Names may follow repository conventions, but the model must preserve these
separations.

### Billing catalog persistence

Persist verified environment-backed prices separately from catalog revisions
so a revision can change one price while reusing the other provider products.

`billing_price_entries`:

```text
id
catalog_key                     pro_month | pro_year | business_month |
                                business_year
plan / billing_interval
currency                        uppercase ISO 4217 code
amount_minor                    positive safe integer
provider / provider_product_id
verified_at
created_at / updated_at
```

Unique `(provider, provider_product_id)`. Provider product IDs are treated as
immutable price identities: reusing one with a different catalog key,
interval, currency, or amount is a catalog mismatch.

`billing_catalog_revisions` and `billing_catalog_revision_items`:

```text
billing_catalog_revisions:
  id / revision                 unique positive integer
  checkout_provider
  status                        pending_verification | active | retired |
                                invalid | abandoned
  verified_at / activated_at / retired_at
  created_at / updated_at

billing_catalog_revision_items:
  catalog_revision_id
  catalog_key
  billing_price_entry_id
```

Unique `(catalog_revision_id, catalog_key)`; every revision has exactly the
four required keys and exactly one revision is active. All revision items and
the active/retired switch commit atomically.

On cloud startup, the catalog loader synchronously validates configuration
shape and idempotently records a higher requested revision as pending;
ordinary API startup does not wait on provider availability. A
catalog-verification job retrieves the four provider products, upserts their
immutable price entries, and verifies product identity, recurring interval,
currency, and amount. A pending/invalid higher requested revision alerts and
disables new checkout deployment-wide until corrected; it never changes an
entitlement or charges a guessed amount. Only a fully verified revision higher
than the current active revision may atomically become active. Older
application instances read the active database revision and cannot roll it
back during a rolling deployment.

A price change should use a new provider product/price ID and a higher catalog
revision; unchanged keys reuse their existing price entries. Previous
revisions retire for new checkout, but their price entries remain available
for webhook/reconciliation lookup as long as any attempt or subscription
references them. Existing subscriptions retain their stored price entry and
are not silently repriced; migrating them is a separate explicit provider
operation and notification workflow. An audited operator command can abandon
a pending/invalid revision after its environment rollout is reverted, restoring
checkout on the prior active revision without deleting catalog history.

Reverify active entries at least hourly. Checkout also retrieves and compares
the selected provider product immediately before customer/session creation. A
changed/mismatched amount, currency, interval, or identity atomically marks the
catalog unavailable, alerts, and creates no provider checkout session. This
fresh check is allowed to depend on provider availability because checkout
already does; ordinary product traffic and existing entitlements do not.

### `organization_plan_states`

One provider-neutral entitlement projection per organization, created in the
same transaction as the organization:

```text
organization_id                 unique FK -> organizations.id
plan                            free | pro | business
active_subscription_id          nullable FK -> organization_subscriptions.id
teams_limit_override            nullable positive integer
contacts_limit_override         nullable positive integer
projection_version              non-negative integer
first_paid_activated_at         nullable timestamp
ramp_stage                      0 | 1 | 2 | 3 (unlimited)
ramp_clean_stage_days           non-negative integer
ramp_evaluated_at               nullable timestamp
created_at / updated_at
```

Constraints:

- Free rows have no active subscription.
- Overrides are positive integers or null.
- Provider IDs are opaque text and are never returned from public REST or MCP
  responses.
- A plan-state change writes an organization audit event with old/new
  canonical values but no raw provider payload.
- Only `active_subscription_id` can grant paid entitlements. A late event for
  a historical subscription may update that subscription but cannot replace
  this pointer unless the subscription-activation state machine explicitly
  wins the organization lock.

OSS is an effective deployment plan rather than a paid row value. This avoids
rewriting every organization. Public API responses report `plan: "oss"` only
when the explicit deployment mode is OSS.

### `organization_subscriptions`

Keep an immutable-identity row for every provider subscription, including
historical and migrated subscriptions:

```text
id
organization_id                 FK -> organizations.id
billing_customer_id             FK -> billing_provider_customers.id
billing_manager_user_id         FK -> user.id
provider                        dodo | stripe | ...
provider_subscription_id
provider_product_id
billing_price_entry_id          FK -> billing_price_entries.id
catalog_key                     pro_month | pro_year | business_month |
                                business_year
plan                            pro | business
billing_interval                month | year
status                          pending | trialing | active | past_due |
                                cancelled | expired
current_period_starts_at        nullable
current_period_ends_at          nullable
paid_through_at                 nullable
trial_ends_at                   nullable
past_due_at                     nullable
grace_ends_at                   nullable
cancel_at_period_end            boolean
is_entitlement_source           boolean
last_provider_event_at          nullable
last_reconciled_at              nullable
created_at / updated_at
```

Constraints and projection rules:

- Unique `(provider, provider_subscription_id)`.
- At most one row per organization has `is_entitlement_source = true`.
  Enforce this with a partial unique database constraint and always with an
  organization-scoped transaction lock. This includes a cancelled
  subscription with future `paid_through_at`, not only `trialing`, `active`,
  and `past_due` statuses.
- `past_due_at` is the first timestamp in the current uninterrupted past-due
  episode. Duplicate `on_hold` events never extend `grace_ends_at`.
- `cancel_at_period_end` is a boolean and never a status. `paid_through_at` is
  derived only from a verified provider snapshot.
- Provider changes create another subscription row; they never overwrite the
  identity or history of an old one.
- Applying a snapshot locks the plan-state and relevant subscription rows. A
  valid replacement clears the old source flag before setting the new one,
  updates the active pointer, increments `projection_version`, and writes the
  audit event in one transaction.

Canonical entitlement behavior is:

| Subscription state | Paid entitlement                                                 |
| ------------------ | ---------------------------------------------------------------- |
| `pending`          | None                                                             |
| `trialing`         | Yes, through verified trial/period end                           |
| `active`           | Yes                                                              |
| `past_due`         | Yes until the fixed seven-day grace deadline; sending then stops |
| `cancelled`        | Only until verified `paid_through_at`, if it is in the future    |
| `expired`          | None                                                             |

Allowed subscription transitions are explicit and forward-only:

| From        | Allowed next state                           |
| ----------- | -------------------------------------------- |
| `pending`   | `trialing`, `active`, `cancelled`, `expired` |
| `trialing`  | `active`, `past_due`, `cancelled`, `expired` |
| `active`    | `past_due`, `cancelled`, `expired`           |
| `past_due`  | `active`, `cancelled`, `expired`             |
| `cancelled` | `expired`                                    |
| `expired`   | None                                         |

A same-state snapshot may update periods, product/catalog, interval, or
`cancel_at_period_end`. A plan/interval change does not invent another
subscription when the provider keeps the same subscription ID. Any other
transition is quarantined unless reconciliation proves the local row was
attached to the wrong provider identity; correcting identity is an audited
operator action, not an automatic fallback.

An hourly deadline job clears `is_entitlement_source` and the active pointer
when verified cancellation paid-through time has elapsed, and records the
derived projection/audit transition. Checkout and entitlement resolution
perform the same expiry check under the organization lock, so a delayed job
cannot extend access or block a legitimate new checkout. Past-due grace expiry
keeps the paid feature projection but changes `canSend` to false; it does not
clear the source. A normal active subscription is not expired merely because a
provider API is temporarily unavailable or a local period timestamp passed.

### `billing_provider_customers`

Reuse a provider customer for the same authenticated payer:

```text
id
provider
user_id                         FK -> user.id
provider_customer_id            nullable while creating
idempotency_key
status                          creating | active | conflicted
last_error                      nullable
created_at / updated_at
```

Unique `(provider, user_id)`, `(provider, provider_customer_id)` when present,
and `idempotency_key` prevent duplicate customer records. Customer creation
uses the same durable-placeholder pattern as checkout: lock/create the local
`creating` row, call the provider outside the transaction with its stable
idempotency key, then attach the result. An ambiguous timeout is reconciled or
retried with that key, never with a fresh mutation. A subscription references
this row. Provider customer reuse must never be implemented by searching Dodo
by an arbitrary client-supplied email.

Because a hosted customer portal may show every subscription owned by that
provider customer, only the stored billing-manager user can create its portal
session. Other organization owners can see plan status and upgrade guidance
but cannot open that payer's customer portal. In v1, a billing manager with a
nonterminal subscription cannot be removed or demoted and the organization
cannot be closed. Normal transfer is cancel-at-period-end followed by checkout
by the new owner after expiry. An emergency operator workflow may cancel the
old subscription and create a new customer/subscription only after verifying
both owners; it must record actor, reason, old/new identities, and timestamps.
It must not silently reassign a provider customer.

### `billing_trial_claims`

Store `user_id`, an HMAC of the normalized verified email at claim time,
canonical trial key (`pro_month`), organization ID, checkout-attempt ID,
`status` (`reserved | redeemed | released`), `expires_at`, and timestamps.

- Acquire the claim in the same transaction/advisory lock that creates the
  checkout attempt. Only one live or redeemed claim may exist per
  `(user_id, trial_key)` and per `(verified_email_hmac, trial_key)`.
- A reservation expires with the checkout session after 24 hours and may be
  released only when reconciliation confirms no provider subscription was
  created.
- The claim becomes permanently `redeemed` as soon as a verified snapshot is
  `trialing` or `active`, even if the subscription is immediately cancelled.
- Email changes do not update or delete historical HMACs. Store the HMAC key
  version. Rotation computes the new-key HMAC for every historical claim and
  atomically rebuilds the uniqueness index before the previous key is retired;
  eligibility checks query all in-progress key versions. A rotation must never
  create a window where the same email can claim again.

### `billing_checkout_attempts`

Checkout is a durable state machine because a hosted checkout can outlive an
HTTP request and each Dodo Checkout Session can create a new subscription:

```text
id                              high-entropy public correlation ID
organization_id
payer_user_id
provider
catalog_key / requested_plan / requested_interval
billing_price_entry_id          FK -> billing_price_entries.id
quoted_amount_minor / quoted_currency
billing_customer_id             nullable until known
provider_checkout_session_id    nullable
checkout_url_encrypted           nullable, cleared at expiry/completion
idempotency_key                 server generated
status                          creating | open | completed | expired |
                                abandoned | conflicted
expires_at
last_error
created_at / updated_at / completed_at
```

Unique constraints cover `idempotency_key`, `(provider,
provider_checkout_session_id)`, and one nonterminal attempt per organization.
The service locks the organization and plan projection, rejects an existing
entitlement-bearing subscription, persists `creating`, then calls the provider
outside the transaction. It supplies provider idempotency when supported and
updates the row to `open`. A crash leaves a recoverable attempt; reconciliation
resumes it by attempt/idempotency key and never blindly creates another
session. Repeated client requests return the same unexpired checkout URL.

Provider metadata contains this high-entropy attempt ID and canonical catalog
key, not an organization ID as the sole correlation mechanism. First
activation resolves the attempt and validates organization, payer, customer,
provider, product, and catalog. A conflicting second subscription is
quarantined and grants no entitlement until an operator resolves it. Retain
normalized attempt metadata for at least 13 months; provider-hosted URLs and
tokens are cleared at expiry and never logged.

Allowed checkout transitions are:

| From                       | Allowed next state                                                                                                    |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `creating`                 | `open`, `expired`, `abandoned`, `conflicted`                                                                          |
| `open`                     | `completed`, `expired`, `abandoned`, `conflicted`                                                                     |
| `expired`                  | `completed` only when a verified subscription was created before the provider session expired; otherwise `conflicted` |
| `abandoned`                | `conflicted` on any late subscription                                                                                 |
| `completed` / `conflicted` | None without an audited operator repair                                                                               |

Client retries never reopen terminal attempts. Reconciliation may perform the
narrow late `expired -> completed` transition only while the organization is
still pending/active for the same payer and has no entitlement source.

### `billing_plan_change_attempts`

Plan changes are durable provider mutations, not fire-and-forget requests:

```text
id / change_id                 opaque public correlation ID
organization_id                FK -> organizations.id
subscription_id                FK -> organization_subscriptions.id
actor_user_id                 FK -> user.id
provider
idempotency_key                unique, scoped to this organization and request
current_catalog_revision / current_price_entry_id
current_plan / current_interval
target_catalog_revision / target_price_entry_id
target_plan / target_interval
effective_at                   immediately | next_billing_date
proration_mode                 canonical SendLit policy value
provider_payment_id            nullable
payment_url_encrypted          nullable, cleared after completion/expiry
status                        creating | pending | succeeded | failed | conflicted
last_error
requested_at / completed_at / created_at / updated_at
```

There is at most one non-terminal plan-change attempt per organization. The
service locks the organization plan state, validates the current subscription
and active catalog revision, and inserts the attempt before calling the
provider. Provider calls use the attempt's stable idempotency key. An
ambiguous timeout leaves the attempt pending for reconciliation; it is never
blindly retried with a new key. A payment failure leaves the old plan active.
The verified webhook/reconciliation snapshot is the only authority that marks
the attempt succeeded and projects the new plan/interval.

### `billing_webhook_events`

Persist verified webhook ingress before applying it:

```text
id
provider
provider_event_id
event_type
occurred_at
payload_encrypted               nullable bytea/blob
payload_key_version             nullable
status                          pending | processing | processed | ignored |
                                quarantined | failed
processing_attempts
last_error
available_at
locked_at / lease_expires_at / worker_id
received_at / processed_at
```

`failed` means a retryable processing failure awaiting `available_at`, while
`quarantined` requires operator review after retry exhaustion. Unique `(provider,
provider_event_id)` makes delivery idempotent.

Workers claim rows in a transaction using `FOR UPDATE SKIP LOCKED` and a
five-minute lease. Retry transient failures after 1 minute, 5 minutes, 30
minutes, 2 hours, and then every 8 hours with jitter, up to eight total
attempts; then quarantine and alert. An expired lease is reclaimable. Store a
redacted payload with authenticated envelope encryption under a billing-worker
key for 30 days, then erase it while retaining normalized
event identifiers, lifecycle result, timestamps, and audit history for 13
months. Decryption is limited to the reconciliation/support command and is
audited. `last_error` is a bounded, sanitized code/message, never raw payload.
Never persist card data, checkout URLs, or full billing addresses.

### Plan send usage

Add organization-level monthly send buckets and per-outbound reservations,
modeled after the existing organization ESP quota implementation. A plan send
reservation applies to every delivery source and every message purpose. Each
reservation has `reserved | committed | released` state, a unique outbound
message ID, UTC bucket month, amount, and one-hour expiry.

- The Free month is a UTC calendar month and resets at 00:00 UTC on the first
  day of the next month.
- Create the outbound row, quota reservation, and dispatch-outbox record in
  one database transaction. Include committed plus reserved usage in the
  limit decision and use row locking/atomic conditional update so concurrent
  sends cannot oversubscribe the bucket.
- Commit when the ESP accepts the message.
- Release when a recipient is suppressed before transport or the provider
  synchronously rejects/finally fails the message.
- Retries reuse the same reservation through the existing outbound submission
  identity; they never consume the plan twice.
- At the worker boundary, an existing reservation does not bypass the current
  payment or reputation `canSend` decision. If its one-hour lease expired or
  its month is no longer current, atomically release it and reserve against
  the current UTC bucket before transport. This prevents end-of-month
  reservation hoarding and double counting.
- A cleanup/reconciliation job releases stale reservations only after checking
  the outbound message and dispatch lease. It commits accepted messages and
  releases terminal non-accepted messages idempotently.

The implementation may share primitives with `delivery/quota.ts`, but plan
usage must remain distinct from organization-mailbox grant quota. The Free
3,000 limit applies even when the team sends through its own ESP.

## Billing-provider adapter

Define the provider contract in a provider-neutral module. Exact names may
change, but the dependency direction may not:

```ts
interface BillingProviderAdapter {
    readonly provider: BillingProviderId;
    readonly capabilities: {
        planChanges: boolean;
        intervalChanges: boolean;
        portalPlanChanges: boolean;
        portalIntervalChanges: boolean;
        proratedPlanChanges: boolean;
    };

    createCustomer(input: CreateBillingCustomer): Promise<BillingCustomer>;
    createCheckout(input: CreateSubscriptionCheckout): Promise<Checkout>;
    createPortalSession(input: CreatePortalSession): Promise<PortalSession>;
    changeSubscriptionPlan(
        input: ChangeSubscriptionPlan,
    ): Promise<PlanChangeResult>;
    retrieveProduct(id: string): Promise<BillingProductSnapshot>;
    retrieveSubscription(id: string): Promise<SubscriptionSnapshot>;
    parseWebhook(input: RawWebhookRequest): Promise<CanonicalBillingEvent>;
}

type ChangeSubscriptionPlan = {
    providerSubscriptionId: string;
    targetProviderProductId: string;
    effectiveAt: "immediately" | "next_billing_date";
    prorationMode: "prorated_immediately" | "do_not_bill";
    idempotencyKey: string;
};

type PlanChangeResult = {
    provider: BillingProviderId;
    providerPaymentId: string | null;
    paymentUrl: string | null;
};
```

Canonical adapter outputs contain SendLit concepts only:

```ts
type SubscriptionSnapshot = {
    provider: BillingProviderId;
    providerCustomerId: string;
    providerSubscriptionId: string;
    providerProductId: string;
    status: "trialing" | "active" | "past_due" | "cancelled" | "expired";
    currentPeriodStartsAt: Date | null;
    currentPeriodEndsAt: Date | null;
    paidThroughAt: Date | null;
    trialEndsAt: Date | null;
    cancelAtPeriodEnd: boolean;
    occurredAt: Date;
    metadata: { sendlitCheckoutAttemptId?: string; catalogKey?: string };
};

type BillingProductSnapshot = {
    provider: BillingProviderId;
    providerProductId: string;
    currency: string;
    amountMinor: number;
    interval: BillingInterval;
};
```

Rules:

- Provider SDKs are imported only by `billing/providers/<provider>/`.
- Routes and domain services depend on the adapter interface/registry, never a
  Dodo class.
- Product IDs are translated through a server-side catalog map. Unknown
  product IDs fail closed and alert; they do not silently become Free or a
  higher plan.
- The adapter may expose capabilities, but provider limitations do not leak
  into plan policy.
- Plan changes use `changeSubscriptionPlan`, never a provider portal redirect.
  The adapter translates canonical effective-time and proration values to the
  provider API. A provider that cannot change a live subscription exposes a
  deterministic `unsupported` error; it must not silently change entitlements.
- Use a fake/in-memory adapter for domain and route tests. Every future
  provider must pass the same adapter contract suite.
- Adapter calls use a 10-second deadline and normalized errors (`invalid`,
  `unauthorized`, `conflict`, `rate_limited`, `unavailable`, `misconfigured`).
  Read-only retrieval may retry up to three times with exponential backoff and
  jitter. Customer or checkout creation may retry only with a provider
  idempotency key or a proven lookup of the existing durable attempt; never
  blindly retry a mutation after an ambiguous timeout.
- Do not use a provider's all-in-one Express handler as the application
  architecture. The official provider SDK may be used inside the adapter for
  API calls and signature verification.

## Dodo Payments implementation

Use the official `dodopayments` TypeScript SDK inside
`billing/providers/dodo/`. Dodo is responsible for hosted checkout, tax,
invoices, payment methods, and the customer portal. SendLit invokes Dodo's
subscription change-plan API for upgrades, downgrades, and interval changes;
the portal remains the destination for payment methods, invoices,
cancellation, and recovery.

The Dodo customer portal must not be treated as a plan-change surface. If a
provider portal configuration offers subscription updates, Operations disables
that control (or removes the products from the portal's update collection)
while retaining the API capability used by SendLit.

### Configuration

```text
SENDLIT_DEPLOYMENT_MODE=cloud | oss
BILLING_CHECKOUT_PROVIDER=dodo
BILLING_ENABLED_PROVIDERS=dodo                 # comma-separated during migrations
BILLING_CATALOG_REVISION=<positive integer>
BILLING_CURRENCY=<ISO 4217 code>
BILLING_PRO_MONTH_AMOUNT_MINOR=<positive integer>
BILLING_PRO_YEAR_AMOUNT_MINOR=<positive integer>
BILLING_BUSINESS_MONTH_AMOUNT_MINOR=<positive integer>
BILLING_BUSINESS_YEAR_AMOUNT_MINOR=<positive integer>
DODO_PAYMENTS_API_KEY=...
DODO_PAYMENTS_WEBHOOK_KEY_CURRENT=...
DODO_PAYMENTS_WEBHOOK_KEY_PREVIOUS=...         # optional, accepted for 48 hours
DODO_PAYMENTS_WEBHOOK_KEY_PREVIOUS_EXPIRES_AT=...
DODO_PAYMENTS_ENVIRONMENT=test_mode | live_mode
DODO_PRO_MONTH_PRODUCT_ID=...
DODO_PRO_YEAR_PRODUCT_ID=...
DODO_BUSINESS_MONTH_PRODUCT_ID=...
DODO_BUSINESS_YEAR_PRODUCT_ID=...
BILLING_RECENT_AUTH_MAX_AGE_SECONDS=900
BILLING_DATA_ENCRYPTION_KEY=<base64 of exactly 32 random bytes>
BILLING_DATA_ENCRYPTION_KEY_VERSION=v1
BILLING_DATA_ENCRYPTION_KEY_PREVIOUS=...         # optional during rotation
```

OSS requires `SENDLIT_DEPLOYMENT_MODE=oss`, an empty enabled-provider set, and
no checkout provider. Cloud requires the checkout provider to be included in
the enabled set. Every provider referenced by a nonterminal subscription must
remain enabled for webhooks and reconciliation even after new checkout moves
elsewhere. Startup fails when these invariants are violated. Do not infer
cloud/OSS from `NODE_ENV`.

Amount variables are provider-neutral and contain minor units (for example,
cents for a two-decimal currency). Parse them as base-10 integers, reject zero,
negative, fractional, exponent-form, whitespace-padded, or values above the
database/provider safe range, and never coerce with JavaScript floating-point
math. `BILLING_CURRENCY` is normalized/validated once and returned with every
offer. `.env.example` uses placeholders, not production amounts.

Checkout Sessions are the required Dodo flow. Each session includes:

- the server-selected product;
- quantity one;
- the configured, provider-verified billing currency and amount represented by
  the selected product; SendLit does not trust or submit a browser amount;
- the authenticated, verified payer email or existing customer ID;
- an allowlisted return URL generated from the configured `WEB_CLIENT` origin,
  including the public organization ID so the dashboard can select and poll
  the correct organization after checkout;
- metadata containing the high-entropy checkout-attempt ID and catalog key;
  the organization is resolved through that local attempt; and
- the 14-day trial only for an eligible `pro_month` selection.

The return page says that activation is being confirmed and polls SendLit's
billing summary. Query-string success is never treated as payment proof.

### Dodo event mapping

At minimum, normalize:

| Dodo event                  | Canonical action                                  |
| --------------------------- | ------------------------------------------------- |
| `subscription.active`       | Reconcile snapshot; activate trial/paid plan      |
| `subscription.updated`      | Reconcile the complete current snapshot           |
| `subscription.renewed`      | Keep active and advance period                    |
| `subscription.plan_changed` | Resolve product to plan/interval and update       |
| `subscription.on_hold`      | Mark past due and begin seven-day grace           |
| `subscription.cancelled`    | Respect immediate versus period-end cancellation  |
| `subscription.expired`      | Reconcile to Free after paid-through time         |
| `subscription.failed`       | Mark checkout/subscription failure; grant no plan |

Payment events may be retained for diagnostics, but subscription events are
the primary lifecycle projection. Dodo currently emits the lifecycle events
above and recommends `subscription.updated` for full synchronization.

### Webhook ingress and processing

Mount provider-specific routes such as `POST /webhooks/billing/dodo` before
`express.json()` so each enabled adapter receives the exact raw bytes. This
mirrors the existing ESP webhook boundary and permits old and new providers to
coexist during migration.

1. Enforce a 256 KiB raw-body limit and a generous provider-scoped ingress
   rate limit that alerts before it rejects known-provider traffic.
2. Verify Dodo's Standard Webhooks signature and timestamp with the official
   SDK helper. During secret rotation, accept current and unexpired previous
   keys for at most 48 hours; record which key version verified the request.
3. Deduplicate using the `webhook-id` header.
4. Persist the verified event durably. Return 2xx only after insertion commits
   or an existing verified duplicate is found. Return 5xx if persistence is
   unavailable so the provider retries.
5. Process asynchronously using the inbox leases and retry schedule above.
6. Resolve the organization from the known subscription ID and checked
   checkout-attempt metadata. Never accept an organization ID solely because
   a payload contains it.
7. For every subscription lifecycle event, retrieve the provider's current
   subscription snapshot before projecting it. The event is a wake-up signal,
   not authoritative ordering. Validate provider/customer/subscription/product
   identities and the retained catalog mapping.
8. Apply the subscription row, active-subscription pointer, plan projection,
   checkout/trial state, and audit in one database transaction. Reprocessing an
   unchanged snapshot is a no-op and does not duplicate audit events.
9. Unknown products, mismatched metadata, conflicting live subscriptions,
   late activation of an abandoned organization, or impossible state
   transitions are quarantined and alert. They never guess a plan.

A five-second in-process timer also polls the durable webhook inbox and
settles expired send reservations. That timer uses a process-local running
guard so one instance cannot start another pass before the previous pass
finishes. Multi-instance correctness still depends on database claims and
row locks, not the in-process guard.

Run reconciliation at least hourly for every nonterminal paid subscription,
every stale `creating`/`open` checkout attempt, and every pending plan-change
attempt, plus a daily sweep of recently terminal subscriptions for seven days.
Pending plan changes are retried with their original provider idempotency key;
the same key is safe after an ambiguous timeout. Reconciliation repairs missed
webhooks, records drift metrics, and uses exponential backoff during provider
outages. Ordinary product traffic continues from the last verified local
projection, except that a locally elapsed grace or paid-through deadline is
enforced without waiting for the provider.

Reconciliation workers claim subscriptions/attempts with database leases and
`FOR UPDATE SKIP LOCKED`, just like webhook workers, so overlapping scheduler
runs cannot apply the same repair concurrently. Provider downtime backs off
per record and does not block reconciliation of other providers.

Provider coexistence rules:

- `BILLING_CHECKOUT_PROVIDER` chooses only new checkout sessions.
- `BILLING_ENABLED_PROVIDERS` controls adapter, webhook, and reconciliation
  availability for all current and historical nonterminal subscriptions.
- Customer, attempt, subscription, webhook, and catalog records always carry
  `provider`; no global provider assumption is permitted.
- Switching checkout provider requires enabling both providers, deploying
  retained catalog mappings and webhook endpoints, switching the checkout
  selector, and disabling the old adapter only after its last subscription is
  terminal and retention obligations are met.

## Entitlement enforcement architecture

### Shared policy engine

Create a framework-agnostic module, for example:

```text
apps/api/src/billing/
  plans.ts
  entitlements.ts
  errors.ts
  organization-plan-queries.ts
  plan-usage.ts
  provider.ts
  provider-registry.ts
  providers/dodo/*
  webhooks/*
  reconciliation/*
```

It exposes intention-revealing operations rather than plan-name checks:

```ts
assertCapability(orgId, "shared_organization_mailbox");
assertCapability(orgId, "provisioning");
reserveTeamSlot(tx, orgId);
reserveSubscribedContactSlot(tx, orgId);
reserveSend(tx, { orgId, outboundMessageId, purpose });
assertSendAllowed({ orgId, teamId, purpose });
```

No route, MCP tool, or worker may contain checks such as
`plan === "business"`. It asks the policy engine about a capability or limit.

### REST middleware

Add middleware that resolves a plan context after authentication:

- Team-scoped routes resolve organization ID from `req.teamId` after
  `requireTeam`.
- Organization routes resolve the authorized public organization parameter to
  the internal organization ID.
- Provisioning resolves organization ID from the organization key.
- The middleware attaches an immutable entitlement snapshot to the request
  and supplies consistent plan-gate error mapping.

Use route-level capability middleware where it is complete and safe, such as
mutating provisioning or shared-mailbox route groups. Do not rely on middleware
for counts, idempotent find-or-create behavior, worker sends, or MCP.

### Domain guards

Capacity writes must lock the organization plan-state row, calculate current
usage, and perform the protected insert/update in one transaction. This avoids
two concurrent requests both observing one remaining slot.

Domain services are the final authority:

- `createTeam` or a new guarded wrapper owns the team-limit transaction.
- Contact creation and `subscribed: false -> true` own the subscribed-contact
  transaction.
- Transactional acceptance and campaign delivery own send reservations.
- Delivery-source resolution and the final transport boundary recheck shared
  mailbox, payment, and sending-control eligibility.
- The provisioning domain guard applies even if a caller bypasses an Express
  route in future code.

Low-level unguarded insert helpers should be private to their module or require
an explicit trusted migration/bootstrap context so new call sites cannot
accidentally bypass policy.

### Stable plan-gate errors

Extend the shared API contract with a structured error:

```json
{
    "error": "plan_limit_reached",
    "error_description": "This organization has reached its 1-team Free plan limit.",
    "organizationId": "org_...",
    "plan": "free",
    "capability": "teams",
    "limit": 1,
    "usage": 1,
    "requiredPlan": "pro",
    "upgradeUrl": "https://app.sendlit.example/organizations?..."
}
```

Use stable codes:

- `plan_feature_unavailable` (403)
- `plan_limit_reached` (409)
- `payment_required` (402)
- `billing_owner_required` (403)
- `free_organization_already_owned` (409)
- `organization_name_already_exists` (409; case-insensitive among the user's
  owned active/suspended/pending organizations)
- `billing_checkout_pending` (409)
- `billing_catalog_changed` (409)
- `billing_catalog_unavailable` (503)
- `active_subscription_exists` (409)
- `recent_authentication_required` (401)
- `domain_verification_required` (403)
- `sending_paused` (403, with non-sensitive reason and recovery guidance)

Cleanup actions needed to get under a limit must never be blocked. MCP returns
the same code and guidance in its structured/error result instead of replacing
it with `internal_error`.

## Gate matrix

### Team capacity

Guard every creation path:

- `POST /teams`
- `POST /organizations/:organizationId/teams`
- MCP `create_team`
- `POST /provisioning/teams`
- default team creation during signup or paid-organization activation

Idempotent provisioning replay for an existing `(organizationId, externalId)`
must succeed without reserving another slot. A new external ID uses a slot.

### Subscribed contacts

Guard:

- `POST /contacts` when it would create a subscribed row;
- `PATCH /contacts/:contactId` when it changes `subscribed` from false to true;
- MCP `create_contact` and `update_contact`;
- every present or future import/sync/upsert path; and
- automation actions that can create or re-subscribe contacts.

Find-or-create of an already-existing contact consumes no new slot. Creating a
transactional email never creates a subscribed contact.

### Free monthly sends

Apply the organization reservation to campaign, sequence, and transactional
mail through both organization and team ESPs. For a broadcast, preflight the
estimated audience against remaining Free usage and reject before fan-out when
the estimate exceeds it; still reserve each recipient atomically because the
audience can change.

Recheck `canSend` and the reservation immediately before transport. Work
queued before a payment failure, downgrade, Free cap, or reputation stop must
not leak through a worker.

### Shared organization mailbox

Free blocks mutating operations under:

- `/organizations/:organizationId/esps`
- organization ESP feedback configuration;
- `/organizations/:organizationId/delivery-policy` when enabling an
  organization source; and
- `/organizations/:organizationId/teams/:teamId/esp-grant`.

Reads, retirement/revocation, and deletion needed for cleanup remain allowed.
`resolveDeliverySource`, `resolvePinnedDeliverySource`, campaign workers, and
transactional workers must reject actual use when the feature is unavailable.

### Provisioning and organization API keys

Only Business and OSS can create organization API keys or perform mutating
provisioning operations:

- provision team;
- update provisioned team;
- replace integration keys;
- suspend/resume; and
- archive through the provisioning API.

Read-only provisioned-team metadata and usage may remain available after a
downgrade to support export and diagnosis, but no organization key can create
or mutate resources. Authentication does not itself confer the capability.

### Free organization creation and ownership

Guard `POST /organizations`, paid-organization checkout creation, adding an
owner, and promoting a member/admin to owner. Perform the ownership check and
membership write in one transaction after locking the affected user rows (in
stable ID order for multi-owner changes) or taking equivalent per-user
advisory locks. Account deletion/email-change flows must not cascade away
organization ownership or trial-claim history in a way that creates a bypass;
ownership must be transferred or the organization deliberately closed first.

### Marketing branding

The Free “Sent with SendLit” mark is injected server-side at marketing render
time using the current effective plan. It is not persisted as user-editable
template content and is never included in transactional mail.

Extend the managed footer render context in `@sendlit/email-blocks` with an
optional server-owned branding value. The API renderer supplies it; client
payload validation must reject attempts to set it. An upgrade removes the mark
on the next render, and a downgrade adds it without rewriting stored
templates. OSS always renders without the mark.

## Fair use and cloud sending safety

Fair use is not a per-email price. It is a separate sending-control policy
that applies to Pro and Business and uses the existing outbound ledger and
feedback events.

### Reputation windows and actions

Evaluate each team over a rolling seven-day window after at least 500 accepted
messages:

| Signal                                                 | Action                                                                    |
| ------------------------------------------------------ | ------------------------------------------------------------------------- |
| Bounce rate >= 2% or complaint rate >= 0.05%           | Warn owners/admins                                                        |
| Bounce rate >= 5% or complaint rate >= 0.1%            | Pause broadcasts and sequences; allow transactional at the degraded limit |
| Complaint rate >= 0.3%                                 | Stop all new sends for that team                                          |
| 10 complaints in seven days, regardless of denominator | Stop all new sends for that team                                          |

The default degraded transactional allowance is 100 accepted messages per UTC
day per team. Keep it in policy configuration so Operations can alter it
without editing route logic.

The denominator is unique outbound messages accepted by an ESP in the rolling
seven-day window. The bounce numerator is unique accepted outbound messages
whose normalized final delivery state is bounced; retries and duplicate
provider events count once. The complaint numerator is unique accepted
outbound messages with a normalized complaint. Only events correlated to an
organization/team/outbound identity enter rates; uncorrelated events alert and
enter a separate diagnostic counter rather than being assigned to a guessed
team. The absolute ten-complaint rule uses the same deduplicated complaints.

Persist team-specific sending-control state rather than overloading the plan
or deleting scheduled work:

```text
team_id                         unique
status                          normal | warned | marketing_paused | all_paused
reason_code                     nullable
source                          automatic | operator
entered_at / evaluated_at
minimum_hold_until              nullable
operator_user_id / operator_reason / overridden_at   nullable
```

When a team uses a shared organization mailbox, a reputation stop suspends
that grant for that team only. It does not pause the mailbox for every team.
The 100/day degraded transactional allowance uses its own atomic daily bucket
and reservation lifecycle.

Recovery uses hysteresis:

- `warned` returns to normal only after seven consecutive daily evaluations
  below both warning thresholds.
- `marketing_paused` has a minimum 72-hour hold and returns to normal only
  after seven consecutive daily evaluations below both warning thresholds.
- `all_paused`, including the ten-complaint rule, never auto-recovers; an
  operator must review the sending source/list, record a reason, and release
  it. A release starts at `warned`, not directly at an unobserved clean state.
- A new threshold breach resets the recovery streak. An operator may impose a
  stricter state but cannot override an active payment stop.

Recalculate after processed bounce/complaint events and at least hourly. Every
automatic warning, pause, recovery, and operator override is audited. An admin
UI is not required for v1, but an operator command and owner notification are.

### Paid-organization ramp

Apply a configurable marketing-only daily ramp from first paid activation:

- days 0-2: 200/day;
- days 3-6: 1,000/day;
- days 7-13: 10,000/day; and
- day 14 onward: no plan send cap, subject to fair use.

Transactional sends do not consume the marketing ramp, but remain subject to
payment and reputation controls. A plan or interval change does not restart a
clean organization's ramp. Cancellation followed by a later reactivation may
resume from historical clean tenure unless Operations reset it for abuse.

Persist organization ramp state (`first_paid_activated_at`, current stage,
clean stage days, evaluated timestamp, and optional audited operator reset)
and atomic UTC daily marketing reservations. A stage advances only after its
required clean days with no fair-use warning/pause; `warned` freezes
advancement and either pause blocks marketing regardless of unused ramp. The
worker rechecks and commits/releases the daily reservation with the same
outbound identity used for plan usage, so concurrent campaigns cannot exceed
the ramp and retries do not double count.

### Verification

- Cloud sending requires at least one verified organization owner email.
- Before an organization leaves test volume, its From domain must be verified.
  Implement provider-independent DNS verification rather than assuming that a
  configured SMTP credential proves domain ownership.
- Use 100 accepted lifetime cloud messages per organization as the initial
  configurable test-volume threshold. After that, unverified domains are
  blocked with a verification error and setup link.
- Plain SMTP remains available for OSS and cloud tests but cannot unlock paid
  fair-use volume without a reviewed bounce/complaint feedback connection.

Persist organization-scoped sending domains:

```text
id / public_id
organization_id
domain                          normalized lowercase IDNA ASCII
challenge_token_hash
status                          pending | verified | revoked | failed
verified_at / last_checked_at / next_check_at
failed_check_count / first_failed_at
created_at / updated_at
```

Unique `(organization_id, domain)`. The challenge is 32 random bytes exposed
once and verified through a TXT record at
`_sendlit-verification.<domain>`; store only its keyed hash. Reject public
suffixes, IP literals, wildcard input, and domains outside normal DNS length
rules. Verification performs DNS TXT lookup only—never an arbitrary HTTP
callback—using bounded resolver timeouts. Recheck verified domains every 30
days and revoke only after three failed checks spanning at least 72 hours, with
owner warning before enforcement. Transient failures retain a verified domain
until that threshold is met. A From address above test volume must match the
exact verified domain or a separately verified subdomain.

Add owner/admin REST contracts to list domains, create a challenge, request a
verification refresh, and revoke a domain; expose read-only verification state
to relevant MCP send errors, but do not expose the challenge through MCP in
v1. The Organizations UI provides the DNS instructions and status. This may
be a separate implementation slice, but paid unlimited/fair-use marketing is
not launch-complete before this gate and automated reputation stops are live.

## REST API contract

Add provider-neutral schemas and routes to `@sendlit/api-contract` so OpenAPI
is generated from the same source.

### Read active billing catalog

`GET /billing/catalog`

This is a public, read-only, normally rate-limited route. It returns the active
`catalogRevision`, currency, and the four offers with
`catalogKey`, `plan`, `interval`, `amountMinor`, and `trialDays`. It never
returns provider/product IDs. The web application and any public pricing
surface use this response rather than bundled numeric constants. Responses may
use an ETag and at most five minutes of public caching; checkout still validates
the submitted revision, so stale display data cannot authorize an old price.
If no fully verified catalog is active in cloud mode, return a stable
`billing_catalog_unavailable` error and hide/disable checkout rather than
displaying fallback amounts.

### Read billing summary

`GET /organizations/:organizationId/billing`

Organization members may read non-sensitive plan and usage information.
Owners/admins receive management flags. Never return provider IDs.

```json
{
    "plan": "pro",
    "billingInterval": "month",
    "paymentStatus": "active",
    "trialEndsAt": null,
    "currentPeriodEndsAt": "...",
    "cancelAtPeriodEnd": false,
    "graceEndsAt": null,
    "canManageBilling": true,
    "entitlements": {
        "teamsLimit": 5,
        "subscribedContactsLimit": 10000,
        "monthlySendsLimit": null,
        "sharedOrganizationMailbox": true,
        "provisioning": false,
        "marketingBranding": false
    },
    "usage": {
        "teams": 2,
        "subscribedContacts": 8120,
        "monthlySends": 19440
    },
    "pendingPlanChange": null
}
```

### Sensitive billing action authorization

`POST /billing/action-token`

Body: `{ action, target }`, where `action` is one of
`organization_checkout`, `checkout`, `portal`, `plan_change`, or
`organization_close`. Existing-organization actions bind `target` to the
public organization ID; paid organization creation uses `new`.

The endpoint requires a first-party human session created within
`BILLING_RECENT_AUTH_MAX_AGE_SECONDS`, an exact allowlisted Origin, and the
double-submit CSRF token. It returns a random, five-minute, single-use token
bound to the user, session, action, and target. The caller sends it in
`X-Sendlit-Billing-Action-Token` on the corresponding mutation. Expired,
replayed, cross-action, and cross-organization tokens fail closed. A stale
session must complete the hosted email-OTP sign-in again before a token can be
issued.

### Existing-organization checkout

`POST /organizations/:organizationId/billing/checkout`

Body: `{ plan: "pro" | "business", interval: "month" | "year",
catalogRevision: number }`.

Requires a human organization owner with a verified email. It creates/reuses
the payer's provider customer, validates trial eligibility, prevents a second
active or nonterminal checkout/subscription, and returns `{ checkoutUrl,
expiresAt }`. A repeated request with the same selection returns the durable
open attempt. The checkout URL is short-lived and never accepted from a client
on a later API call. A stale revision returns `409 billing_catalog_changed`
with the new catalog metadata and creates no customer, attempt, or provider
session.

### Organization plan change

`POST /organizations/:organizationId/billing/plan-change`

Body: `{ plan: "pro" | "business", interval: "month" | "year",
catalogRevision: number, idempotencyKey?: string }`.

Only the billing manager may request a change. SendLit resolves the target
offer from the verified active catalog and applies the default policy:
upgrades (including monthly to yearly) are immediate and prorated; downgrades
(including yearly to monthly) are scheduled for the next billing date without
an immediate charge. The request is persisted before the provider mutation
and uses the adapter's stable idempotency key. The response is `202` with an
opaque `changeId`, `status: "pending"`, the effective time, and an optional
short-lived payment URL if the provider requires an additional payment step.
The old entitlements remain in force until a signed webhook or reconciliation
snapshot confirms the target product. Repeating a request with the same
idempotency key returns the original attempt; a different target while an
attempt is pending returns `409 billing_plan_change_pending`.

`GET /organizations/:organizationId/billing/plan-changes/:changeId` returns
the redacted attempt status (`pending`, `succeeded`, `failed`, or
`conflicted`) and effective time. It never returns provider IDs, secrets, or
unredacted provider errors.

### Paid organization creation

`POST /billing/organization-checkouts`

Body: `{ organizationName, teamName, plan, interval, catalogRevision }`.

Creates a `pending_payment` organization, owner membership, plan state, and
checkout. The verified activation webhook creates the first team
idempotently, marks the organization active, and makes it selectable. Failed
or abandoned pending organizations expose a resume-checkout/hide flow only to
their creator; hiding tombstones the pending organization but retains billing
correlation records.

### Customer portal

`POST /organizations/:organizationId/billing/portal`

Requires the stored billing-manager user and returns a short-lived
`{ portalUrl }`. It does not proxy portal content through SendLit. It is used
for payment methods, invoices, cancellation, and recovery, not for plan or
interval changes. The
provider session's return URL is generated from the configured `WEB_CLIENT`
origin and includes the public organization ID, so a user who owns multiple
organizations returns to the organization whose billing they just managed.

### Webhook

`POST /webhooks/billing/dodo`

Public, raw-body, signature-authenticated, rate-limited independently, and not
part of the normal user/API-key auth middleware.

### Usage

Add `GET /organizations/:organizationId/plan-usage`; do not alter the existing
shared-delivery usage contract. It returns teams, subscribed contacts,
calendar-month SendLit plan usage, reservation/committed totals, bucket
boundaries, and relevant limits without provider identifiers.

## MCP parity

Implementation is incomplete if REST is gated but MCP can bypass it.

- `create_team`, `create_contact`, `update_contact`, transactional send,
  sequence start/enrollment, and every future mutation call the guarded domain
  services.
- Map plan errors to structured MCP errors with the same stable code, plan,
  usage, limit, required plan, and upgrade URL.
- Update tool descriptions where a plan limit or capability is relevant.
- Add one read-only `get_plan_usage` tool for the current team's parent
  organization so an MCP client can explain a denial. It must not expose
  provider customer/subscription IDs or billing portal links.
- Do not expose checkout, payment method, invoice, cancellation, or portal
  tools through MCP in v1.
- Extend MCP policy/registry tests so every mutating tool has both scope and
  entitlement coverage.

## Web application requirements

All standard components must use shadcn/ui and be installed with the Shadcn
CLI when a component is not already present.

### Organizations area

- Show the selected organization's plan badge, payment state, team usage,
  contact usage, and Free send usage.
- Keep organization billing actions together in the Organizations **Plan** tab.
  A contextual upgrade action beside a team may link to that tab, but its
  label/copy must say it upgrades the parent organization and its request must
  use the organization ID.
- Owners see **Upgrade** on Free, **Change plan** on paid plans, and
  **Manage billing** when they are the billing manager.
- Admin/member users may see the plan and limits but never a provider portal
  for somebody else's billing customer.
- Upgrade opens a plan/interval dialog, summarizes the organization being
  upgraded, and redirects to hosted checkout. The dialog fetches the active
  billing catalog and formats `amountMinor`/currency through one shared money
  formatter; no paid amount appears as a React/translation constant.
- Change plan opens the same catalog-backed dialog with the current selection
  highlighted. SendLit submits the target plan/interval to its plan-change API,
  shows the effective date and pending confirmation, and only redirects to an
  optional provider payment link when the adapter requires one. Manage billing
  remains available separately for invoices, cards, cancellation, and payment
  recovery.
- Pass the displayed `catalogRevision` to checkout. On
  `billing_catalog_changed`, refresh the dialog and require the owner to review
  the new amount before retrying; never redirect automatically after a price
  change.
- Returning from checkout shows **Confirming subscription** and refreshes the
  billing summary until a verified event activates it. It must not optimistically
  unlock features.
- Past-due and cancellation-at-period-end banners include exact dates and the
  appropriate portal action.
- Over-limit banners show current usage, the limit, allowed cleanup actions,
  and upgrade guidance.

### New organization flow

- In an OSS deployment, omit plan selection entirely and create the new
  organization as OSS implicitly after the user enters its name.
- If the user owns no Free organization, the dialog offers Free, Pro, or
  Business.
- If the user already owns a Free organization, Free is unavailable and the
  dialog requires Pro or Business plus interval before continuing to checkout.
- Organization names are unique case-insensitively among the user's owned
  active, suspended, or pending organizations; closed or abandoned names may be
  reused.
- Free organization creation creates the organization and its initial team in
  one transaction. When no explicit team name is supplied, the initial team is
  named from the organization (for example, `Acme Team`) instead of the generic
  `Default Team`.
- After successful organization creation, reload the dashboard so the
  organization and team switchers reflect the new organization immediately.
- Paid creation shows pending status until activation; abandoned pending rows
  can be resumed while an attempt is valid or hidden/tombstoned after expiry.

### Account page

Remove the account-level Free-plan billing card and any copy saying billing is
for the account. Replace the Billing tab with a short explanation and link to
Organizations, or remove the tab entirely. Accounts are never billed.

### Feature surfaces

- Disable or replace New team, New shared mailbox, grant, organization key,
  and provisioning actions using the server-returned entitlement snapshot.
- Client-side disabling is explanatory only. The API/domain guards remain the
  authority.
- Free marketing previews show the SendLit mark that the server will inject.

## Security and reliability requirements

- Require a verified human session for checkout, plan changes, and portal creation. Team and
  organization API keys cannot access billing endpoints.
- Only organization owners can start a subscription; only the stored billing
  manager can change a plan or open the customer portal.
- Checkout, portal, cancellation/close, and any future billing-manager action
  require authentication within the last 15 minutes. Otherwise require a
  verified-email OTP/WebAuthn reauthentication and issue a single-purpose,
  five-minute server action token bound to user, organization, action, and
  session. A normal long-lived session is insufficient. Resuming checkout for
  an organization already in `pending_payment` is the exception: the user
  already started that attempt, so the existing human session may issue the
  action token without a 15-minute reauthentication. The dashboard must not
  treat `recent_authentication_required` as a dead session (no sign-out).
- Cookie-authenticated billing mutations require the application's CSRF token
  and an exact allowlisted `Origin` (with a same-origin `Referer` fallback only
  where the browser omits Origin). Provider webhook routes are exempt from CSRF
  because they use raw-body signatures and are mounted separately.
- Organization billing and billing-mutation responses set `Cache-Control:
no-store` and `Referrer-Policy: no-referrer`. The non-sensitive public catalog
  is the sole cacheable exception and follows its five-minute/ETag contract.
  Checkout and portal URLs are returned only in response bodies, never placed
  in application logs, analytics, error reports, or referrer parameters.
- Never log API keys, webhook secrets, checkout URLs, portal URLs, full billing
  payloads, addresses, or payment details.
- Use raw-body signature verification and reject stale/invalid Dodo webhook
  timestamps.
- Allowlist checkout return URLs; never accept an arbitrary redirect from the
  browser.
- Store only opaque provider IDs. Card, tax, invoice, and billing-address data
  remain at the provider.
- Use unique constraints and transactions for checkout activation, first-team
  creation, trial claims, plan-change attempts, webhook deduplication, and
  provider subscription attachment.
- A replayed active event must not create another team or audit duplicate plan
  transitions.
- A webhook naming an unknown organization, customer, product, or conflicting
  subscription is quarantined and alerts Operations; it never grants access.
- Provider API outage does not downgrade active customers. New checkout and
  plan-change/portal requests return a retryable provider-unavailable response;
  an ambiguous plan-change timeout remains pending for reconciliation.
- Organization close returns `409 active_subscription_exists` while any
  subscription is nonterminal or has future paid-through entitlement, and
  `409 billing_checkout_pending` while a live checkout attempt exists. Close
  requires the billing action token. The owner must cancel in the provider
  portal and wait for expiry; DELETE never performs a surprising remote
  cancellation. Pending organizations may only be tombstoned after their
  attempts expire/are abandoned, retaining billing correlation for late-event
  quarantine.
- A billing manager cannot be removed/demoted while responsible for a
  nonterminal subscription. Ownership mutation and subscription checks occur
  under the same organization lock.
- Provider credentials, webhook secrets, and email-HMAC keys live in the
  deployment secret store, are never database-configurable through public API,
  and are exposed only to billing/webhook worker processes that need them.

## Observability and operations

Record structured metrics/events for:

- checkout requested, created, failed, and returned;
- subscription activated, changed, renewed, past due, recovered, cancelled,
  and expired;
- webhook verified, duplicate, ignored, failed, retried, and processing lag;
- reconciliation success, drift, and provider failure;
- plan-gate denial by capability, plan, surface (REST/MCP/worker), and org;
- usage reservation, commit, release, stale cleanup, and rejected overage;
- fair-use warning/pause/recovery; and
- time from verified paid event to entitlement availability.

Add an operator command or script to:

- inspect/verify an environment catalog revision and abandon a reverted
  pending/invalid revision with an audit reason;
- inspect and reconcile one organization subscription;
- set/remove team and contact overrides with an audit reason;
- retry/quarantine a webhook event;
- perform the documented emergency cancel-and-recreate billing-manager
  recovery after dual identity verification;
- apply/release a reputation sending control.

Never require direct unaudited database edits for ordinary recovery.

Initial alerts/SLOs:

- page when verified webhook inbox oldest-pending age exceeds five minutes for
  10 minutes, any event is quarantined, or signature failures spike above the
  normal baseline;
- alert when a nonterminal subscription has not reconciled for six hours, a
  `creating` checkout/customer is unresolved for 15 minutes, or provider drift
  is detected;
- alert before raw-payload purge, reservation cleanup, deadline, domain
  recheck, or reputation-evaluation jobs miss two scheduled runs; and
- dashboard provider latency/error rate, entitlement projection lag, active
  past-due grace deadlines, and reservation drift.

## Migration and rollout

### Schema/backfill

Use expand/backfill/validate/enforce/contract migrations. New code must tolerate
nullable/unbackfilled rows during rollout; backfill in small batches, create
large indexes concurrently where PostgreSQL permits, and validate constraints
before enforcement. Do not combine provider webhook cutover, destructive column
removal, and plan enforcement in one deployment.

1. Add price entry/catalog revision, plan projection, subscription history,
   provider customer, checkout attempt, plan-change attempt, trial claim,
   webhook inbox, usage reservation, sending-control, and sending-domain
   tables plus organization `pending_payment`/`abandoned` status.
2. Create a Free plan-state row whenever a cloud organization is created.
3. Backfill existing organizations without deleting or moving data.
4. Do not blindly make known CourseLit/FrontLit platform organizations Free.
   Before enforcement, provide an explicit deployment manifest or operator
   script that assigns Business and any negotiated overrides to those public
   organization IDs.
5. In OSS mode, stored cloud plan projections are ignored and effective plan
   is OSS.
6. Report every existing cloud org above Free limits before enforcement.

### Cloud enforcement

Cloud always applies plan gates. OSS mode remains unrestricted.

### Delivery order

1. Canonical catalog, schema, plan resolver, structured errors, and fake
   adapter
2. Transaction-safe team/contact/send guards across REST, MCP, and workers
3. OSS/cloud mode
4. Dodo customer, checkout, plan-change, portal, raw webhook, and reconciliation adapter
5. Organization billing/usage REST contracts and generated OpenAPI
6. Organizations UI, checkout return state, new paid-org flow, and account
   billing cleanup
7. Render-time Free branding
8. Reputation automation, paid ramp, account/domain verification, and
   notifications
9. Production backfill and Dodo test-mode acceptance

Items 1-8 are launch requirements for publicly claiming the complete pricing
model. A controlled billing beta may begin after item 6 if send volumes are
manually restricted and Operations is actively reviewing feedback.

## Testing strategy

### Unit and contract tests

- Every plan policy and override combination
- Environment catalog parsing rejects absent, fractional, negative, unsafe,
  malformed, or unsupported-currency amounts
- Public catalog exposes configured minor-unit amounts/currency but never
  provider IDs; no web/server plan definition contains a paid numeric constant
- Provider catalog verification rejects amount, currency, interval, and product
  mismatches
- Payment-status-to-effective-entitlement transitions, including exact grace
  boundaries and period-end cancellation
- Canonical catalog to Dodo product mapping and unknown product rejection
- Billing-provider contract suite against fake and Dodo adapters
- Trial reservation, expiry/release, permanent redemption, email-change
  resistance, and concurrent claims
- Canonical subscription transitions, duplicate `on_hold` without grace
  extension, paid-through boundaries, and historical subscription isolation
- Plan error serialization for REST and MCP
- Free branding present only on Free marketing renders

### Database/integration tests

- A four-offer catalog revision activates atomically; a partial/invalid or lower
  rolling-deploy revision cannot replace the current catalog
- A price revision leaves old checkout/subscription snapshots and reverse
  webhook mappings intact
- A stale checkout revision creates no customer/session and returns the new
  catalog for explicit user review
- Two concurrent last-slot team creations produce one success and one stable
  limit error
- Concurrent contact creation/re-subscription cannot exceed the org pool
- The same email in two teams counts twice
- Transactional-only recipients do not affect contact usage
- Concurrent Free send reservations cannot exceed 3,000
- Retry/idempotency reuses one send reservation; an expired or previous-month
  reservation is atomically moved before transport
- Two concurrent checkout requests create one durable provider session and a
  crash between local attempt creation and provider response is reconcilable
- A billing manager with a nonterminal subscription cannot be removed,
  demoted, or bypassed by another owner
- Concurrent and repeated plan-change requests create one provider mutation;
  an ambiguous provider timeout is reconciled without a second mutation
- Downgrade preserves rows and blocks only the specified new actions
- Cleanup/export/unsubscribe/delete remain possible while over limit
- Organization-key provisioning cannot bypass Business entitlement
- MCP and REST reach identical guard decisions
- Past-due queued work is stopped at the worker boundary after grace

### Webhook tests

- Invalid signature and stale timestamp rejected
- Current and time-bounded previous webhook keys verify during rotation
- Duplicate event acknowledged without duplicate mutation
- Out-of-order event cannot revert a newer state
- Unknown product/subscription/org quarantined
- Verified ingress returns 5xx when the durable inbox cannot commit
- Expired worker leases are reclaimed; retry exhaustion quarantines and alerts
- Activation creates the pending org's first team exactly once
- Late activation for an abandoned org and a conflicting second live
  subscription grant no entitlement
- Plan change, recovery, scheduled cancellation, immediate cancellation, and
  expiry project correctly
- Reconciliation repairs a deliberately dropped webhook
- During provider migration, old-provider webhooks update only their
  subscription while new checkout uses the configured new provider

### Security and policy tests

- Billing mutations reject API keys, stale authentication, missing/invalid
  CSRF, and cross-origin requests
- Portal creation rejects an owner who is not the stored billing manager
- Billing responses are no-store and URLs/secrets are redacted from logs
- Production cloud refuses missing/mismatched mode/provider/catalog config
- Fair-use rates deduplicate retries/events; pause recovery obeys minimum hold
  and clean-evaluation streaks; all-pause requires operator release
- Concurrent marketing sends cannot exceed the paid ramp; a warning freezes
  stage advancement and retries reuse the same daily reservation
- Domain verification rejects public suffixes/IP/wildcards, stores no plaintext
  challenge, and enforces the exact verified From domain after test volume

### Browser and provider acceptance

- Use Dodo test mode for all four catalog products
- Confirm each amount displayed by the web app comes from the active catalog,
  matches hosted checkout, and changes after environment/catalog revision
  update without a code change
- Keep an old subscription active across a new-price catalog deployment and
  verify it is not silently repriced
- Complete eligible/ineligible trial checkouts
- Verify organization-specific checkout and return polling
- Change Pro ↔ Business and monthly ↔ yearly from the SendLit dialog; verify
  the provider subscription changes and the webhook-backed projection updates
- Open the payer-only customer portal; update card, cancel, and recover payment
- Confirm Organizations team-item Upgrade targets the parent organization
- Confirm account Billing no longer implies account-level charging
- Exercise over-limit, past-due, and downgrade UI states
- Run API and Web with `pnpm dev:api` and `pnpm dev:web`; keep Postgres, Redis,
  and Mailpit running; use headful Chrome DevTools for smoke testing

## Documentation requirements

Implementation changes under `apps/api` must update both REST/OpenAPI and MCP.

- Add all billing/plan schemas and routes to `packages/api-contract` so
  `openapi.json` remains generated rather than hand-maintained.
- Document every catalog environment variable in the deployment guide and
  `.env.example` with placeholders, minor-unit semantics, revision procedure,
  provider verification, rollback behavior, and the rule that paid amounts are
  never source constants.
- Update developer error documentation with stable plan-gate codes.
- Update provisioning docs to state Business/OSS eligibility and downgrade
  behavior.
- Update organization/team docs with plan inheritance, usage, billing-manager
  permissions, and the one-Free-org rule.
- Update MCP docs/tool descriptions and document `get_plan_usage` plus plan
  error behavior.
- Publish separate customer-facing billing FAQ and acceptable-use/deliverability
  policy derived from the product-marketing pricing source. Do not publish this
  internal architecture PRD as the pricing page.

## Expected implementation areas

| Area              | Expected files/modules                                                                                                |
| ----------------- | --------------------------------------------------------------------------------------------------------------------- |
| Schema            | `apps/api/src/db/schema.ts`, Drizzle migration and snapshots                                                          |
| Billing domain    | new `apps/api/src/billing/**` catalog, entitlements, usage, provider registry, Dodo adapter, webhooks, reconciliation |
| Configuration     | validated environment schema, placeholder `.env.example`, catalog revision loader/verifier                            |
| Auth/context      | plan-context middleware adjacent to `requireAuth` / `requireTeam`                                                     |
| Organization/team | guarded organization creation, ownership changes, team creation, billing routes and queries                           |
| Contacts          | guarded create and re-subscribe paths                                                                                 |
| Sending           | transactional acceptance, sequence/broadcast start and workers, outbound reservation lifecycle                        |
| Shared delivery   | organization ESP/grant/policy routes and final delivery-source resolution                                             |
| Contract/OpenAPI  | `packages/api-contract/src/schemas/**`, `contract.ts`, validation tests                                               |
| MCP               | guarded tools, policy/error mapping, `get_plan_usage`, tool tests                                                     |
| Web               | Organizations plan/usage/upgrade/new-org flows, API wrappers, account billing cleanup                                 |
| Email blocks      | server-owned optional SendLit branding in the managed marketing footer                                                |
| Public docs       | Organizations, teams, provisioning, MCP, authentication/errors, billing FAQ, acceptable use                           |

## Acceptance criteria

1. With `SENDLIT_DEPLOYMENT_MODE=oss` and no enabled/checkout provider, every
   organization resolves to OSS, all product features work, no SendLit plan
   limits or branding apply, and no checkout/portal is shown. Missing or
   contradictory production configuration fails startup.
2. In cloud mode, signup produces one Free organization and one team with the
   published limits.
3. A user cannot create or acquire a second Free organization, but invitations
   remain unlimited.
4. An organization owner can buy Pro or Business monthly/yearly through Dodo;
   Pro monthly receives a one-time eligible 14-day trial.
5. The stored billing manager can change plan and interval from SendLit; the
   provider portal is used only for payment methods, invoices, cancellation,
   and recovery.
6. Verified subscription state updates only the targeted organization and is
   visible in the Organizations area without migrating its teams or data.
7. The same payer reuses one Dodo customer, while each paid organization has a
   distinct subscription.
8. Dodo-specific code is confined to its adapter and can be replaced by a fake
   or second provider without changing plan policy or public billing contracts.
9. Every team, contact, send, shared-mailbox, organization-key, and provisioning
   gate is enforced across REST, MCP, and background execution with stable
   upgrade guidance.
10. Concurrent requests cannot exceed team, contact, or Free send limits.
11. Downgrade and payment failure never delete data and match the documented
    cleanup, grace, and sending behavior.
12. Free marketing email contains server-owned SendLit branding; OSS, Pro,
    Business, and transactional mail do not.
13. Webhooks are raw-body verified, idempotent, out-of-order safe, audited, and
    repairable through reconciliation.
14. The Organizations UI owns billing. The Account UI does not imply that a
    login has a plan or subscription.
15. Automated fair-use stops, paid ramp, verified ownership/domain gates, and
    team-specific shared-mailbox isolation are live before unrestricted paid
    cloud sending is advertised.
16. REST/OpenAPI, MCP, web UI, public docs, tests, and operational tooling agree
    on the same plan catalog and error semantics.
17. Repeated/concurrent checkout cannot create duplicate entitlement-bearing
    subscriptions, and checkout/trial state recovers after process failure.
18. Existing subscriptions remain operable while the checkout provider is
    migrated; late events from a historical subscription cannot replace the
    active projection.
19. Billing mutations require recent human authentication and CSRF protection;
    billing-manager removal, organization close, webhook key rotation, inbox
    leases, retention, and quarantine follow the defined lifecycle.
20. Paid amounts/currency are accepted from validated environment configuration,
    verified against provider products, served by the billing-catalog contract,
    and absent from application/UI constants. Raising a price and catalog
    revision requires no source-code change and does not reprice existing
    subscriptions implicitly.

## Risks and mitigations

| Risk                                                                     | Mitigation                                                                                                 |
| ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| REST middleware gives a false sense of complete enforcement              | Mandatory shared domain guards and worker-boundary checks; MCP parity tests                                |
| Concurrent writes exceed a cap                                           | Lock plan state and mutate in one transaction; atomic send reservations                                    |
| Missing billing configuration accidentally unlocks OSS or disables gates | Explicit deployment mode, startup invariants, and cloud plan-gate enforcement                              |
| Repeated or ambiguous checkout creates duplicate subscriptions           | Durable checkout attempt, mutation idempotency, one source constraint, reconciliation, conflict quarantine |
| Provider webhook is missed, duplicated, or reordered                     | Durable verified inbox, unique provider event ID, event-time checks, snapshot reconciliation               |
| Provider switch strands existing subscribers                             | Per-record provider identity, multiple enabled adapters, retained legacy catalog maps, migration runbook   |
| UI amount differs from hosted checkout                                   | Verified environment catalog, revision-bound checkout, stale-revision rejection, provider mismatch stop    |
| Dodo concepts spread through the product                                 | Provider interface, canonical snapshots/events, server catalog mapping, adapter contract tests             |
| Customer portal exposes another payer's subscriptions                    | Portal only for stored billing-manager user; plan changes use SendLit API; no org-admin impersonation      |
| Repeated or ambiguous plan change mutates twice                          | Durable plan-change attempt, provider idempotency, one nonterminal attempt, webhook/reconciliation source  |
| Existing platform org is accidentally downgraded                         | Explicit production backfill manifest, override audit                                                      |
| Downgrade leaks sends already queued                                     | Recheck payment, capability, usage, and reputation immediately before transport                            |
| Full OSS competes with cloud                                             | UI/docs clearly sell managed hosting, upgrades, monitoring, security maintenance, and worker operations    |
| “Fair use” exists only as copy                                           | Launch gate requires measured thresholds, automatic controls, notifications, and audit                     |

## External provider references

The Dodo implementation assumptions above were checked against the provider's
official documentation on 2026-08-28:

- [Subscription integration and Checkout Sessions](https://docs.dodopayments.com/developer-resources/subscription-integration-guide)
- [Subscription webhook lifecycle events](https://docs.dodopayments.com/developer-resources/webhooks/intents/subscription)
- [Customer Portal](https://docs.dodopayments.com/features/customer-portal)
- [TypeScript SDK](https://docs.dodopayments.com/developer-resources/sdks/typescript)
- [Metadata](https://docs.dodopayments.com/api-reference/metadata)
- [Webhook signature, idempotency, and ordering guidance](https://docs.dodopayments.com/developer-resources/webhooks)

Provider behavior must be revalidated against current official documentation
when implementation begins; the adapter contract and SendLit policy remain the
stable parts.
