# PRD: Organizations, ESP Ownership, and Team Provisioning

_Status: phased implementation plan. Date: 2026-07-31. Owners: SendLit API,
Web, and Operations. Phase 1 scope: organization tenancy, independent user/team
membership, organization- and team-owned ESPs, grants, organization keys,
provisioning, source-safe transactional/sequence delivery, quota, redaction,
the clean database baseline, REST/OpenAPI, MCP, and essential dashboard
behavior. Later phases cover additional crash-window recovery, dispatch
fairness, advanced metrics, and operational automation._

## Executive summary

SendLit needs one ownership model that supports:

- a person using SendLit directly;
- CourseLit providing email delivery to independently operated schools;
- FrontLit letting each of its teams connect its own ESP;
- an agency administering multiple teams;
- an organization sharing one ESP with selected teams; and
- a team starting with an organization ESP and connecting its own ESP later.

The model is:

```text
Users (Better Auth `user`)
  ↕ organization_members
Organizations
  ├── Organization-owned ESPs
  │       ↕ ESP grants
  └── Teams
      ├── team_members ↔ Users
      └── Team-owned ESPs
```

A **user** is the Better Auth human login identity. Better Auth's **account**
model remains the authentication-provider identity linked to a user. An
**organization** is the ownership and administration boundary above
teams. Every team belongs to one organization. ESP configurations have an
immutable ownership scope: `organization` or `team`.

An organization-owned ESP becomes a **shared ESP** for a team only when the
organization grants it to that team. The grant gives permission to send; it
does not give team members permission to read or administer the underlying ESP
configuration. A team-owned ESP belongs to and is administered by exactly one
team.

CourseLit therefore has one organization, one organization-owned ESP, and one
team per school. FrontLit has one organization and one team per FrontLit team;
those teams own their ESPs. When CourseLit later enables BYO ESPs, a school
adds a team-owned ESP without changing teams or moving data.

Organization API keys identify exactly one organization and provision teams
only inside it. The former deployment-wide provisioning mechanism and
`ownerEmail` provisioning behavior are removed, not deprecated.

There are no production users. The database may be reset. Implementation must
therefore rewrite the Drizzle schema and migrations as a clean baseline rather
than layering compatibility columns, backfills, dual reads, or incremental
legacy migrations onto the current design.

## Product decision

Adopt organizations as the universal owner of teams:

```text
User identity
    ↓ explicit membership
Organization
    ├── organization-owned ESP configurations
    └── teams
        └── team-owned ESP configurations
```

Do not retain separate user-owned and platform-owned team modes. Do not add
`teams.ownershipType`, nullable competing owner columns, service accounts, or a
special `platform_customers` resource.

Do not create a separate `managed_outboxes` table. Organization- and team-owned
connections are both ESP configurations and share the provider credential,
transport, test, and feedback lifecycle. Ownership scope, authorization, API
projection, grants, quota, and delivery-source type distinguish them.

This document supersedes the proposed
[`platform-customer.md`](./platform-customer.md) design. The useful delivery,
quota, feedback, pinning, and operational invariants from that document are
retained here under organization terminology.

## Release strategy and scope boundary

This PRD defines a durable ownership model, but it does **not** require every
possible delivery-platform enhancement before SendLit can offer organizations
to CourseLit, FrontLit, and similar customers.

The market-release plan is:

### Phase 1: market-ready organizations

Phase 1 must let a customer safely perform the complete normal workflow:

```text
sign up
  -> create/select an organization
  -> configure an organization ESP or allow team ESPs
  -> create/provision teams
  -> grant shared delivery where needed
  -> send transactional and sequence email through the selected source
  -> enforce team isolation, sender rules, suppression, and configured quota
```

Phase 1 is complete only when:

- organization and team membership are independent and enforced;
- organization keys provision only inside their organization;
- organization ESP credentials remain invisible to team members and team keys;
- CourseLit-style shared delivery and FrontLit-style team delivery both work;
- transactional and sequence sends resolve and pin the correct source and
  never fall back to another ESP;
- the current transactional and sequence pipelines keep their established
  enqueue, retry, feedback, and suppression behavior;
- organization quota cannot be bypassed or concurrently overshot;
- the dashboard supports the ordinary setup, grant, member, key, usage, and
  team-switching workflows;
- API contracts, migrations, critical tests, and browser smoke tests agree.

Phase 1 deliberately avoids rewriting otherwise-working campaign/sequence
scheduling merely to introduce a universal dispatcher. Existing sending paths
may continue when they satisfy source pinning, isolation, sender, suppression,
and quota requirements.

### Phase 2: delivery reliability hardening

Phase 2 extends the durable transactional dispatch-outbox pattern to every
campaign and sequence recipient, adds explicit `submission_unknown`
reconciliation for ambiguous provider calls, and completes crash-window
recovery and reservation reconciliation. These are important before offering
strict delivery SLAs, but they do not block an early controlled release when
the existing delivery pipelines remain operational.

### Phase 3: scale and operations

Phase 3 adds provider token buckets, per-team concurrency, weighted fairness,
advanced organization reputation automation, complete metrics/alerting, and
richer audit snapshots. These are required as shared-ESP traffic and the
number of customer teams grow; they are not part of the Phase 1 feature
completion claim.

### Scope interpretation

Unless a section explicitly says otherwise:

- **Phase 1** is the launch contract and implementation gate.
- **Phase 2** requirements are reliability backlog.
- **Phase 3** requirements are scale/operations backlog.
- Deferred requirements must not weaken the Phase 1 authorization, tenant
  isolation, credential secrecy, explicit source pinning, suppression, or
  quota invariants.

## Terminology

### User

A human authentication identity:

```text
user
  id
  email
  emailVerified
  name
  image
```

A user may belong to several organizations and teams. Authentication proves
identity; membership grants authorization. An email address supplied by an
external application is never an authorization grant by itself.

Users do not own teams, shared ESPs, quota, or platform provisioning
credentials.

Use Better Auth's default `user` model and `user` table for this identity.
Better Auth's separate default `account` model/table represents a linked
credential or provider identity such as Google. It is authentication data, not
a SendLit customer, organization, or authorization principal.

### Organization

The durable customer and administration boundary above teams. Examples:

- CourseLit;
- FrontLit;
- an agency;
- a company;
- a standalone customer's personal organization.

An organization owns teams, organization ESPs, organization keys, delivery
defaults, and optional aggregate quota policy.

### Organization member

A user with an explicit role in one organization:

- `owner`: full organization administration, including deletion and key/ESP
  administration;
- `admin`: normal organization administration, excluding owner-only destructive
  operations; or
- `member`: read/use access to organization-level non-secret surfaces only.

Organization membership does not automatically provide access to contacts,
templates, messages, or other tenant data inside every team.

### Team

The workspace and email-data boundary. Contacts, templates, campaigns,
sequences, transactional email, delivery logs, suppressions, media, general
settings, team API keys, and team-owned ESPs remain team-scoped.

Every team belongs to exactly one organization.

### Team member

A user explicitly authorized for one team:

- `admin`: administer the team and, when organization policy permits, its
  team-owned ESPs and delivery default; or
- `member`: use ordinary team resources but not security-sensitive team
  administration.

Team membership never grants organization membership or organization ESP
administration.

### Organization-owned ESP

An ESP configuration owned and administered at the organization level. It may
be granted to selected teams in the same organization.

The organization ESP's credentials, provider connection metadata, feedback
configuration, health, and test errors are visible only through
organization-authorized surfaces.

### Team-owned ESP

An ESP configuration owned and administered by exactly one team. It cannot be
shared with another team.

### Shared ESP

A convenience term for an organization-owned ESP that has an active grant to
one or more teams. `shared` is a relationship/use description, not a third
ownership scope or database resource type.

### ESP grant

The explicit authorization and delivery entitlement connecting one
organization-owned ESP to one team in the same organization. It carries
team-specific sender overrides, quota, status, and policy.

### Delivery source

The ownership scope of the ESP pinned to a send:

- `organization`: an organization-owned ESP reached through a valid grant;
- `team`: a team-owned ESP.

Avoid `managed`, `platform`, and `custom` as persisted ownership types. Those
words are contextual and do not identify who controls the connection.

## Problem

The current schema conflates login identity, ownership, quota, and
provisioning:

- the current SendLit `accounts` identity is separate from Better Auth's
  `auth_user` and carries daily/monthly mail
  quota.
- `teams.ownerAccountId` makes one human user the durable team owner.
- `team_members.role = owner` duplicates team ownership.
- `teams.externalId` is globally unique rather than namespaced to a customer.
- `esp_configs.teamId` requires every ESP to be copied into one team.
- A platform using one provider for many tenants must duplicate credentials and
  rotate each copy.
- A deployment-wide shared credential cannot identify or isolate an
  integration.
- Provisioning accepts `ownerEmail`, creates a SendLit identity, and grants that
  email owner membership.
- A school administrator can consequently gain SendLit access merely because
  their email was supplied for external ownership.
- Current user quota is shared by every team owned by the same user and
  changes meaning when ownership changes.
- Existing ESP APIs assume every configuration is team-manageable.

The desired hierarchy separates these concerns:

```text
user           = who authenticated
organization   = who owns teams and shared infrastructure
team           = email data boundary
ESP ownership  = who may administer the provider connection
ESP grant      = which team may use organization infrastructure
```

## Goals

### Phase 1 goals

1. Make organizations the only owner of teams.
2. Keep Better Auth users as immutable login identities with explicit,
   independent organization and team memberships.
3. Support organization-owned and team-owned ESP configurations in one
   constrained table.
4. Share an organization ESP with selected teams without copying credentials,
   while preventing team principals from reading or administering it.
5. Allow a team to use organization delivery, team delivery, or both, and
   enable CourseLit BYO ESP later without tenant migration.
6. Namespace external team IDs by organization.
7. Replace the global provisioning secret with scoped, hashed, revocable
   organization keys.
8. Provision teams idempotently with delivery settings, optional grant/quota,
   and a one-time team key.
9. Keep organization provisioning authority separate from team content access.
10. Resolve and pin the delivery source before transactional enqueue or
    sequence/broadcast activation and never silently switch sources.
11. Preserve the existing transactional and sequence sending behavior while
    applying the pinned source, sender, suppression, and quota rules.
12. Enforce organization-delivery quota per grant and optionally per
    organization without concurrent overshoot.
13. Preserve team-wide suppression and outbound-based feedback correlation.
14. Provide matching REST, OpenAPI, dashboard, and team MCP behavior.
15. Apply a clean database baseline with database-enforced tenant ownership and
    route-pin integrity.
16. Provide deterministic basic ESP/grant lifecycle behavior and universal
    team-facing redaction.

### Later-phase goals

17. Extend the durable PostgreSQL dispatch outbox and reconciliation model to
    all sequence and campaign recipients (Phase 2).
18. Add fail-closed `submission_unknown` handling and provider lookup/operator
    reconciliation for ambiguous submissions (Phase 2).
19. Add provider/team throughput limits, weighted fairness, complete metrics,
    alerting, and automated reputation controls (Phase 3).

## Non-goals

- Preserving local development data.
- Supporting a legacy deployment-wide credential compatibility window.
- Migrating production records; there are no production users.
- Allowing cross-organization ESP grants.
- Letting a team administer an organization ESP.
- Automatically granting an ESP merely because team and ESP share an
  organization; every use requires a grant.
- Multiple simultaneous organization ESP grants per team in Phase 1.
- A reseller key that creates arbitrary organizations.
- Billing, invoices, payment collection, and plan catalog design.
- Organization-wide sharing of contacts, templates, suppressions, or delivery
  history.
- Silent failover between organization and team ESPs.
- A generic organization-admin MCP server in Phase 1.
- Better Auth's API-key plugin. SendLit organization and team keys retain their
  explicit owner FKs and authorization services.
- Operating an MTA or becoming an ESP.
- Replacing the current sequence/campaign scheduler in Phase 1 when it already
  preserves the pinned source and required sending invariants.
- Universal campaign/sequence dispatch-outbox publication, ambiguous-provider
  reconciliation, or every documented Redis/PostgreSQL crash-window recovery
  in Phase 1; these are Phase 2.
- Weighted fair dispatch, per-provider token buckets, per-team concurrency
  leases, a complete metrics platform, and automatic reputation suspension in
  Phase 1; these are Phase 3.
- Treating richer operational automation as a blocker for the normal
  organization setup, provisioning, transactional-send, or sequence-send
  workflow.

## Core user flows

### Direct self-service customer

```text
1. Sign up.
2. SendLit creates a default organization.
3. User is added as organization owner.
4. User configures an optional organization-owned ESP.
5. User creates a team.
6. User is added as team admin.
7. Default organization ESP is granted when organization policy says so.
```

Steps 5–7 are one transaction. If the organization has no default ESP, the
team starts without an organization grant and may create a team ESP.

### CourseLit onboarding

```text
1. CourseLit operator signs up.
2. CourseLit organization is created.
3. Operator is its organization owner.
4. Operator configures CourseLit's organization ESP, tests it, and activates
   it. Resend/Postmark additionally require a reviewed feedback connection;
   custom SMTP shows the explicit synchronous-outcomes-only limitation.
5. Operator configures default grant/quota/sender policy.
6. Operator creates a least-privilege organization provisioning key.
7. CourseLit stores that key as a backend secret.
```

At school creation:

```text
1. CourseLit queues an idempotent provisioning job.
2. Organization key creates a team for the school.
3. SendLit grants the CourseLit ESP using organization defaults.
4. SendLit creates a team API key.
5. CourseLit stores teamId and the encrypted team key against the school.
```

No user or team membership is created for the school administrator. If
CourseLit later wants direct SendLit access, it explicitly invites that user
as a team member. That membership provides no organization access.

### FrontLit onboarding

```text
1. FrontLit organization is created.
2. FrontLit creates an organization provisioning key.
3. FrontLit provisions one SendLit team per FrontLit team.
4. New teams have team ESP configuration enabled.
5. Each FrontLit team connects its own ESP through team-scoped APIs.
```

FrontLit need not create an organization ESP. It may add one later and grant it
to selected teams.

### CourseLit enables BYO ESP later

```text
1. CourseLit enables team ESPs for a school.
2. CourseLit UI collects the school's provider configuration.
3. CourseLit backend uses the school's stored team API key.
4. SendLit creates a team-owned ESP.
5. The school explicitly chooses organization or team delivery as default.
```

Adding the first team ESP never changes the delivery default implicitly.

## Authorization model

### Principles

- Authentication never implies organization or team access.
- Every organization action resolves an explicit membership or
  organization-key scope.
- Every team action resolves an explicit membership or fixed team key.
- Organization membership does not implicitly expose team data.
- Team membership never authorizes organization endpoints.
- Organization ESP grants authorize sending only, not ESP administration.
- Organization and team API keys are distinct credential types.
- A request authenticated with one key type never silently acquires the other
  scope.
- Public IDs are identifiers, not authorization tokens.

### Authorization matrix

| Principal           | Organization settings  | Organization ESP        | Team lifecycle/grants         | Team data                     | Team ESP                      |
| ------------------- | ---------------------- | ----------------------- | ----------------------------- | ----------------------------- | ----------------------------- |
| Organization owner  | Manage                 | Manage                  | Manage                        | Only with team membership/key | Only with team membership/key |
| Organization admin  | Manage non-destructive | Manage                  | Manage                        | Only with team membership/key | Only with team membership/key |
| Organization member | Read allowed metadata  | No secret/admin access  | No                            | Only with team membership/key | Only with team membership/key |
| Team admin          | No                     | Sanitized use view only | Own team policy where allowed | Manage own team               | Manage when enabled           |
| Team member         | No                     | Sanitized use view only | No                            | Use own team                  | No administration             |
| Organization key    | By scope               | By scope                | By scope                      | No implicit access            | No implicit access            |
| Team key            | No                     | Sanitized use view only | No organization operations    | One fixed team                | One fixed team when enabled   |

An organization owner may create/rotate a team key through an audited
organization operation and then use that explicit team credential. The
organization session/key itself does not bypass `requireTeam`.

### Normative action permissions

The following table is authoritative. "Manage" in the summary matrix above
must not be interpreted more broadly than these actions.

| Organization action                                    | Owner | Admin | Member | Organization key                       |
| ------------------------------------------------------ | ----- | ----- | ------ | -------------------------------------- |
| Read organization public metadata                      | Yes   | Yes   | Yes    | `organization:read`                    |
| Rename organization                                    | Yes   | Yes   | No     | No                                     |
| Close organization                                     | Yes   | No    | No     | No                                     |
| List organization members                              | Yes   | Yes   | Yes    | No                                     |
| Add/remove ordinary members or change `member ↔ admin` | Yes   | Yes   | No     | No                                     |
| Add/remove/demote an owner                             | Yes   | No    | No     | No                                     |
| Create/list/revoke organization keys                   | Yes   | No    | No     | No; an API key cannot mint another key |
| Create/update/test/rotate organization ESP             | Yes   | Yes   | No     | `esps:manage`                          |
| Retire/delete organization ESP                         | Yes   | No    | No     | No                                     |
| Read organization ESP metadata/health                  | Yes   | Yes   | No     | `esps:read`                            |
| Change organization delivery/quota policy              | Yes   | Yes   | No     | No                                     |
| Create/update/archive teams                            | Yes   | Yes   | No     | `teams:provision` / `teams:manage`     |
| Physically purge organization/team                     | No    | No    | No     | No; operator retention workflow only   |
| Create/suspend/resume/revoke an ESP grant              | Yes   | Yes   | No     | `grants:manage`                        |
| Create/rotate/revoke a team key                        | Yes   | Yes   | No     | `teams:keys`                           |
| Read organization-wide usage/reputation                | Yes   | Yes   | No     | `usage:read`                           |

An organization admin cannot grant or acquire the `owner` role. The last-owner
invariant is enforced in the same transaction as every owner membership
mutation.

Team actions are authoritative as follows:

| Team action                                      | Team admin                       | Team member                        | Team key          |
| ------------------------------------------------ | -------------------------------- | ---------------------------------- | ----------------- |
| Read/use ordinary team content                   | Yes                              | Yes                                | Yes               |
| Manage contacts, templates, campaigns, sequences | Yes                              | As allowed by existing team policy | Yes               |
| Manage team membership                           | Yes                              | No                                 | No                |
| Create/update/test/retire a team ESP             | Yes, when enabled                | No                                 | Yes, when enabled |
| Change delivery default                          | Yes, when `teamCanChangeDefault` | No                                 | Yes, when allowed |
| Read sanitized organization sending option/usage | Yes                              | Yes                                | Yes               |

Organization roles never substitute for a team role or team key on these team
actions.

## Domain model

SendLit domain IDs follow the existing convention: internal UUIDv7 primary
keys and opaque public handles at API edges. Better Auth owns the core
authentication models and their string IDs.

### Better Auth users and accounts

Use Better Auth's default core models and table names. Do not set `modelName`
for `user`, `session`, `account`, or `verification`:

```text
user
  id                       text PK
  email                    text NOT NULL UNIQUE
  email_verified           boolean NOT NULL DEFAULT false
  name                     text NOT NULL DEFAULT ''
  image                    text nullable
  default_organization_id  uuid nullable
                           FK -> organizations.id ON DELETE SET NULL
  created_at               timestamptz NOT NULL
  updated_at               timestamptz NOT NULL

session
  ...
  user_id                  text NOT NULL FK -> user.id ON DELETE CASCADE

account
  ...
  user_id                  text NOT NULL FK -> user.id ON DELETE CASCADE

verification
  ...
```

`user` is the only human application identity. The existing SendLit `accounts`
table is removed; there is no second `auth_user` row and no email-based
identity bridge. `defaultOrganizationId` is added to Better Auth's `user`
model through `user.additionalFields` and represented in the Drizzle schema.

`defaultOrganizationId` is an onboarding/navigation pointer only. It never
authorizes organization access; every request still requires an
`organization_members` row. It is nullable while first-login bootstrap is
pending. It is not unique: multiple users may select the same organization as
their default.

Better Auth's `account` row stores linked provider/credential data such as
`(providerId, accountId)` and belongs to one `user`. It is not an organization,
customer, billing account, membership, or SendLit authorization principal.
The `session` and `verification` tables likewise retain Better Auth's defaults.
JWT/JWK and OAuth-provider plugin tables retain the plugins' default model names
unless a documented plugin constraint requires otherwise; they reference
`user.id` directly where applicable.

External identity linking and email changes are performed only through Better
Auth's verified provider/account-linking rules. Other than an explicit,
organization-admin membership lookup of an existing user, SendLit never finds,
creates, merges, or authorizes a user by matching a request email. Sessions resolve
`session.user.id` directly to `user.id`; OAuth bearer `sub` is the same stable
user ID.

Direct Better Auth user deletion is not exposed as an independent destructive
path. SendLit's user-deletion service first enforces last-organization-owner
and retention rules, removes/transfers explicit memberships, revokes sessions
and linked provider accounts, and only then deletes/anonymizes the user.
Membership FKs use `RESTRICT` so a Better Auth deletion cannot silently
cascade through authorization records.

Remove all quota fields:

```text
daily_mail_limit
monthly_mail_limit
daily_mail_count
monthly_mail_count
counters_reset_at
```

Quota belongs to organization ESP grants and optional organization aggregate
policy, not human identities.

### Organizations

```text
organizations
  id               uuid PK
  organization_id  text NOT NULL UNIQUE       -- org_...
  name             text NOT NULL
  status           text NOT NULL DEFAULT active
                   -- active | suspended | closed
  created_at       timestamptz
  updated_at       timestamptz
```

Rules:

- `suspended` blocks new organization provisioning and organization-ESP
  dispatch while preserving reads, feedback ingestion, and data.
- `closed` is terminal through customer APIs. Closing atomically revokes
  organization keys, blocks both organization- and team-source dispatch for
  every child team, cancels unaccepted queued work and releases its
  reservations, and blocks mutations while preserving owner read/export and
  feedback ingestion during retention.
- `DELETE /organizations/:organizationId` closes the organization; it does not
  physically cascade tenant data.
- Physical purge is an operator-only retention/privacy workflow. It explicitly
  deletes or anonymizes dependants in dependency order after the retention
  window; ordinary organization/team/ESP FKs never erase delivery history by
  cascade.

### Organization members

```text
organization_members
  id               uuid PK
  organization_id  uuid NOT NULL FK -> organizations.id ON DELETE CASCADE
  user_id          text NOT NULL FK -> user.id ON DELETE RESTRICT
  role             text NOT NULL    -- owner | admin | member
  created_at       timestamptz
  updated_at       timestamptz

  UNIQUE (organization_id, user_id)
```

Invariants:

- An active organization has at least one owner.
- The last owner cannot leave, be removed, or be demoted.
- Removing an organization member does not remove independent team
  memberships.
- Organization membership changes are audited.

### Teams

```text
teams
  id               uuid PK
  team_id          text NOT NULL UNIQUE       -- team_...
  organization_id  uuid NOT NULL FK -> organizations.id ON DELETE RESTRICT
  external_id      text nullable
  provisioning_request_hash text nullable
  name             text NOT NULL
  status           text NOT NULL DEFAULT active
                   -- active | sending_suspended | archived
  created_at       timestamptz
  updated_at       timestamptz

  UNIQUE (organization_id, external_id)
    WHERE external_id IS NOT NULL
  UNIQUE (id, organization_id)
```

Remove `ownerAccountId`. The organization owns the team; users receive team
access only through `team_members`.

`externalId` is immutable after creation and unique only within the
organization. Two organizations may use the same external ID.
`provisioningRequestHash` is set only for provisioned teams and contains the
hash of the canonical creation request used for replay conflict detection.

`sending_suspended` blocks new activation/enqueue and worker dispatch while
preserving reads, inbound feedback, and queued state for resume. `archived` is
terminal through customer APIs, revokes team keys, cancels/releases unaccepted
queued work, and preserves historical data for retention.

### Team members

```text
team_members
  id          uuid PK
  team_id     uuid NOT NULL FK -> teams.id ON DELETE CASCADE
  user_id     text NOT NULL FK -> user.id ON DELETE RESTRICT
  role        text NOT NULL    -- admin | member
  created_at  timestamptz
  updated_at  timestamptz

  UNIQUE (team_id, user_id)
```

There is no team `owner` role because the organization owns the team.

Human-created teams add their creator as `admin`. API-provisioned teams create
no human membership unless a separate explicit membership operation requests
one.

For an authenticated user's `GET /teams` list and the MCP `list_teams` tool,
each team includes its public `organizationId` and `organizationName`. These
are workspace-context fields only: they let clients group a member's teams by
organization and do not grant organization administration or ESP access.

### Organization API keys

```text
organization_api_keys
  id                       uuid PK
  organization_api_key_id  text NOT NULL UNIQUE       -- oak_...
  organization_id          uuid NOT NULL FK -> organizations.id ON DELETE CASCADE
  name                     text NOT NULL
  key_hash                 text NOT NULL UNIQUE
  key_prefix               text NOT NULL
  scopes                   text[] NOT NULL
  expires_at               timestamptz nullable
  last_used_at             timestamptz nullable
  revoked_at               timestamptz nullable
  created_by_user_id       text nullable FK -> user.id ON DELETE SET NULL
  created_at               timestamptz
```

Plaintext keys use a distinct prefix such as `sl_org_live_...`, are returned
once, and are stored only as a cryptographic hash.

Supported Phase 1 scopes:

- `organization:read`
- `teams:provision`
- `teams:read`
- `teams:manage`
- `teams:keys`
- `esps:read`
- `esps:manage`
- `grants:manage`
- `usage:read`

The common CourseLit runtime key should omit `esps:manage`; provider
credentials are configured through a more privileged dashboard session or
separate key.

### Team API keys

Keep team API keys fixed to exactly one team. Add optional expiry, last-used,
revocation timestamp, and creator attribution while rewriting the baseline:

```text
team_api_keys
  id                     uuid PK
  team_api_key_id        text NOT NULL UNIQUE       -- tak_...
  team_id                uuid NOT NULL FK -> teams.id ON DELETE CASCADE
  name                   text NOT NULL
  key_hash               text NOT NULL UNIQUE
  key_prefix             text NOT NULL
  expires_at             timestamptz nullable
  last_used_at           timestamptz nullable
  revoked_at             timestamptz nullable
  created_by_type        text NOT NULL  -- user | organization_key | system
  created_by_id          text nullable
  created_at             timestamptz
```

The existing `sl_live_...` plaintext prefix may remain for team keys.

### ESP configurations

Use one `esp_configs` table with immutable ownership:

```text
esp_configs
  id                uuid PK
  esp_id            text NOT NULL UNIQUE       -- esp_...
  owner_scope       text NOT NULL              -- organization | team
  organization_id   uuid nullable FK -> organizations.id ON DELETE RESTRICT
  team_id           uuid nullable FK -> teams.id ON DELETE RESTRICT
  name              text NOT NULL
  provider          text NOT NULL
  host              text NOT NULL
  port              integer NOT NULL
  secure            boolean NOT NULL
  username          text nullable
  encrypted_secret  text nullable
  from_name         text nullable
  from_email        text nullable
  status            text NOT NULL DEFAULT draft
                    -- draft | active | suspended | draining | retired
  secret_version    integer NOT NULL DEFAULT 1
  last_tested_at    timestamptz nullable
  last_test_status  text nullable
  last_test_error   text nullable
  activated_at      timestamptz nullable
  drain_until       timestamptz nullable
  retired_at        timestamptz nullable
  created_at        timestamptz
  updated_at        timestamptz

  UNIQUE (id, organization_id)
  UNIQUE (id, team_id)
```

Checks:

```text
owner_scope = organization:
  organization_id IS NOT NULL
  team_id IS NULL

owner_scope = team:
  organization_id IS NULL
  team_id IS NOT NULL
```

Ownership scope and owner FK are immutable. Moving an ESP requires creating a
new configuration and explicitly transitioning sends/grants.

ESP lifecycle:

- `draft` may be edited and tested but cannot be selected or granted.
- `active` requires a successful connection test after the latest credential
  or transport change and a valid sender identity.
- `suspended` blocks new pins and worker dispatch. Existing work remains
  paused and may resume if the ESP returns to `active`.
- `draining` blocks new pins but permits already-pinned work until
  `drainUntil`. At the deadline, remaining queued work is cancelled and its
  uncommitted quota reservations are released before the ESP becomes
  `retired`.
- `retired` is terminal, cannot send, and remains addressable by historical
  records.

Changing provider, host, port, secure mode, username, secret, or sender email
increments `secretVersion`, clears the successful-test eligibility, and moves
an active ESP to `draft`. Credential rotation is an update to the same stable
ESP ID; workers invalidate cached transports by `(espConfigId, secretVersion)`.
Changing only the display name does not invalidate connection verification.

`POST .../retire` performs retirement. `DELETE` performs physical deletion and
is allowed only for a never-activated draft with no grant, feedback connection,
pinned work, outbound message, or audit reference. Historical FKs use
`RESTRICT` or soft-retained references; they never cascade-delete delivery or
feedback history. Operator-only organization/team purge workflows retire and
then explicitly delete/anonymize dependants in retention order.

Do not store `isDefault` on `esp_configs`. Default source is team-specific and
belongs in delivery settings.

Organization ESP sender rules:

- `fromEmail` is controlled by the organization ESP and is not overridable by
  a team.
- `fromName` is an organization fallback; a grant may provide a team-specific
  display name.
- Provider/connection data is never serialized through team APIs.

Team ESP sender rules:

- `fromName` and `fromEmail` belong to the team configuration.
- A platform-integrated team with no human owner must provide a valid
  sender identity; there is no owner-email fallback.

### Provider capability contract

Provider names do not imply capabilities. Maintain one server-side provider
capability registry with:

```text
send
testConnection
returnsProviderMessageId
feedbackAdapter
supportsIdempotencyKey
lookupSubmission
feedbackRequiredForOrganizationDelivery
```

Phase 1 provider decisions:

- `resend` and `postmark` are the initial reviewed asynchronous feedback
  adapters.
- `smtp` is the single custom-SMTP option. It is synchronous-only and has no
  bounce/complaint adapter. It may be activated for organization delivery
  after a current successful connection test and a configured sender address.
  The organization admin UI labels it **SMTP outcomes only**: SendLit records
  SMTP acceptance or failure but cannot learn asynchronous bounces or
  complaints. The organization UI/API must not expose a second generic
  `custom` provider choice.
- Providers with a reviewed feedback adapter (`resend` and `postmark` in
  Phase 1)
  additionally require a healthy feedback connection before activation.
- `ses`, `sendgrid`, and `mailgun` currently use the same test-verified-only
  policy until their reviewed feedback adapters ship. This is a deliberate,
  visible capability policy rather than an operator bypass.
- Organization delivery always requires `send`; `transitionEspConfig` also
  requires a current successful test and `fromEmail` for every provider.
- Provider acceptance means the adapter returned its documented acceptance
  result. When supported, the provider message ID is stored before quota is
  committed.
- The outbound message ID is used as the provider idempotency key when the
  adapter supports one.

Adding another provider is a code-and-test change to the capability registry,
not a database migration. API validation, activation, workers, and feedback
configuration all read the same registry.

### Organization delivery policy

```text
organization_delivery_policies
  id                              uuid PK
  organization_id                 uuid NOT NULL UNIQUE FK
  default_esp_config_id           uuid nullable
  auto_grant_default_esp          boolean NOT NULL DEFAULT false
  default_daily_limit             integer nullable
  default_monthly_limit           integer nullable
  aggregate_daily_limit           integer nullable
  aggregate_monthly_limit         integer nullable
  team_esp_enabled_by_default     boolean NOT NULL DEFAULT true
  team_can_change_default         boolean NOT NULL DEFAULT true
  created_at                      timestamptz
  updated_at                      timestamptz

  FOREIGN KEY (default_esp_config_id, organization_id)
    -> esp_configs(id, organization_id) ON DELETE RESTRICT
  CHECK every non-null limit >= 0
```

`defaultEspConfigId` must reference an organization-owned ESP belonging to the
same organization. The composite FK enforces this in PostgreSQL; handlers do
not carry this invariant alone. Only an `active` ESP may be set as the default.

Policy defaults are copied into a new team/grant. Later policy edits do not
silently rewrite existing teams; bulk application is a separate explicit,
audited operation.

`null` quota means unlimited; `0` means disabled.

### ESP grants

Phase 1 permits at most one non-revoked organization ESP grant per team:

```text
esp_config_team_grants
  id                    uuid PK
  grant_id              text NOT NULL UNIQUE       -- egr_...
  organization_id       uuid NOT NULL
  esp_config_id         uuid NOT NULL
  team_id               uuid NOT NULL
  status                text NOT NULL DEFAULT active
                        -- active | draining | suspended | revoked
  drain_until           timestamptz nullable
  from_name             text nullable
  reply_to              text nullable
  daily_limit           integer nullable
  monthly_limit         integer nullable
  created_by_type       text NOT NULL
                        -- user | organization_key | system
  created_by_id         text nullable
  created_at            timestamptz
  updated_at            timestamptz

  UNIQUE (team_id) WHERE status != 'revoked'
  UNIQUE (id, team_id, esp_config_id)
  UNIQUE (id, organization_id)
  FOREIGN KEY (team_id, organization_id)
    -> teams(id, organization_id) ON DELETE RESTRICT
  FOREIGN KEY (esp_config_id, organization_id)
    -> esp_configs(id, organization_id) ON DELETE RESTRICT
  CHECK daily_limit IS NULL OR daily_limit >= 0
  CHECK monthly_limit IS NULL OR monthly_limit >= 0
```

Database and transaction invariants:

- The composite FKs require an organization-owned ESP and a team in the same
  organization. A team ESP has `organizationId = null` and cannot satisfy the
  grant FK.
- Revoked grants cannot be restored; create a new grant for a new audit
  identity.
- `active` permits new pins/reservations and dispatch.
- `draining` blocks new activations/pins but permits work pinned before the
  transition to create/reuse reservations and dispatch until `drainUntil`.
- `suspended` blocks new pins and dispatch while retaining pinned work,
  reservations, history, and feedback. Resuming returns it to `active`.
- `revoked` is terminal. Revoke completes only after pinned work is drained or
  cancelled and every uncommitted reservation is committed or released.
- A grant authorizes use only; it never authorizes ESP reads, tests, updates,
  feedback configuration, or secret rotation.
- `PUT /organizations/:organizationId/teams/:teamId/esp-grant` accepts an
  explicit `makeDefault: true` option. Organization owners/admins and scoped
  organization keys may use it to make the granted source the team's default;
  a routine grant never changes an existing team choice implicitly.

Grant removal requires an explicit transition:

- `drain`: move to `draining`; default deadline is 24 hours and the accepted
  range is 5 minutes through 7 days. At the deadline cancel remaining work,
  release uncommitted reservations, and mark `revoked`.
- `suspend`: move to `suspended` and retain work/reservations for later resume.
- `cancel`: atomically cancel queued/pinned work, release uncommitted
  reservations, and mark `revoked`.

There is at most one non-revoked grant per team. A replacement ESP therefore
uses `drain` or `cancel` to revoke the old grant before creating the new one.

### Team delivery settings

```text
team_delivery_settings
  id                          uuid PK
  team_id                     uuid NOT NULL UNIQUE FK
  team_esp_enabled            boolean NOT NULL DEFAULT true
  team_can_change_default     boolean NOT NULL DEFAULT true
  default_source              text nullable       -- organization | team
  default_team_esp_config_id  uuid nullable
  created_at                  timestamptz
  updated_at                  timestamptz

  FOREIGN KEY (default_team_esp_config_id, team_id)
    -> esp_configs(id, team_id) ON DELETE RESTRICT
```

Rules:

- `defaultSource = organization` requires an active grant.
- `defaultSource = team` requires team ESPs to be enabled and a valid default
  team-owned ESP.
- The composite FK guarantees that `defaultTeamEspConfigId` is a team-owned ESP
  belonging to this team. Only an `active` ESP may be selected.
- Organization delivery availability is derived from an active grant; do not
  duplicate it as a boolean setting.
- Adding a team ESP never changes `defaultSource`.
- Disabling a source used by active/paused work requires explicit
  `drain | suspend | cancel` transition behavior.

### General team settings

Keep mailing address and other workspace settings team-scoped. Marketing sends
through either source require the team's mailing address and SendLit-managed
footer.

## ESP API boundaries

Shared table storage must not produce shared API authorization.

### Organization ESP API

```text
GET    /organizations/:organizationId/esps
POST   /organizations/:organizationId/esps
GET    /organizations/:organizationId/esps/:espId
PATCH  /organizations/:organizationId/esps/:espId
POST   /organizations/:organizationId/esps/:espId/test
POST   /organizations/:organizationId/esps/:espId/activate
POST   /organizations/:organizationId/esps/:espId/suspend
POST   /organizations/:organizationId/esps/:espId/resume
POST   /organizations/:organizationId/esps/:espId/retire
DELETE /organizations/:organizationId/esps/:espId
GET    /organizations/:organizationId/esps/:espId/feedback
PUT    /organizations/:organizationId/esps/:espId/feedback
POST   /organizations/:organizationId/esps/:espId/feedback/rotate
POST   /organizations/:organizationId/esps/:espId/feedback/test
DELETE /organizations/:organizationId/esps/:espId/feedback
```

Requires an organization owner/admin session or organization key with the
appropriate ESP scope. Responses may include connection metadata and test
health but never plaintext credentials.

`POST .../retire` is owner-only and requires `{ transition: "drain" |
"cancel", drainUntil? }`. `DELETE` is owner-only physical deletion and succeeds
only for an eligible never-activated draft. An admin/key may suspend or resume
an ESP but cannot retire/delete it. Activation evaluates the provider
capability contract as well as connection verification and sender identity.

The dashboard provides an organization administration workspace for shared
ESPs, feedback setup, delivery policy, team grants, and organization API keys.
The delivery-policy form chooses the default shared ESP, auto-grant/default
behavior for new teams, quotas, and whether newly provisioned teams can later
add or select their own ESP. It is the self-service setup path for the
CourseLit environment-variable integration described below.

Retiring an organization ESP applies one atomic transition to all of its
non-revoked grants. `drain` moves the ESP and grants to `draining` with the
same deadline; `cancel` cancels unaccepted work, releases reservations, revokes
the grants, and retires the ESP. A suspended grant remains non-dispatchable
during drain and is cancelled at the deadline. No team is silently moved to
another organization or team ESP.

Organization feedback routes require `esps:read` for `GET` and `esps:manage`
for mutations. Feedback credential rotation shows no plaintext after the
write; `DELETE` disables/retires the connection without deleting received
history. Rotation keeps the previous credential valid for 24 hours for
in-flight provider retries. Disabling the required feedback connection on an
active organization ESP atomically suspends the ESP. Changing provider retires
the old feedback connection and returns the ESP to `draft`.

### Team ESP API

Existing team ESP routes continue conceptually:

```text
GET    /settings/esps
POST   /settings/esps
GET    /settings/esps/:espId
PATCH  /settings/esps/:espId
POST   /settings/esps/:espId/test
POST   /settings/esps/:espId/activate
POST   /settings/esps/:espId/suspend
POST   /settings/esps/:espId/resume
POST   /settings/esps/:espId/retire
DELETE /settings/esps/:espId
GET    /settings/esps/:espId/feedback
PUT    /settings/esps/:espId/feedback
POST   /settings/esps/:espId/feedback/rotate
POST   /settings/esps/:espId/feedback/test
DELETE /settings/esps/:espId/feedback
```

Team `retire` and `DELETE` use the same transition/physical-deletion semantics
within team authorization. Team feedback routes remain structurally restricted
to team-owned ESPs.

Every query is structurally restricted to:

```text
owner_scope = team
AND team_id = req.teamId
```

They never list an organization-owned row, even if it is granted to the team.
When `teamEspEnabled = false`, mutation/test operations return
`403 team_esp_disabled`; listing may show existing team-owned rows read-only so
configuration is not lost during a temporary policy change.

### Separate serializers

Never use one generic ESP serializer across ownership scopes:

- `serializeOrganizationEsp`: organization-authorized connection view;
- `serializeTeamEsp`: team-owned connection view;
- `serializeOrganizationSendingOption`: sanitized grant-derived view.

This is a defense-in-depth requirement, not a style preference.

## Team-facing sending options

Add:

```text
GET /sending-options
GET /settings/delivery
PATCH /settings/delivery
```

Example:

```jsonc
{
    "items": [
        {
            "type": "organization",
            "name": "CourseLit Email Service",
            "fromName": "Jane Doe",
            "fromEmail": "no-reply@comm.courselit.app",
            "replyTo": "jane@school.example",
            "isDefault": true,
            "available": true,
            "countsAgainstQuota": true,
        },
        {
            "type": "team",
            "espId": "esp_...",
            "name": "School Amazon SES",
            "fromName": "Acme School",
            "fromEmail": "hello@school.example",
            "isDefault": false,
            "available": true,
            "countsAgainstQuota": false,
        },
    ],
}
```

The organization option never includes:

- organization `espId`;
- organization ID;
- provider;
- host, port, secure mode, or username;
- secret presence/version/reference;
- feedback connection;
- test status/error;
- connection health or topology.

It exposes only effective sender, availability, default, and quota information
needed by the team.

Phase 1 has at most one active organization grant, so team-facing selection is:

```jsonc
{ "deliverySource": { "type": "organization" } }
```

Team selection is:

```jsonc
{
    "deliverySource": {
        "type": "team",
        "espId": "esp_...",
    },
}
```

The existing `espId` request field may be replaced directly because there are
no production API consumers requiring compatibility.

### Universal team-facing redaction

The sanitized organization projection applies to every team-authorized
surface, not only `/sending-options`. This includes:

- transactional email create/get/list responses;
- campaign and sequence create/get/list responses;
- outbound message and delivery-log responses;
- delivery-event and suppression responses;
- webhook/error payloads visible to a team;
- dashboard queries; and
- team MCP tool results.

For organization delivery these surfaces expose, at most:

```jsonc
{
    "deliverySource": { "type": "organization" },
    "sender": {
        "fromName": "Jane Doe",
        "fromEmail": "no-reply@comm.courselit.app",
        "replyTo": "jane@school.example",
    },
}
```

They never expose the organization ESP public/internal ID, organization ID,
grant ID, provider, provider message ID, feedback connection ID, credentials,
transport/test health, or topology. Provider-specific error text is mapped to
a stable sanitized delivery code.

For team delivery, team-authorized surfaces may expose the team's own `espId`
and provider metadata according to existing team permissions. Organization
owners/admins may see organization ESP and provider details only through
organization-authorized operations. Internal correlation fields remain
available to workers, operators, and audit/observability systems with
appropriate access.

## Delivery-source resolution and pinning

### Resolution

If a request explicitly selects a source:

- `organization` resolves the team's active grant and its organization ESP;
- `team` resolves the supplied/default team-owned ESP and verifies ownership.

If no source is supplied:

1. Use `team_delivery_settings.defaultSource`.
2. If no default exists and exactly one usable source type exists, use it.
3. If no usable source exists, return `delivery_source_unavailable`.
4. If more than one usable source exists, return `delivery_source_required`.

There is no arbitrary first-record fallback and no implicit preference for a
newly created team ESP.

### Persisted source

Use:

```text
delivery_source_type  organization | team
outbox_id             uuid FK -> esp_configs.id
esp_grant_id          uuid nullable FK -> esp_config_team_grants.id
```

Checks:

```text
organization:
  outbox_id required
  esp_grant_id required

team:
  outbox_id required
  esp_grant_id null
```

Cross-table ownership checks occur in the same transaction that activates or
queues work.

Route-bearing tables also enforce the pin at the database boundary. Each such
table has a deferred constraint trigger with these rules:

- `teamId`, `outboxId`, and `espGrantId` cannot change after
  activation/enqueue;
- for `team`, `(outboxId, teamId)` must match
  `esp_configs(id, team_id)` and `espGrantId` must be null;
- for `organization`, `(espGrantId, teamId, outboxId)` must match
  `esp_config_team_grants(id, team_id, esp_config_id)`; and
- the referenced ESP/grant must be usable when the row first becomes
  active/queued.

The composite unique keys shown in the schema support those checks. The
constraint trigger is part of the baseline migration and is tested directly;
application validation remains defense in depth.

Persist these fields on:

- sequences/broadcasts;
- transactional emails; and
- outbound messages.

For a transactional email, resolve and pin before the row becomes queued. For
a broadcast or sequence, resolve and pin atomically with activation.

After pinning:

- changing defaults affects only future activations/enqueues;
- changing ESP credentials keeps the logical ESP ID and affects future
  transport attempts intentionally;
- retiring a referenced ESP requires explicit `drain | cancel`; physical
  deletion is rejected while any work/history references it;
- changing or removing a grant follows explicit
  `drain | suspend | resume | cancel` behavior;
- workers never fall back from organization to team delivery or vice versa;
  and
- retries reuse source, outbox, grant, outbound row, RFC Message-ID, and quota
  reservation.

## Sender identity

Organization delivery:

```text
display name:
  grant.fromName
  -> organization ESP.fromName
  -> team.name

email:
  organization ESP.fromEmail

reply-to:
  per-message replyTo when policy permits
  -> grant.replyTo
  -> null
```

Team delivery:

```text
display name:
  team ESP.fromName
  -> team.name

email:
  team ESP.fromEmail
```

Do not fall back to a user email for either source. Users are identities,
not sender configurations.

From, Reply-To, display name, subject, and custom headers reject CR/LF
injection. The resolved sender is snapshotted on each outbound message before
provider submission.

## Quota and usage

Quota applies only to organization delivery. Team-owned ESP sends use the
team's provider and bypass SendLit organization-delivery quota.

### Quota policy

An ESP grant carries the team's daily/monthly limit. The organization delivery
policy may add aggregate daily/monthly limits across all grants.

Quota periods are calendar UTC:

- day: `[00:00 UTC, next 00:00 UTC)`;
- month: first day of month through first day of next month.

Limits are nullable non-negative integers. `null` is unlimited and `0` blocks
new reservations. Limit mutations apply immediately to new reservations:

- Increasing a limit makes the added capacity immediately available.
- Decreasing a limit never cancels, refunds, or rewrites accepted or reserved
  usage.
- If `acceptedCount + reservedCount` already exceeds the new limit, remaining
  capacity is reported as `0` and new reservations wait until usage falls
  within the next applicable period.
- An existing reservation is honored while its grant/ESP remains dispatchable.
- Suspending a grant/ESP freezes its reservations; resuming reuses them.
- Draining permits work pinned before the transition to create/reuse
  reservations and complete until the deadline.
- Cancelling/revoking releases every uncommitted reservation transactionally.

Usage responses report configured limit, accepted, reserved, remaining
(`max(0, limit - accepted - reserved)`), and reset time for both day and month.
Organization aggregate limits are optional in Phase 1; `null` disables that
aggregate boundary.

### Usage buckets

```text
organization_esp_usage_buckets
  id               uuid PK
  bucket_scope     text NOT NULL       -- grant | organization
  organization_id  uuid NOT NULL FK
  grant_id         uuid nullable
  period_type      text NOT NULL       -- day | month
  period_start     timestamptz NOT NULL
  reserved_count   integer NOT NULL DEFAULT 0
  accepted_count   integer NOT NULL DEFAULT 0
  updated_at       timestamptz

  CHECK bucket_scope = grant        -> grant_id IS NOT NULL
  CHECK bucket_scope = organization -> grant_id IS NULL
  CHECK reserved_count >= 0 AND accepted_count >= 0
  FOREIGN KEY (grant_id, organization_id)
    -> esp_config_team_grants(id, organization_id) ON DELETE RESTRICT
  UNIQUE (grant_id, period_type, period_start) WHERE grant_id IS NOT NULL
  UNIQUE (organization_id, period_type, period_start)
    WHERE bucket_scope = organization
```

### Reservations

```text
organization_esp_quota_reservations
  id                    uuid PK
  reservation_id        text NOT NULL UNIQUE       -- qrs_...
  outbound_message_id   uuid NOT NULL UNIQUE FK
  grant_id              uuid NOT NULL FK
  organization_id       uuid NOT NULL FK
  day_period_start      timestamptz NOT NULL
  month_period_start    timestamptz NOT NULL
  state                 text NOT NULL
                        -- reserved | committed | released
  release_reason        text nullable
  created_at            timestamptz
  committed_at          timestamptz nullable
  released_at           timestamptz nullable

  FOREIGN KEY (grant_id, organization_id)
    -> esp_config_team_grants(id, organization_id) ON DELETE RESTRICT
```

A database constraint trigger verifies that each reservation's outbound
message is an organization-source row pinned to the same grant, organization,
team, and ESP. These relationships are immutable after reservation.

Reservation algorithm:

1. Create/reuse the outbound row.
2. Lock or conditionally upsert grant and applicable organization buckets in
   one database transaction.
3. Confirm every configured limit has capacity.
4. Increment `reservedCount` and create one reservation.
5. Provider acceptance moves reserved to accepted and commits the reservation.
6. Pre-acceptance suppression, cancellation, permanent configuration failure,
   or terminal rejection releases it.
7. Retry reuses it.
8. A later bounce or complaint does not refund provider-accepted usage.
9. Phase 2 adds a reconciler for crash-window stale reservations. It uses
   outbound and queue state; age alone never releases a potentially live
   submission.

Quota policy changes, grant transitions, outbound state, reservation state, and
bucket counters are mutated in database transactions. Redis and BullMQ state
is never the source of truth for whether quota was consumed.

This prevents concurrent workers from exceeding a limit while counting only
provider-accepted submissions as usage.

### Transactional quota failure (Phase 1)

`POST /emails` reserves before returning `202`.

- Grant exhausted: `429 organization_team_quota_exhausted`.
- Aggregate organization exhausted:
  `429 organization_quota_exhausted`.
- Return `Retry-After` for the relevant reset.
- Idempotency lookup occurs before reservation.
- Failed reservation leaves no persisted transactional message or queue job.

### Campaign/sequence quota exhaustion

Do not reserve an entire audience at activation. Reserve per recipient when
the outbound becomes dispatchable.

Phase 1 behavior is deliberately small and fail-closed:

- the recipient is not sent while either applicable limit is exhausted;
- the existing sequence/campaign scheduling mechanism retains or retries the
  due work instead of changing delivery source;
- quota exhaustion is not treated as a provider acceptance and consumes no
  quota; and
- a later retry reuses the same pinned source.

Phase 2 adds a first-class `quota_deferred` state, exact deferred counts/reset
time, and automatic resume without consuming normal transport retry attempts.

## Organization and team APIs

All REST schemas live in `@sendlit/api-contract`; OpenAPI remains generated
from the ts-rest contract.

### Organization lifecycle

```text
GET    /organizations
POST   /organizations
GET    /organizations/:organizationId
PATCH  /organizations/:organizationId
DELETE /organizations/:organizationId
```

- Signup automatically creates the first organization and owner membership.
- Additional organization creation requires an authenticated user.
- Responses contain public organization data only.
- `DELETE` is owner-only, audited, and changes status to `closed`.
- Physical purge is absent from customer and organization-key APIs. It is an
  operator-only retention/privacy workflow.

### Organization membership

```text
GET    /organizations/:organizationId/members
POST   /organizations/:organizationId/members
PATCH  /organizations/:organizationId/members/:userId
DELETE /organizations/:organizationId/members/:userId
```

Invitation/acceptance UX may be implemented separately, but membership writes
must enforce last-owner and role invariants.

Phase 1 membership writes accept the normalized email of an existing Better
Auth user and resolve it server-side to that immutable user ID. They never
provision an identity from an email address: a missing email returns
`user_not_found`, and the organization owner must ask the person to sign up
before adding them. Email invitation and acceptance tokens are deferred.

### Organization policy and grants

```text
GET    /organizations/:organizationId/delivery-policy
PUT    /organizations/:organizationId/delivery-policy
GET    /organizations/:organizationId/teams/:teamId/esp-grant
PUT    /organizations/:organizationId/teams/:teamId/esp-grant
POST   /organizations/:organizationId/teams/:teamId/esp-grant/transition
```

The transition body is a discriminated union:

```jsonc
{ "action": "suspend" }
{ "action": "resume" }
{ "action": "drain", "drainUntil": "2026-08-01T12:00:00Z" }
{ "action": "cancel" }
```

`drainUntil` defaults to 24 hours from the server clock and must fall within
the allowed 5-minute to 7-day window.

### Organization operations read model

```text
GET /organizations/:organizationId/usage
GET /organizations/:organizationId/audit-events
```

`usage` returns the current UTC-day and UTC-month aggregate organization
delivery-pool counters: accepted sends, queued reservations, optional limit,
remaining capacity, and reset time. It never includes team-owned ESP usage.
Owners and administrators may read it; an organization key needs `usage:read`.

`audit-events` returns the 50 newest append-only, secret-free organization
events. Resource references use public team, ESP, and grant IDs only. Owners
and administrators may read it; an organization key needs `organization:read`.

### Organization keys

```text
GET    /organizations/:organizationId/keys
POST   /organizations/:organizationId/keys
DELETE /organizations/:organizationId/keys/:keyId
```

The full plaintext is returned only on create.

### Human-created teams

```text
GET    /organizations/:organizationId/teams
POST   /organizations/:organizationId/teams
GET    /organizations/:organizationId/teams/:teamId
PATCH  /organizations/:organizationId/teams/:teamId
DELETE /organizations/:organizationId/teams/:teamId
```

A user session must have organization permission. Team creation atomically:

1. creates the team;
2. creates delivery settings;
3. adds the creator as team admin;
4. creates the default ESP grant when configured; and
5. applies copied policy defaults.

`DELETE` archives the team. Physical purge is not exposed on these routes.

Organization administration does not make every subsequent team content route
implicitly available to the creator; the explicit team membership from this
operation does.

### Team membership

```text
GET    /teams/:teamId/members
POST   /teams/:teamId/members
PATCH  /teams/:teamId/members/:userId
DELETE /teams/:teamId/members/:userId
```

Organization provisioning does not use these routes implicitly.

## Organization-key provisioning

Retain the useful provisioning route concept but replace its authentication
and request semantics completely.

### Authentication

```http
POST /provisioning/teams
Authorization: Bearer sl_org_live_...
```

`requireOrganizationKey`:

- hashes and resolves the key;
- rejects revoked/expired keys;
- verifies `teams:provision`;
- sets internal `req.organizationId`;
- rate-limits by organization ID; and
- never accepts an organization ID from body/header as authority.

Remove:

- the deployment-wide provisioning credential;
- constant-time comparison against an environment secret;
- `ownerEmail`;
- `findOrCreateBareAccount` from provisioning;
- provisioning-specific OpenAPI header security; and
- all tests/docs/environment variables for the old secret.

There is no legacy fallback because there are no production users.

### Request

```jsonc
{
    "externalId": "school_01J...",
    "name": "Acme School",
    "sender": {
        "fromName": "Jane Doe",
        "replyTo": "jane@school.example",
    },
    "mailingAddress": "...",
    "delivery": {
        "useOrganizationDefault": true,
        "teamEspEnabled": false,
        "teamCanChangeDefault": false,
    },
    "quota": {
        "dailyLimit": 500,
        "monthlyLimit": 10000,
    },
}
```

Organization policy supplies omitted values. Requests cannot choose a foreign
ESP. `useOrganizationDefault` resolves only the authenticated organization's
configured default.

### Response

The response is a discriminated union. Initial creation returns the only copy
of the plaintext team key:

```jsonc
{
    "created": true,
    "teamId": "team_...",
    "externalId": "school_01J...",
    "name": "Acme School",
    "apiKey": "sl_live_...",
    "deliverySource": {
        "type": "organization",
    },
}
```

An idempotent replay returns the existing team but never returns stored key
material:

```jsonc
{
    "created": false,
    "teamId": "team_...",
    "externalId": "school_01J...",
    "name": "Acme School",
    "apiKey": null,
    "deliverySource": {
        "type": "organization",
    },
}
```

`apiKey` is required as `string` when `created = true` and required as `null`
when `created = false`. If a caller lost the initial response, it uses
`POST /provisioning/teams/:teamId/keys` to create a replacement key and revokes
the unrecovered key in the same operation.

### Provisioning invariants

- Idempotency identity is `(organizationId, externalId)`.
- Concurrent identical requests create one team.
- Repeating an identical request returns `created: false` and the same team.
- Store a hash of the canonical creation request before organization defaults
  are resolved. A replay with a different `name`, `sender`, `mailingAddress`,
  `delivery`, or `quota` payload returns `409 provisioning_conflict` and does
  not mutate the team. Callers use the lifecycle `PATCH` route for intentional
  changes.
- The API key plaintext is returned only when created.
- If the caller loses the key, an organization key with `teams:keys` creates a
  replacement and revokes the unrecovered key; existing plaintext is never
  retrieved.
- Team, delivery settings, optional grant, policy copy, mailing address, team
  key hash, and audit event are one database transaction.
- No user or team membership is created.
- No external email is interpreted as a SendLit identity.

CourseLit stores:

```text
sendlit_team_id
encrypted_sendlit_team_api_key
sendlit_provisioned_at
```

Provisioning should run through CourseLit's durable background/outbox job so a
temporary SendLit failure does not fail school creation.

### Provisioned team lifecycle

```text
GET    /provisioning/teams/:teamId
PATCH  /provisioning/teams/:teamId
POST   /provisioning/teams/:teamId/keys
POST   /provisioning/teams/:teamId/suspend
POST   /provisioning/teams/:teamId/resume
DELETE /provisioning/teams/:teamId
GET    /provisioning/teams/:teamId/usage
```

All routes derive organization from the key and verify the team belongs to it.
Soft archive/deprovision is the default delete behavior. Hard deletion is an
operator-only retention/privacy workflow.

## Authentication middleware and context

Define three explicit authenticated principals:

```text
user session/OAuth:
  req.userId

organization key:
  req.organizationId
  req.organizationApiKeyId
  req.organizationScopes

team key:
  req.teamId
  req.teamApiKeyId
```

Do not overload `req.userId` or `req.teamId` for organization keys.

### Better Auth identity resolution

Better Auth remains responsible for:

- email OTP and configured social-provider login;
- provider identity linking in Better Auth's `account` table;
- browser sessions;
- JWT signing/verification;
- OAuth authorization-server tables and consent; and
- external OAuth access/refresh tokens.

It does not own SendLit organizations, organization memberships, teams, team
memberships, organization keys, or team keys.

Resolution is direct:

```text
Better Auth session:
  session.user.id -> user.id

Better Auth OAuth bearer:
  token.sub -> user.id
  token.team_id -> candidate team scope

SendLit organization key:
  organization_api_keys -> organization_id

SendLit team key:
  team_api_keys -> team_id
```

Remove `ensureSendLitAccountForUser`,
`ensureSendLitAccountForBetterAuthUserId`, and every lookup/create path that
maps a Better Auth user or session to a separate SendLit identity by email.

The OAuth provider's team-selection step lists only teams for which
`team_members.userId = token/session userId`. A selected `team_id` claim
is revalidated against live membership on every request. Organization
membership does not make a child team selectable. Organization-administration
OAuth scopes/claims remain outside Phase 1.

Better Auth's API-key plugin is not registered. API-key input is resolved only
through SendLit's organization-key and team-key services, which return
different principal types and never synthesize a Better Auth user session.

Add:

- `requireOrganizationMembership`;
- `requireOrganizationRole`;
- `requireOrganizationKey`;
- `requireOrganizationAccess` where a route deliberately supports either
  session membership or organization key.

Keep `requireTeam` membership/key behavior. Team enumeration is based on
`team_members`, not organization membership. Organization team lifecycle
listing is a separate authorized surface and does not imply content access.

Dashboard selection stores both selected organization and selected team where
needed. A team selection is validated independently of the organization
selection.

## Campaign, sequence, and transactional behavior

### Drafts

- Drafts may store explicit organization/team source intent.
- A draft may remain editable when its source becomes unavailable.
- Activation must revalidate.

### Activation

Broadcast/sequence activation:

1. validates team and organization status;
2. resolves explicit/default source;
3. validates team ESP ownership or organization grant;
4. validates sender, mailing address, and template/footer requirements;
5. pins source/outbox/grant;
6. creates the rule; and
7. marks active.

Failure before commit leaves status and rules unchanged.

### Transactional email

Transactional creation:

1. performs idempotency lookup;
2. resolves and pins source;
3. validates suppression;
4. renders/snapshots content and sender;
5. creates outbound ledger identity;
6. reserves organization quota when applicable;
7. persists the transactional row; and
8. writes a dispatch-outbox row in the same PostgreSQL transaction.

Team source skips quota.

### Durable dispatch outbox

Phase 1 requires the durable outbox for transactional email because the
transactional request commits a concrete queued recipient before returning
`202`. Existing sequence and campaign scheduling may continue using their
current handoff in Phase 1, provided it preserves the pinned delivery source,
does not bypass suppression/quota, and fails closed when the source is
unavailable.

PostgreSQL is the source of truth across the PostgreSQL/BullMQ boundary:

```text
mail_dispatch_outbox
  id                   uuid PK
  dispatch_id          text NOT NULL UNIQUE       -- mdj_...
  outbound_message_id  uuid NOT NULL UNIQUE FK -> outbound_messages.id
  queue_name           text NOT NULL
  job_name             text NOT NULL
  state                text NOT NULL DEFAULT pending
                       -- pending | publishing | published
  available_at         timestamptz NOT NULL
  lease_expires_at     timestamptz nullable
  publish_attempts     integer NOT NULL DEFAULT 0
  last_error           text nullable
  published_at         timestamptz nullable
  created_at           timestamptz
  updated_at           timestamptz
```

The transactional row, outbound message, quota reservation, and dispatch
outbox row commit together. A request returns `202` after that transaction
commits; it does not require Redis publication to finish.

A dispatcher:

1. leases due `pending` rows with `FOR UPDATE SKIP LOCKED`;
2. publishes to BullMQ with deterministic `jobId = dispatchId`;
3. marks the row `published`; and
4. retries a failed or expired publication lease with bounded exponential
   backoff.

A crash after BullMQ accepts the job but before PostgreSQL records `published`
causes the same deterministic job ID to be published again. BullMQ
deduplication and the worker's atomic outbound claim make this a no-op, even if
a completed BullMQ job was already removed. Workers treat accepted, terminal,
or currently claimed outbound rows idempotently.

Phase 2 hardens the worker/provider boundary:

- Workers acquire a leased atomic outbound claim before calling the provider.
- Adapters pass the stable outbound ID as a provider idempotency key when
  supported.
- A definite pre-submission failure releases the claim for retry.
- After provider acceptance, one database transaction records the provider
  message ID/result, marks the outbound accepted, and commits quota.
- If the process dies or times out after submission may have occurred but
  before acceptance is recorded, the outbound becomes `submission_unknown`.
  Automatic retry is forbidden until the adapter's lookup API proves no
  acceptance. If lookup is unsupported or inconclusive, an operator must
  reconcile it. The quota reservation remains reserved meanwhile.

This Phase 2 behavior deliberately provides at-most-one automatic provider
submission in an ambiguous crash window instead of claiming impossible
transport-level exactly-once delivery. Phase 1 retains the existing provider
retry behavior and may not claim this stronger guarantee.

A Phase 2 periodic reconciler:

- republishes expired `publishing` rows;
- republishes `pending` rows that passed `availableAt`;
- verifies that old `published` rows reached a worker-owned outbound state;
- reopens publication only when the outbound row proves no live/accepted
  submission exists;
- routes `submission_unknown` through provider lookup or an operator queue,
  never an age-only retry; and
- alerts on age/backlog thresholds.

In Phase 2, campaigns and sequences write one dispatch-outbox row when each
recipient becomes dispatchable. They do not reserve an entire audience at
activation. The existing sequence polling loop may still discover due work,
but every concrete mail handoff then uses the outbox. This is a reliability
hardening milestone, not a Phase 1 organization-launch dependency.

### Workers

Team source:

- load pinned ESP;
- assert `ownerScope = team` and matching team;
- send with its provider adapter;
- never touch organization quota.

Organization source:

- load pinned ESP and grant;
- assert ESP and team share organization;
- assert grant pair/status;
- assert quota reservation;
- apply organization quota and the provider transport's existing safe
  concurrency behavior;
- send;
- commit quota on provider acceptance.

Development/test adapters still enforce authorization and quota invariants.
Phase 3 adds organization-ESP/team fairness leases without changing these
source-resolution rules.

## Feedback, suppression, and outbound correlation

Keep one provider feedback connection per ESP configuration, but scope
authorization by ESP ownership.

Extend/rewrite feedback connection shape:

```text
esp_feedback_connections
  esp_config_id
  owner_scope          organization | team
  organization_id     nullable
  team_id             nullable
  ...
```

Ownership columns follow the ESP and are immutable snapshots/constraints.

For a team ESP:

- webhook connection belongs to one team;
- feedback resolves that team and pinned ESP.

For an organization ESP:

- connection belongs to the organization, not a team;
- one webhook batch may contain events for several teams;
- the processor derives team only from a uniquely matched outbound message;
- provider payload/query metadata never selects a team directly.

Production organization delivery always requires a current successful ESP test
and sender address. Providers with a reviewed feedback adapter additionally
require a healthy feedback connection. Custom SMTP and currently-unreviewed
providers may be activated under the explicit **SMTP outcomes only** policy:
SendLit records the synchronous provider result but cannot project later
bounces or complaints. Team-owned ESP behavior remains capability-dependent in
the same way.

`outbound_messages` stores delivery source, pinned ESP, grant, team, provider
snapshot, feedback connection, RFC Message-ID, and provider message ID.

Suppression remains `(team, normalized recipient)` and source-independent. A
complaint/hard bounce through an organization ESP blocks later team-ESP sends,
and feedback through a team ESP blocks later organization-ESP sends for the
same team/address.

Phase 1 preserves team-scoped suppression and supports manual team,
organization, ESP, and grant suspension. Phase 3 adds organization-level
reputation metrics and guarded automatic actions without exposing cross-team
recipient data.

Phase 3 uses the thresholds already defined in
`bounces-and-complaints.md`: hard-bounce
warning at 2% and critical at 5%; complaint warning at 0.05%, critical at 0.1%,
and emergency at 0.3%. Automatic reputation suspension remains a later
circuit-breaker feature requiring minimum event counts and an audited resume
path.

## Rate limiting and fairness (Phase 3)

Phase 1 relies on provider throttling already used by the existing transports
and on durable organization quota. It does not introduce a new global
dispatcher.

When shared-ESP volume requires it, Phase 3 adds recoverable per-ESP throughput
limits, a per-team concurrency cap, and weighted fair selection between teams
and transactional/campaign lanes. Redis may hold leases and scheduling state,
but PostgreSQL outbound and quota rows remain authoritative. Provider
throttling remains retryable and never commits quota before acceptance.

## Audit and observability

Phase 1 provides an append-only, secret-free security activity log for the
highest-risk organization mutations. It is intentionally not a complete
observability platform.

Phase 1 audit events require:

```text
organization_audit_events
  id
  organization_id
  team_id nullable
  esp_config_id nullable
  esp_grant_id nullable
  actor_type           user | organization_key | team_key | system
  actor_id nullable
  action
  metadata jsonb
  created_at
```

Metadata must be secret-free. The dashboard may show the newest events using
public resource IDs.

Phase 1 records:

- organization creation, rename, and closure;
- organization member and role changes;
- organization-key creation and revocation;
- organization ESP creation, credential replacement, status change, and
  retirement;
- organization-key team provisioning, archive, and team-key replacement; and
- grant and organization delivery-policy changes.

Phase 2 additionally audits quota/outbox reconciliation and
`submission_unknown` resolution.

Phase 3 adds reason fields, redacted before/after snapshots, retention/export,
operator search, and delivery/quota/queue/provider/reputation metrics and
alerts.

Never log secrets, raw API keys, provider credential fields, full message
content, or unredacted webhook credentials.

## Security and privacy requirements

- Users gain access only through explicit membership.
- Organization and team membership are independent.
- A team member cannot enumerate organization members, keys, ESPs, grants for
  other teams, or aggregate usage.
- A team key cannot call organization APIs.
- An organization key cannot call team content APIs implicitly.
- Organization ESP reads/mutations require organization authorization.
- Team ESP queries always require `ownerScope = team` and matching team.
- Composite FKs reject cross-organization grants/defaults even if handler
  validation is bypassed.
- Database route-pin constraints reject foreign team ESPs and mismatched
  organization grant/ESP pairs.
- Every team-facing projection and error path uses the universal organization
  redaction rules; none contains organization ESP, grant, provider, feedback,
  or correlation identifiers.
- `ownerEmail` is absent from provisioning.
- Better Auth session/OAuth identity resolves by immutable `user.id`, never
  by email.
- Better Auth's provider-identity table cannot authorize organization/team
  access directly.
- Better Auth user deletion cannot bypass last-owner or membership-retention
  rules; membership FKs restrict user deletion.
- Better Auth API keys and API-key-created mock sessions are not enabled.
- Organization and team key secrets are hashed, scoped, expirable, revocable,
  and shown once.
- Provider secrets are encrypted and never returned.
- Sender/header values reject injection.
- Provider correlation metadata uses opaque SendLit IDs, not external tenant ID
  or recipient PII.
- Feedback never trusts provider-supplied team identity.
- Phase 1 retries never change the pinned delivery source. Phase 2 adds
  `submission_unknown` so ambiguous provider submissions are never blindly
  retried.
- Cross-organization and cross-team isolation tests cover every query family.
- Organization close and last-owner removal require explicit owner
  authorization; organization/team physical purge is operator-only.

## Failure semantics

| Status | Code                                | Meaning                                                        |
| ------ | ----------------------------------- | -------------------------------------------------------------- |
| 400    | `invalid_delivery_source`           | Malformed/conflicting selection                                |
| 401    | `invalid_organization_key`          | Missing, invalid, expired, or revoked key                      |
| 403    | `organization_scope_required`       | Key lacks required scope                                       |
| 403    | `not_an_organization_member`        | User has no membership                                         |
| 403    | `team_esp_disabled`                 | Organization policy forbids team ESP mutation/use              |
| 403    | `organization_delivery_disabled`    | Team lacks an active organization grant                        |
| 403    | `team_sending_suspended`            | Team cannot dispatch                                           |
| 404    | `organization_not_found`            | Missing/inaccessible organization                              |
| 404    | `esp_not_found`                     | Missing/foreign ESP in the relevant owner scope                |
| 409    | `provisioning_conflict`             | External ID exists with conflicting immutable fields           |
| 409    | `delivery_source_in_use`            | Unsafe source disable/delete                                   |
| 409    | `invalid_lifecycle_transition`      | ESP/grant transition is not permitted                          |
| 409    | `last_organization_owner`           | Operation would leave no owner                                 |
| 422    | `delivery_source_required`          | No unambiguous default                                         |
| 422    | `delivery_source_unavailable`       | Team has no active shared or team-owned source                 |
| 422    | `organization_esp_unavailable`      | Grant/ESP cannot currently send                                |
| 422    | `esp_verification_required`         | ESP changed or has not passed its latest test                  |
| 422    | `esp_not_active`                    | Team ESP exists but must be activated before default selection |
| 422    | `provider_capability_required`      | Provider lacks a required organization capability              |
| 422    | `team_esp_not_configured`           | Team source selected without ESP                               |
| 422    | `sender_unverified`                 | Selected sender is not usable                                  |
| 429    | `organization_team_quota_exhausted` | Grant quota exhausted                                          |
| 429    | `organization_quota_exhausted`      | Aggregate organization quota exhausted                         |
| 503    | `user_onboarding_pending`           | Default organization bootstrap has not completed               |

## REST, OpenAPI, MCP, and web requirements

### REST/OpenAPI

- Define organization, membership, organization key, ownership-scoped ESP,
  grant, policy, sending option, and usage schemas in
  `@sendlit/api-contract`.
- Generate all REST/OpenAPI routes from the ts-rest contract.
- Add an `OrganizationApiKey` security scheme.
- Map `/provisioning/*` to organization-key security.
- Remove documentation for the deployment-wide provisioning credential.
- Do not expose internal UUIDs or organization ESP identifiers on team
  surfaces.
- Model provisioning create responses as the `created: true | false`
  discriminated union, including `apiKey: null` on replay.
- Define ESP/grant lifecycle transition request schemas and stable transition
  errors.
- Apply the organization-source redacted projection to every team-facing
  delivery schema, not only sending options.

### MCP

- Add `list_sending_options`.
- Use `organization | team` delivery source values.
- Keep team MCP tools team-scoped.
- Team ESP tools operate only on team-owned ESPs.
- Do not expose organization keys, organization ESP administration, provider
  secrets, or cross-team organization administration through team MCP.
- A future organization MCP surface requires separate OAuth scopes and is
  outside Phase 1.

### Web

- Add organization selection and organization settings.
- Organization ESP settings appear only to authorized organization roles.
- Team pages show a sanitized "Provided by <organization>" sending option.
- Team ESP pages show only team-owned configurations.
- Team creation offers/apply organization defaults.
- Organization keys are shown once at creation.
- Managed/shared quota appears only for organization delivery.
- Team-source sends clearly show that they bypass organization quota.
- Organization members and team members are administered separately.
- Organization settings include member role/removal controls, aggregate usage,
  secret-free audit activity, and ESP/grant lifecycle controls.
- The dashboard team switcher groups every team the user can access under its
  organization. Selecting a team changes both the team and organization UI
  context; organization headings themselves grant no access.

## Clean schema and migration strategy

There are no production users and local databases may be reset. Treat the
current database design as disposable development state.

### Required approach

1. Finalize the schema in this PRD before implementation.
2. Rewrite Drizzle table definitions directly to the target shape.
3. Remove old generated migration files/snapshots/journal entries.
4. Generate a new clean baseline migration from the final schema.
5. Prefer one baseline migration; use a small number only when required by
   real dependency/order constraints.
6. Reset local/test databases and apply the baseline from empty.
7. Update fixtures, bootstrap, Docker initialization, and seed flows to the new
   hierarchy.

Do not implement:

- additive compatibility columns;
- data backfills;
- dual user/platform ownership;
- dual `custom | platform | managed` route reads;
- a legacy organization;
- old provisioning-secret fallback;
- migration of legacy user quota counters;
- compatibility response aliases for unused APIs; or
- transitional nullable relationships that are non-null in the final model.

### Baseline changes

The clean baseline:

- uses Better Auth's default `user`, `session`, `account`, and `verification`
  models/tables without `modelName` overrides;
- adds the default-organization pointer to `user` through Better Auth
  `additionalFields` and removes legacy identity quota;
- removes the separate SendLit `accounts` table, the old `auth_user` table
  naming, and the email-based identity bridge;
- points memberships, Better Auth sessions/accounts, and OAuth user FKs
  directly to `user.id`;
- adds organizations and organization members;
- makes `teams.organizationId` required;
- adds the provisioned-team creation-request hash;
- removes `teams.ownerAccountId`;
- uses team roles `admin | member`;
- adds organization keys;
- rewrites team keys cleanly;
- rewrites ESP ownership as `organization | team`;
- adds ESP/grant lifecycle and secret-version fields;
- removes ESP `isDefault`;
- adds organization delivery policy, grants, team delivery settings, usage
  buckets, reservations, and audit;
- adds the durable mail dispatch outbox;
- adds composite tenant-ownership keys/FKs and route-pin constraint triggers;
- uses `organization | team` delivery source fields from first migration;
- adjusts feedback/outbound tables to the final ownership/source model;
- removes every schema artifact for the old global provisioning secret; and
- does not add Better Auth API-key plugin tables or routes.

### Application initialization

First successful user signup:

1. Better Auth creates or resolves the `user` row directly.
2. `ensureDefaultOrganization(userId)` locks that user row.
3. If `defaultOrganizationId` is null, one database transaction creates the
   default organization, creates owner membership, and sets
   `user.defaultOrganizationId`.
4. The user is sent to organization onboarding.

Better Auth authentication and SendLit organization bootstrap are two
deliberate transaction boundaries because Better Auth owns the authentication
write. The bootstrap service is idempotent:

- concurrent calls serialize on the user row;
- the organization, owner membership, and user pointer commit together;
- a rollback leaves `defaultOrganizationId = null` and creates no partial
  organization graph;
- the Better Auth user-creation hook attempts bootstrap immediately;
- session/OAuth resolution retries bootstrap when the pointer is null; and
- SendLit application routes return/redirect to `user_onboarding_pending`
  until bootstrap succeeds.

An authenticated but not-yet-bootstrapped user has no organization or team
authority. Retrying cannot create a second default organization.

Do not automatically create a team until the user chooses team name/delivery
setup, unless product UX explicitly decides to combine organization and first
team onboarding. Either path uses the same transactional creation service.

Bootstrap/super-admin initialization creates:

- the user;
- its organization;
- owner membership; and
- optionally an organization key/team only when the plaintext can be shown
  safely.

### Removed configuration

Delete from code, environment examples, Docker Compose, deployment config,
tests, and docs:

```text
deployment-wide provisioning credential
```

No replacement deployment-global provisioning secret is introduced.

## Implementation phases

Phases are product release boundaries, not database migrations. All
environments use the clean target schema from the start so later phases do not
require another tenancy-model rewrite.

### Phase 1: market-ready organizations

Phase 1 is the only launch blocker for the organization feature.

Identity and tenancy:

- Better Auth's default `user` is the sole human identity.
- Idempotent default-organization bootstrap.
- Organizations, organization memberships, required team organization FK, and
  independent team memberships.
- Organization/team authorization middleware and role enforcement.
- Organization-grouped team switcher that lists only active teams for which
  the user has explicit team membership.
- Removal of the separate SendLit account identity, user ownership, email
  reconciliation, and global provisioning secret.

Keys and provisioning:

- Scoped, hashed, expirable, revocable organization keys.
- Organization-key team provisioning with organization-scoped idempotency.
- Atomic team, policy/settings, optional grant/quota, and one-time team-key
  creation.
- Provisioned team lifecycle, key replacement, and usage reads.
- No user or membership creation from external email data.

ESP ownership and administration:

- One immutable ownership-scoped ESP table.
- Structurally separate organization/team queries, routes, and serializers.
- Organization delivery policy, one non-revoked grant per team, team delivery
  settings, and sanitized sending options.
- Basic tested lifecycle: draft, test, activate, suspend/resume, retire/cancel.
- Provider credentials encrypted and absent from team-facing projections.
- Organization settings UI for members, shared ESPs, policy, grants, keys,
  usage, and secret-free recent audit activity.

Sending compatibility:

- `organization | team` resolution and immutable source pinning for
  transactional email, sequences, and broadcasts.
- Correct sender snapshot and no user-email fallback.
- Existing transactional and sequence scheduling/worker behavior remains
  functional; organization work does not silently fall back to a team ESP.
- Organization-source sends reserve/commit/release quota; team-source sends
  bypass organization quota.
- Existing feedback correlation and team-wide suppression continue for both
  source types.
- Transactional PostgreSQL dispatch-outbox publication remains durable.
- Sequence/campaign sends may retain their current handoff in Phase 1.

Security and contracts:

- Composite tenant/grant/default/pin constraints.
- Universal team-facing redaction of organization infrastructure identifiers
  and provider details.
- Matching ts-rest, OpenAPI, dashboard client, and team MCP schemas.
- Secret-free audit events for Phase 1 privileged organization mutations.
- Clean baseline migration and critical regression/browser verification.

### Phase 2: reliability hardening

Phase 2 is required before strict delivery SLAs or a claim of comprehensive
crash-window recovery:

- use the PostgreSQL dispatch outbox for every sequence/campaign recipient;
- reconcile old pending/publishing/published dispatch rows;
- add explicit outbound `submission_unknown` state;
- use provider idempotency/lookup where supported and an operator resolution
  path otherwise;
- reconcile stale quota reservations from authoritative outbound state;
- add first-class campaign/sequence `quota_deferred` state, reset reporting,
  and automatic resume;
- add crash-point tests for PostgreSQL, BullMQ, worker, and provider-call
  boundaries; and
- audit reconciliation and ambiguous-submission resolution.

### Phase 3: scale and operations

Phase 3 is triggered by shared-ESP traffic, tenant count, or support needs:

- per-ESP provider token bucket and concurrency semaphore;
- per-team concurrency within an organization ESP;
- weighted round-robin scheduling and transactional/campaign lane fairness;
- complete delivery, quota, queue, provider, feedback, reputation, auth, and
  provisioning metrics;
- alert thresholds, runbooks, and audit export/search;
- richer reason and redacted before/after audit snapshots;
- automatic reputation circuit breakers after adequate event-volume guards;
  and
- additional reviewed asynchronous-feedback adapters.

### Phase boundaries

Later phases must be additive. They may change dispatch implementation and
operations, but they must not change organization/team ownership, public
delivery-source types, grant semantics, key authority, team-facing redaction,
or the Phase 1 integration contracts used by CourseLit and FrontLit.

## Test plan

### Phase 1 launch gate

Phase 1 does not require Phase 2/3 machinery, but it does require confidence
that the organization work did not regress customer sending. Before release:

- the complete API test suite is green after obsolete account/provisioning
  expectations are removed or rewritten;
- transactional and sequence tests pass for team and organization sources;
- authentication/team-selection tests use Better Auth `user.id` and active
  team membership;
- organization authorization, provisioning, grant, redaction, quota, and
  source-pinning tests pass;
- a new empty database applies the clean migration baseline;
- API-contract, API, and web type checks/builds pass;
- browser smoke covers sign-in, organization setup, shared ESP visibility,
  policy/grants, provisioning credentials, usage/audit reads, and switching
  among active member teams grouped by organization; and
- archived teams and unauthorized organization infrastructure never appear in
  the normal team switcher or team-facing responses.

Tests for weighted fairness, universal campaign/sequence outbox recovery,
`submission_unknown`, and advanced metrics are later-phase gates and must not
remain mixed into the Phase 1 completion claim.

### Baseline

- A brand-new PostgreSQL database applies the complete migration set.
- Drizzle schema and migration snapshots match.
- No old migration, quota, `ownerAccountId`, or provisioning-secret artifact
  remains.
- No separate SendLit `accounts`, `auth_user` naming, email identity bridge, or
  Better Auth API-key table remains.
- Better Auth `session` and `account` rows reference `user.id`.
- Test database setup creates organizations before teams.

### Membership and authorization

- Better Auth OTP/social creation produces exactly one `user` row.
- Better Auth session `user.id` and OAuth `sub` resolve that user directly.
- Provider linking/email change retains the same user ID and memberships.
- No authentication path looks up or creates a user by email after Better
  Auth has resolved the user.
- Direct Better Auth user deletion cannot cascade organization/team
  memberships or remove the last organization owner.
- SendLit user deletion revokes auth state and enforces membership/retention
  transitions before the user row can be removed.
- First-login bootstrap creates one default organization and owner membership.
- Concurrent/retried/failed bootstrap creates no duplicate or partial
  organization graph.
- A user with pending bootstrap cannot access application resources.
- A user can belong to multiple organizations.
- Organization can have multiple owners/admins/members.
- Last owner cannot be removed.
- Team member without organization membership accesses only their team.
- Organization member without team membership cannot access team content.
- Organization owner can explicitly create/rotate a team key but cannot bypass
  team middleware with the organization session/key.
- Every normative action is tested for owner, admin, member, organization key,
  team admin, team member, and team key as applicable.
- Admin cannot manage owners, mint organization keys, retire an organization
  ESP, or perform hard deletion.
- Organization keys cannot mint organization keys regardless of scopes.
- Better Auth API-key headers/routes cannot authenticate to SendLit.
- Cross-organization public IDs never authorize access.

### ESP ownership

- Database rejects invalid owner-scope FK combinations.
- Organization ESP cannot be read through team ESP queries.
- Team ESP cannot be read through organization ESP queries.
- Team member/key receives no organization ESP ID or connection metadata.
- Scope/owner cannot be mutated.
- Secret create/update never returns or logs plaintext.
- ESP transport cache invalidates correctly for both owner scopes.
- Draft cannot send; activation requires a current successful test.
- Transport/secret/sender-email changes increment secret version and return an
  active ESP to draft.
- Suspend/resume/drain/retire and drain deadline behavior is deterministic.
- Organization ESP retirement transitions all non-revoked grants atomically
  and never switches a team to another source.
- Referenced/historical ESPs cannot be physically deleted.
- Organization activation requires a current successful test and sender.
  Reviewed-feedback providers additionally require healthy feedback; SMTP,
  custom, and unreviewed providers are allowed with their no-webhook-feedback
  limitation made visible to organization administrators.

### Grants

- Grant requires organization ESP and same-organization team.
- Cross-organization grant fails.
- Direct SQL attempts to create a cross-organization grant or foreign default
  fail through composite FKs.
- A second active grant for one team fails in Phase 1.
- A second non-revoked grant for one team fails.
- Drain, suspend, cancel, resume, deadline, and reservation behavior follows
  the specified transition semantics.
- Grant does not authorize organization ESP read/test/update/delete.
- Organization policy auto-grants only its own default ESP.

### Provisioning

- Organization key can provision only its own teams.
- Body/header organization spoofing is ignored/rejected.
- Revoked, expired, wrong-scope keys fail.
- Concurrent same external ID creates one team/key/grant.
- Same external ID succeeds in different organizations.
- Replay returns same team and no second plaintext key.
- Replay response has `created: false` and `apiKey: null`.
- Replay with a changed canonical creation payload returns
  `provisioning_conflict` and performs no mutation.
- Key recovery creates a replacement rather than retrieving plaintext.
- Provisioning creates no user/membership from email-shaped data.
- Global provisioning secret/header is rejected and absent from OpenAPI.

### Delivery matrix

For broadcasts, sequences, and transactional email:

- organization-only team;
- team-only team;
- both sources with organization default;
- both sources with team default;
- explicit source selection;
- missing default;
- disabled source;
- foreign team ESP;
- missing/suspended/revoked grant;
- default change after activation;
- ESP credential rotation;
- grant/source deletion conflict;
- retry after policy/default changes.

Every worker uses the pinned source and never crosses source types.
Direct SQL attempts to pin a foreign team ESP or mismatched organization
grant/ESP fail through route-pin database constraints.

### Dispatch outbox

Phase 1 transactional-outbox tests:

- Transactional email, outbound row, quota reservation, and dispatch row commit
  or roll back together.
- Crash before PostgreSQL commit leaves none of them.
- Crash after commit but before BullMQ publication is recovered.
- Crash after BullMQ accepts but before `published` update republishes the same
  deterministic job ID.
- Duplicate transactional publication and worker execution reuse the same
  deterministic job/outbound identity.

Phase 2 outbox/reconciliation tests:

- a live or accepted outbound cannot create a second automatic provider
  submission;
- crash/timeout during the provider call uses provider idempotency/lookup when
  available and otherwise enters `submission_unknown`;
- Redis loss reconstructs ready work from PostgreSQL;
- campaign/sequence recipient handoff uses the same outbox; and
- old pending/publishing/published states reconcile and alert as specified.

### Sender

- Organization email comes only from organization ESP.
- Grant display name/Reply-To applies.
- Team ESP sender applies for team source.
- No user-email fallback.
- Team cannot spoof organization From.
- Injection/malformed values fail.
- Historical outbound sender snapshot survives edits.

### Quota

- Team source never reads/mutates organization quota.
- Organization source reserves once.
- Idempotency and retries do not double reserve.
- Team/grant and aggregate organization limits apply atomically.
- Concurrent final-unit test never overshoots.
- Provider acceptance commits.
- Pre-acceptance terminal outcomes release.
- Later bounce/complaint does not refund.
- UTC day/month rollover works.
- Limit increase/decrease and below-current-usage behavior works immediately
  for new reservations without rewriting existing usage.
- Grant/ESP suspension freezes, drain honors, and cancel releases
  reservations.
- Usage responses report accepted, reserved, remaining, limit, and reset.
- Phase 1 sequence/campaign quota exhaustion sends nothing, changes no source,
  consumes no accepted quota, and remains eligible for its existing retry/run
  mechanism.
- Phase 2 campaign work defers/resumes through first-class quota state without
  retry exhaustion, and crash-point reconciliation never double
  commits/releases.
- Phase 3 shared-ESP scheduling is round-robin across teams, respects per-team
  and per-ESP concurrency, and admits campaign work under sustained
  transactional load.

### Feedback and suppression

- Team ESP feedback resolves fixed team.
- Organization ESP feedback correlates multiple teams only via outbound rows.
- Provider payload cannot select team.
- Duplicate/out-of-order/unmatched events preserve existing guarantees.
- Bounce/complaint through either source suppresses both sources for that team.
- Team cannot see organization feedback configuration/health.
- Every team-facing transactional, campaign, sequence, outbound, delivery
  event, dashboard, error, and MCP fixture omits organization ESP/grant/provider
  correlation fields.

### Contract and UI

- ts-rest, OpenAPI, handlers, web client, and MCP schemas agree.
- Organization-key security is documented only where accepted.
- Team sending-option fixtures omit organization ESP identifiers/metadata.
- Organization and team membership UI are distinct.
- Organization ESP and team ESP pages never mix administrative rows.
- Organization ESP creation offers one custom-SMTP choice, not duplicate
  `smtp` and generic `custom` choices.

Verification commands during implementation:

```bash
pnpm --filter @sendlit/api test
pnpm --filter @sendlit/api typecheck
pnpm --filter @sendlit/api build
pnpm --filter @sendlit/api-contract test
pnpm --filter @sendlit/web check-types
pnpm lint
pnpm prettier
```

Phase 1 may not be declared complete by running only targeted organization
tests. Targeted tests are useful while iterating, but the full relevant suite
and browser smoke are the release gate.

## Acceptance criteria

### Phase 1 acceptance criteria

The market-ready organization feature is complete when:

1. Every team belongs to exactly one organization and has no user owner.
2. Users access organizations and teams only through explicit independent
   memberships.
3. Organization membership never grants implicit team content access, and team
   membership never grants organization administration.
4. Organization- and team-owned ESPs use one constrained table with immutable
   ownership.
5. A team cannot read organization ESP identity, provider connection,
   credentials, feedback configuration, test health, or topology.
6. An explicit same-organization grant is required for organization delivery.
7. CourseLit can configure one organization ESP and grant it automatically to
   newly provisioned school teams.
8. FrontLit can provision team-ESP-only teams whose ESPs are team-owned.
9. A CourseLit school can later add a team ESP without migration or implicit
   default change.
10. Organization keys are scoped, hashed, revocable, rotatable, auditable, and
    restricted to one organization.
11. The deployment-wide provisioning credential and `ownerEmail` provisioning
    are completely removed.
12. Provisioning is idempotent within organization scope and atomically creates
    policy/settings/grant/team key.
13. Provisioning creates no human identity or membership.
14. Every active/queued send pins `organization | team`, exact ESP, and grant
    where applicable.
15. No worker retry/failure silently changes delivery source.
16. Team delivery bypasses organization quota; organization delivery enforces
    grant and optional aggregate quota without overshoot.
17. Feedback for organization ESPs derives team only from outbound correlation.
18. Suppression remains team-wide across both sources.
19. REST/OpenAPI, team MCP, web, Phase 1 audit, and documentation match.
20. A clean empty database applies a minimal new migration baseline with no
    compatibility/backfill logic or obsolete schema.
21. Composite FKs and route-pin database constraints reject cross-organization
    grants/defaults and cross-team delivery pins even when application
    validation is bypassed.
22. ESP/grant lifecycle, retirement, provider capability, and transition
    behavior is deterministic and retains historical records.
23. Transactional creation writes its outbound/quota/dispatch rows atomically,
    and its dispatcher recovers pending or expired publication leases with a
    deterministic BullMQ job ID.
24. Provisioning replays return `apiKey: null`, changed creation payloads
    conflict, and lost keys are replaced rather than retrieved.
25. Every team-authorized representation redacts organization ESP, grant,
    provider, feedback, and correlation identifiers.
26. Better Auth's default `user` table is the only human identity; its default
    `session` and `account` tables and OAuth subjects resolve the same immutable
    user ID without email reconciliation or core `modelName` overrides.
27. Default-organization bootstrap is idempotent, blocks application access
    while incomplete, and never leaves or duplicates a partial organization
    graph.
28. Better Auth's API-key plugin is absent; SendLit organization and team keys
    remain distinct database-enforced principals.
29. Better Auth user deletion cannot cascade away memberships or bypass the
    last-owner invariant.
30. Existing transactional and sequence sends work for team and organization
    sources, use their pinned source, and preserve existing retry,
    suppression, and feedback behavior.
31. The full Phase 1 regression suite is green, including updated tests that no
    longer expect removed account/provisioning-secret behavior.
32. Browser smoke verifies the ordinary organization setup and team-switching
    flow without exposing archived or unauthorized teams.

Phase 1 completion does not imply that Phase 2 crash-window recovery or Phase 3
fairness/metrics are complete.

### Phase 2 acceptance criteria

Phase 2 is complete when:

1. Every concrete transactional, sequence, and campaign recipient is handed
   off through the durable PostgreSQL dispatch outbox.
2. Pending, expired publishing, and stale published rows reconcile from
   authoritative outbound state.
3. Ambiguous provider outcomes enter `submission_unknown`; no automatic retry
   occurs until provider lookup proves the submission absent.
4. Unsupported/inconclusive lookup has an operator resolution path.
5. Quota reservations reconcile without double commit/release.
6. Campaign/sequence quota exhaustion uses explicit deferred state and resumes
   idempotently.
7. Crash-point tests cover every documented PostgreSQL/BullMQ/provider
   boundary.

### Phase 3 acceptance criteria

Phase 3 is complete when:

1. Shared ESP throughput is limited per ESP and per team.
2. Sustained transactional traffic cannot permanently starve campaigns.
3. Redis lease loss cannot change quota or durable outbound truth.
4. The documented metrics, alerts, runbooks, and audit enrichment are
   operational.
5. Reputation automation is guarded by minimum sample sizes and has an audited
   manual resume path.

## Risks and mitigations

| Risk                                                       | Mitigation                                                                                       |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Organization member assumes team data access               | Independent membership checks and explicit team credential path                                  |
| Team member sees shared credentials                        | Separate routes/queries/serializers; sanitized grant projection                                  |
| Unified ESP table causes scope leak                        | Immutable owner check, mandatory scope predicates, isolation tests                               |
| Foreign organization grants ESP                            | Same-organization composite FKs plus transaction tests                                           |
| New team unexpectedly uses shared ESP                      | Explicit organization policy/default and visible provisioning response                           |
| Adding team ESP changes sender/billing                     | Never auto-switch default; pin source                                                            |
| Shared credential copied per team                          | Single organization ESP plus grant                                                               |
| Credential rotation breaks queued work                     | Stable ESP ID and transport cache invalidation                                                   |
| One school harms shared reputation                         | Phase 1 quota/suppression/manual suspension; Phase 3 fairness and reputation automation          |
| Concurrent quota overshoot                                 | Atomic reservations across grant and organization buckets                                        |
| Retry double-counts                                        | One reservation per outbound message                                                             |
| Organization key leaks                                     | Least scopes, hashing, expiry, revocation, audit, rate limits                                    |
| Team key gains organization authority                      | Separate key resolver/context/middleware                                                         |
| External email grants access                               | Provisioning accepts no owner email and creates no membership                                    |
| Email/provider change creates another user                 | Better Auth owns linking; all authorization uses immutable user ID                               |
| Auth succeeds but organization bootstrap fails             | Idempotent locked bootstrap and onboarding-pending gate                                          |
| Provider webhook chooses wrong team                        | Outbound-ledger correlation only                                                                 |
| Handler bug crosses tenant ownership                       | Composite FKs and route-pin database constraints                                                 |
| Transactional DB commit succeeds but Redis enqueue is lost | Phase 1 transactional dispatch outbox and deterministic job ID                                   |
| Sequence/campaign handoff is lost in a crash               | Existing retry/polling behavior in Phase 1; universal dispatch outbox in Phase 2                 |
| Provider result is ambiguous after a crash                 | Existing provider retry behavior in Phase 1; `submission_unknown` and reconciliation in Phase 2  |
| Shared ESP is deleted with history                         | Lifecycle retirement and restrictive historical FKs                                              |
| Custom SMTP misses complaints                              | Explicit test-verified-only policy, synchronous result recording, and organization-admin warning |
| Clean reset hides schema mistakes                          | Empty-DB baseline tests and full fixture rebuild                                                 |

## Deferred product choices

There are no ownership-schema or Phase 1 API-contract questions blocking
market release. These UX/expansion choices may be made later without changing
the Phase 1 ownership model:

1. Signup creates the default organization only. A future onboarding flow may
   combine organization and first-team creation through the same transactional
   team service.
2. Phase 1 membership writes add existing Better Auth users directly.
   Invitation and acceptance UX is deferred.
3. CourseLit-provisioned teams default to the request/policy values for
   `fromName`, `replyTo`, `teamEspEnabled`, and `teamCanChangeDefault`.
   CourseLit can opt individual schools into those capabilities through the
   provisioning lifecycle API.
4. Additional reviewed feedback adapters improve observability for SES,
   SendGrid, and Mailgun. Those providers are already usable through the
   explicit test-verified-only policy, but do not receive asynchronous
   bounce/complaint projection until their adapter ships.
5. Automatic reputation suspension is deferred as described above; Phase 1
   ships manual organization/operator suspension. Phase 3 adds guarded
   automation.
6. Universal campaign/sequence dispatch-outbox handoff, ambiguous-provider
   reconciliation, and first-class quota deferral are Phase 2 reliability
   work. They do not alter the Phase 1 organization/provisioning contracts.
7. Weighted dispatch fairness, provider/team concurrency leases, complete
   metrics/alerts, and rich audit snapshots are Phase 3 scale/operations work.

## Assumptions

- There are no production users or production data to migrate.
- Local and test databases can be destroyed and recreated.
- Better Auth `user` rows are the human login identities.
- Better Auth's core `user`, `session`, `account`, and `verification` models
  retain their default model/table names and string IDs.
- Better Auth remains the human session/social/OAuth system; its API-key plugin
  is not used.
- Every team belongs to exactly one organization.
- Users may belong to several organizations and teams.
- Organization and team membership are independent.
- One non-revoked organization ESP grant per team is sufficient for Phase 1.
- Organization-owned and team-owned connections share the same provider
  credential shape.
- Provider acceptance is the countable shared-delivery event.
- Team-owned ESP sends do not consume organization quota.
- Existing outbound ledger, feedback inbox, projection, and suppression
  concepts remain valid after ownership/source fields are rewritten.
