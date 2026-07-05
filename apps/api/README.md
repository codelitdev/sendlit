# Introduction

This API provides email automation.

## Capabilities

- Composing transactional mails, broadcasts, sequences and templates
- Managing (CRUD) contacts, including tag/subscription/email-based segmentation
- Sending emails (BullMQ + nodemailer), through a per-team ESP if configured
- Automation based on events (tag added/removed, new subscriber, scheduled broadcasts)
- Email open/click tracking and unsubscribe handling
- Per-team ESP (email sending provider) configuration and test sends
- Teams: an OAuth account can own/belong to any number of teams; every other
  resource (contacts, templates, sequences, ESP config, API keys) is scoped to
  a team, not the account — see "Teams" below.

## Architecture

- The API is protected by OAuth2 (PKCE, dynamic client registration, email-OTP
  passwordless login, JWT access/refresh tokens) — ported from
  [MediaLit's API](../../../medialit/apps/api/src/oauth). See
  `../../ARCHITECTURE.md` for the full mapping.
- REST endpoints for contacts, templates, sequences/broadcasts — defined once
  as a `ts-rest` contract (`packages/api-contract`, `@sendlit/api-contract`),
  not hand-annotated per route. That contract is the single source of truth
  for request/response validation (`@ts-rest/express`, at runtime), the
  OpenAPI document (`@ts-rest/open-api`, see `src/swagger-generator.ts`), and
  `apps/web`'s typed client (`@ts-rest/core`) — so the docs can't describe a
  shape the server doesn't actually accept/return. Every `routes.ts` in this
  app is a _thin adapter_: it extracts `params`/`query`/`body` (already
  validated) and delegates to the unchanged, framework-agnostic functions in
  that domain's `queries.ts`, which holds all the actual business logic. If
  Express is ever swapped for something else, only these adapter files
  should need to change.
- Two always-running loops (`src/automation/start.ts`):
    - `process-rules.ts` — fires date-scheduled broadcasts
    - `process-ongoing-sequences.ts` — polls due sequence/broadcast deliveries and
      hands them to a BullMQ queue, processed by `process-ongoing-sequence.ts`
      (renders the email, adds an open-tracking pixel + click-tracked links,
      sends it, and schedules the next email)
- Tag/subscriber-added triggers are event-driven (`automation/fire-event.ts`),
  called directly from the contacts routes instead of being polled.
- An OAuth/API-key-protected MCP server (`POST /mcp`), ported from
  [MediaLit's MCP server](../../../medialit/apps/api/src/mcp) — exposes the same
  contacts/templates/sequences/ESP/team capabilities as the REST API as MCP
  tools (see `src/mcp/tools/*`).
- Each team can configure its own ESP (`src/esp/*`): any provider that
  exposes an SMTP relay works (SendGrid, Mailgun, Postmark, SES, Resend, or a
  custom server). Credentials are encrypted at rest
  (`src/utils/secret-crypto.ts`, AES-256-GCM) and never returned to clients.
  `src/mail/transport.ts` resolves the right transporter per team, falling
  back to the platform's `EMAIL_HOST`/etc when a team hasn't configured one.

### Teams

- An `account` (`src/account/*`) is purely a login identity (one email = one
  account, OTP-based). Every other resource is scoped by `teamId`
  (`src/team/*`), not `accountId` — a team is the actual tenant/data-scope,
  and holds its own sending identity (from name/email, mailing address) and
  mail quota.
- Every account gets a default team on creation, and can create as many more
  as it wants (`POST /teams`). An account can belong to several teams
  (`team_members`, currently always with role `owner` — member invitations
  are a follow-up).
- **API keys are team-scoped, not account-scoped** — a team can hold several,
  independently named/revocable keys (`src/apikey/*`, `POST/GET/DELETE
/teams/:teamId/keys`). A key always resolves to exactly one team; there's no
  ambiguity for API/MCP clients authenticated this way.
- **OAuth-authenticated (browser) requests** resolve their team from an
  explicit `X-Sendlit-Team-Id` header, validated against team membership on
  every call (`src/auth/require-team.ts`) — this is what lets the web
  dashboard switch teams instantly, without re-authenticating. If the header
  is omitted and the account belongs to exactly one team, that team is used
  automatically.
- `POST /provisioning/teams` is a separate, secret-guarded, server-to-server
  endpoint for multi-tenant consumers (e.g. CourseLit provisioning one SendLit
  team per one of its own tenants) to find-or-create a team at any point after
  both stacks have booted, keyed by a consumer-supplied `externalId` rather
  than email (a consumer's own tenants may share an owner email) — see
  `src/provisioning/routes.ts`.
- `SUPER_ADMIN_EMAIL` is a _different_, boot-time-only convenience (mirrors
  MediaLit's admin-bootstrap script): on startup, if set and no account exists
  for it yet, creates one (with its default team + key) and logs the key once
  — useful for local dev/self-hosting, not for provisioning a multi-tenant
  consumer's many tenants over time.

See the root [`ARCHITECTURE.md`](../../ARCHITECTURE.md) for what has been
ported from CourseLit/MediaLit so far and what's still on the roadmap.

## Environment variables

See `.env.example`.

## Running the app

1. Start Postgres and Redis (e.g. via Docker).
2. Copy `.env.example` to `.env` and fill in the values.
3. Push the schema to your database: `pnpm --filter @sendlit/api db:push`
4. Start the server: `pnpm --filter @sendlit/api dev`

The API listens on `PORT` (default `80`) and exposes:

- `GET /health` — liveness check
- `GET /openapi.json`, `GET /docs` — OpenAPI spec / Swagger UI
- `GET /.well-known/oauth-authorization-server` — OAuth2 metadata
- `GET/POST/PATCH/DELETE /teams`, `/teams/:teamId` — team management
  (OAuth-authenticated only)
- `GET/POST/DELETE /teams/:teamId/keys` — API keys for a team
- `POST /contacts`, `GET /contacts`, ... — contacts
- `POST /templates`, `GET /templates`, ... — email templates
- `POST /sequences`, `GET /sequences`, ... — broadcasts & sequences
- `GET /track/open`, `GET /track/click`, `GET /unsubscribe/:token` — tracking
- `GET/PUT/DELETE /esp-config`, `POST /esp-config/test` — per-team ESP config
- `POST /provisioning/teams` — server-to-server team provisioning for
  multi-tenant consumers (guarded by `X-Sendlit-Provisioning-Secret`, not
  OAuth/API-key auth)
- `POST /mcp` — MCP server (JSON-RPC over HTTP, `Mcp-Session-Id` header for
  session continuation); authenticate the same way as REST (`Authorization:
Bearer <token>` or `x-sendlit-apikey`)
