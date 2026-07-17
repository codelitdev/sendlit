# Multiple User ESPs and Route-Aware Quotas

## Summary

Replace the team-level ESP singleton with a team-scoped collection containing
only user-managed ESP configurations. Each team can have one default user ESP
and can select another user ESP for a sequence, broadcast, or transactional
email.

The future SendLit-provided ESP is a deployment-level transport, not an
`esp_configs` row. Sends persist whether they use the `custom` or `platform`
delivery route; only the custom route references a team ESP. This allows the
platform provider to be replaced or its credentials rotated without changing
team data.

Until platform delivery is introduced and enabled, a team must have a usable
user ESP before transactional work can be queued or a sequence/broadcast can
start. User-managed ESP delivery does not consume SendLit quota.

## Key Changes

### Data model and migration

- `esp_configs` stores only user-managed ESPs. Extend it with:
    - Public `espId` using the `esp_...` convention.
    - Human-readable `name`.
    - `isDefault` to identify the team's default user ESP.
- Do not store a platform-provider row, provider credentials, or a platform
  marker in `esp_configs`.
- Remove the unique constraint on `esp_configs.teamId`; enforce at most one
  default user ESP per team with a partial unique index.
- Migrate every existing ESP as its team's default user ESP.
- Add an internal `deliveryRoute` discriminator with `custom` and `platform`
  values to sequences and transactional emails:
    - `custom` requires an `outboxId` referencing a team-owned `esp_configs` row.
    - `platform` requires a null `outboxId` and resolves deployment configuration
      at delivery time.
    - A draft sequence may keep the route unresolved; an active sequence and
      every queued transactional email must have a resolved route.
- Keep the existing sequence `outboxId` and add `outboxId` to transactional
  email records so custom deliveries remain pinned to the selected user ESP.
- Backfill existing active sequences and transactional records as `custom`,
  using their existing team ESP. Leave eligible drafts unresolved until start.
- The first user ESP created becomes the team's default automatically.
  Switching defaults is atomic. Deleting the default promotes another user ESP
  when one exists.
- Reject deletion with `409` when a user ESP is referenced by an active/paused
  sequence or a queued transactional send. Historical terminal transactional
  records must not permanently prevent deletion.

### Platform delivery configuration

- Platform ESP configuration belongs in deployment configuration or a secrets
  manager behind a platform transport adapter, separate from the existing
  `EMAIL_*` variables used for authentication/system email.
- Persist only `deliveryRoute: "platform"`; never persist the platform vendor
  or credentials on team-owned records.
- The platform adapter resolves the currently deployed provider at send time,
  allowing a provider swap without a database migration or per-team updates.
- Platform delivery is not implemented or exposed by this change. The platform
  adapter reports unavailable until the future platform-delivery feature is
  configured and enabled.
- If platform availability is later exposed publicly, return it as read-only
  sending capability metadata, not as an item in ESP CRUD endpoints.

### REST contract, OpenAPI, and MCP

Add collection-style REST endpoints for user-managed ESPs:

- `GET /settings/esps`
- `POST /settings/esps`
- `GET /settings/esps/:espId`
- `PATCH /settings/esps/:espId`
- `DELETE /settings/esps/:espId`
- `POST /settings/esps/:espId/test`

Public ESP responses include `espId`, `name`, `isDefault`, connection metadata,
sender identity, and test status—never encrypted credentials. They do not
include a platform ESP or a client-writable delivery-source field.

- Keep `/settings/esp` temporarily as a backward-compatible alias for the
  default user ESP.
- Add equivalent collection-aware MCP tools while retaining the existing
  singleton tools as default-user-ESP aliases.
- Update API descriptions, OpenAPI validation tests, MCP descriptions, and the
  API README.

### ESP selection and sending invariants

- Add optional `espId` selection to sequence/broadcast create or update
  operations and transactional sends.
- For this change, selection precedence is explicit user `espId`, then the
  team's default user ESP. There is no arbitrary first-record fallback.
- Clients cannot request the reserved `platform` route until that feature is
  introduced. Delivery-route selection remains an internal concern.
- Validate that an explicitly selected ESP belongs to the active team.
- Resolve and pin the custom ESP before:
    - Persisting/enqueueing a transactional email.
    - Creating an automation rule.
    - Marking a sequence or broadcast active.
- With no resolvable user ESP while platform delivery is unavailable:
    - Transactional send returns `422`; no row or queue job is created.
    - Sequence/broadcast start returns `422`; status remains unchanged and no
      rule/enrollment is created.
- Refactor user transport caching to key by ESP configuration rather than team.
- Workers use the persisted delivery route. A custom send must use its pinned
  ESP and must never silently fall back to another user ESP or to the platform
  route.
- The low-level mail boundary verifies that the pinned custom ESP still exists
  in every environment; development may log instead of delivering only after
  that check.
- Platform authentication/system emails remain separate from both delivery
  routes and may continue using their existing SMTP environment variables.

### Quota behavior

- User-managed/custom ESP delivery bypasses SendLit daily/monthly quota checks
  and does not increment SendLit quota counters.
- Apply that behavior consistently to transactional emails, broadcasts, and
  sequences.
- Retain the existing account quota fields for the future platform route, but
  describe them as platform-delivery usage rather than total mail usage.
- When platform delivery is implemented, quota checks and successful-delivery
  counter increments occur only when `deliveryRoute === "platform"`.
- ESP CRUD never controls whether quota applies; route selection is the source
  of truth.

## Test Plan

- Migration preserves existing ESP credentials, assigns public IDs, makes the
  existing ESP the default user ESP, and backfills eligible sends as `custom`.
- ESP CRUD supports multiple team-scoped configurations, secret
  preservation/rotation, default switching/promotion, tenant isolation, and
  safe deletion conflicts.
- ESP APIs never return a virtual platform ESP or expose platform credentials.
- Explicit user ESP selection and default selection resolve correctly; foreign
  and missing `espId` values are rejected.
- Transactional sends with no user ESP produce no database row or queue job
  while platform delivery is unavailable.
- Sequence and broadcast starts with no user ESP leave status and rules
  unchanged while platform delivery is unavailable.
- Custom-route workers fail closed if a pinned ESP disappears and never route
  through a different custom or platform transport.
- Exhausted account quota does not block user-ESP transactional, broadcast, or
  sequence mail.
- Successful user-ESP deliveries do not increment platform quota counters.
- Future platform-route tests must prove that deployment configuration—not an
  `esp_configs` row—is resolved and that only successful platform deliveries
  consume quota.
- REST contract, generated OpenAPI, MCP tools, and compatibility aliases expose
  matching behavior without leaking credentials.
- Run:
    - `pnpm --filter @sendlit/api test`
    - `pnpm --filter @sendlit/api typecheck`
    - `pnpm --filter @sendlit/api build`
    - `pnpm lint`

## Assumptions

- A user ESP is "configured" when a contract-valid row exists; a successful
  test email is not required.
- One user ESP is the team default, with optional per-send/per-sequence
  overrides.
- Platform delivery is a reserved internal route and is outside the current
  implementation scope.
- The future platform provider is deployment-wide and replaceable without
  changing persisted team data.
- Existing singleton REST and MCP interfaces remain as compatibility aliases.
- Dashboard/UI work is outside this API-focused change.
- Existing unrelated working-tree changes must be preserved.
