# SendLit API

SendLit API powers email automation: contacts, templates, broadcasts,
sequences, tracking, unsubscribe handling, team-scoped API keys, and per-team
email provider configuration.

## What It Provides

- Transactional emails, broadcasts, sequences, and reusable templates.
- Contact management with tags, subscriptions, and email-based segmentation.
- Event-driven automation for tag changes, new subscribers, and scheduled
  broadcasts.
- Email delivery through BullMQ and nodemailer, using each team's configured
  ESP.
- Bounce and complaint webhook ingestion (Resend, Postmark) with a durable
  receipt inbox, canonical delivery events, and a per-workspace suppression
  list enforced on every send path.
- Open and click tracking, plus unsubscribe handling.
- Better Auth session login, OAuth2 bearer-token authentication, and
  team-scoped API key authentication.
- An MCP server exposing the same core capabilities for API/MCP clients.

## Running Locally

1. Start Postgres and Redis.
2. Copy `.env.example` to `.env` and fill in the required values.
3. Push the database schema:

    ```sh
    pnpm --filter @sendlit/api db:push
    ```

4. Start the API:

    ```sh
    pnpm --filter @sendlit/api dev
    ```

The server listens on `PORT` from `.env` (`4000` in `.env.example`; `80` if
unset).

## Database Migrations In Docker

Production-style Docker deployments should apply the checked-in Drizzle SQL
migrations before starting the API. The API image includes:

- `apps/api/drizzle` — generated migration SQL and metadata;
- `apps/api/dist/db/migrate.js` — a one-shot migration runner.

The root self-hosted deployment runs this through a Compose `init` service:

```sh
cp .env.example .env
# Fill in the required secrets and SUPER_ADMIN_EMAIL.
docker compose up --build -d
docker compose logs init
```

Startup order:

1. Postgres starts and passes its health check.
2. Redis starts and passes its health check.
3. `init` runs `node apps/api/dist/db/migrate.js`, then creates the configured
   super-admin account, default team, and one-time API key.
4. The init container exits successfully.
5. `api` starts.
6. `web` starts.

This mirrors an init-container pattern. The API process itself does not apply
migrations on every boot; it only checks that the database is reachable. For
local development, continue using `pnpm --filter @sendlit/api db:push` unless
you are explicitly testing generated migration files.

## API Reference

Visit `GET /docs` on the running API for the Swagger UI. It contains the full
REST API reference, including request and response schemas.

Fetch `GET /openapi.json` for the raw OpenAPI document.

`GET /health` is available as a lightweight liveness check.

## Authentication

SendLit supports three authentication modes:

- **Better Auth sessions** for the first-party web dashboard. Browser login
  supports Google and Email OTP. The web app proxies `/api/auth/*` to this API
  and keeps the Better Auth session cookie httpOnly.
- **OAuth2 bearer tokens** for delegated REST and MCP clients. Better Auth's
  OAuth Provider endpoints are exposed under `/api/auth/oauth2/*`, with
  authorization-server metadata at
  `/.well-known/oauth-authorization-server` and OIDC metadata at
  `/.well-known/openid-configuration`.
- **API keys** for server-to-server, REST, and MCP clients. API keys are scoped
  to one team and are sent with the `x-sendlit-apikey` header.

Session and OAuth requests resolve the active team through the
`X-Sendlit-Team-Id` header. If the account belongs to exactly one team, the
header may be omitted.

API keys are stored hashed and cannot be recovered after creation. If a key is
lost, create a new one and revoke the old key.

When the API runs behind the web BFF or another reverse proxy, set
`ENABLE_TRUST_PROXY=true` so auth endpoint rate limits can use the real client
IP from `X-Forwarded-For`.

## Local REST Bearer Token

For local REST API testing with `Authorization: Bearer <token>`, run the API
package helper:

```sh
pnpm --filter @sendlit/api run access-token email@address.com
```

The email must already belong to a registered SendLit account and Better Auth
user. The account must also belong to a team. If the account belongs to more
than one team, pass the public team ID explicitly:

```sh
pnpm --filter @sendlit/api run access-token email@address.com --team team_...
```

The command prints only the access token. Use it in REST requests as:

```sh
curl http://localhost:5000/contacts \
  -H "Authorization: Bearer <token>" \
  -H "X-Sendlit-Team-Id: team_..."
```

The `X-Sendlit-Team-Id` header is optional only when the account belongs to
exactly one team.

## Bootstrap API Key

For local development or self-hosted installs, set `SUPER_ADMIN_EMAIL` before
starting the API. On startup, if no account exists for that email, SendLit
creates:

- the account;
- its default team;
- a default team-scoped API key.

The plaintext API key is logged once with the `Super admin account created`
message. After that, only the hash is stored. Copy the key from the first
startup logs (`docker compose logs`, or the API process logs) and use it as
`x-sendlit-apikey` for REST or MCP requests.

If the account already exists, bootstrap does nothing and cannot re-print the
key. Create or rotate keys through the dashboard, `POST /teams/:teamId/keys`,
or the MCP `create_api_key` tool.

## Teams And Tenancy

An `account` is only a login identity. A `team` is the tenant boundary and owns
contacts, templates, sequences, ESP configuration, API keys, sending identity,
mailing address, and quota.

Every account gets a default team on creation and can create more teams. API
keys are team-scoped, not account-scoped, so an API key always resolves to
exactly one team.

`POST /provisioning/teams` is a separate server-to-server endpoint for
multi-tenant consumers, such as CourseLit, to find or create one SendLit team
per external tenant. It is guarded by `X-Sendlit-Provisioning-Secret`, not by
OAuth or API key authentication.

`SUPER_ADMIN_EMAIL` is only a boot-time convenience for the first local or
self-hosted account. It is not the provisioning mechanism for multi-tenant
consumers.

## Architecture

REST routes are defined once in the `ts-rest` contract at
`packages/api-contract` (`@sendlit/api-contract`). That contract is the source
of truth for:

- runtime request and response validation via `@ts-rest/express`;
- OpenAPI generation via `@ts-rest/open-api`;
- the typed web client in `apps/web`.

Route files in `apps/api/src/*/routes.ts` are intentionally thin adapters.
They read already-validated params, query, and body values, then delegate to
framework-agnostic domain logic in each module's `queries.ts`.

Email automation runs through two loops in `src/automation/start.ts`:

- `process-rules.ts` fires date-scheduled broadcasts.
- `process-ongoing-sequences.ts` finds due deliveries and hands them to a
  BullMQ queue processed by `process-ongoing-sequence.ts`.

Tag and subscriber-added automations are event-driven through
`automation/fire-event.ts`.

Each team can configure one or more of its own SMTP-compatible ESPs (`esp_configs`),
such as SendGrid, Mailgun, Postmark, SES, Resend, or a custom SMTP server, via
`GET/POST /settings/esps` and `GET/PATCH/DELETE /settings/esps/:espId`. One
user ESP is the team's default; a sequence, broadcast, or transactional send
may pin a different one with `espId`. Credentials are encrypted at rest with
AES-256-GCM in `src/utils/secret-crypto.ts` and are never returned to clients.
`/settings/esp` (singular) remains as a backward-compatible alias over the
team's default user ESP.

Every sequence and transactional email persists an internal `deliveryRoute`
(`custom` or `platform`) alongside the resolved user ESP's internal id
(`outboxId`). `custom` is the only route currently reachable — it always
pins a specific team-owned `esp_configs` row and is required before
transactional mail can be queued or a sequence/broadcast can be marked
active; `platform` is reserved for a future deployment-level SendLit-provided
transport (resolved from deployment configuration, never from `esp_configs`)
and isn't exposed by any endpoint yet. User-managed/custom ESP delivery never
consults or increments the account's SendLit mail quota — those counters are
reserved for the future platform route.

## Bounce And Complaint Feedback

Full design in [`docs/bounces-and-complaints.md`](./docs/bounces-and-complaints.md).
Summary of what's implemented:

- **Outbound ledger.** Every custom-route send (campaign or transactional)
  gets an `outbound_messages` row before transport, carrying a generated RFC
  `Message-ID`, the pinned ESP snapshot, and (once accepted) the transport's
  response. `src/delivery-feedback/outbound-send.ts` /
  `outbound-queries.ts`.
- **Feedback connections.** Each user ESP with a reviewed provider adapter
  (Resend, Postmark, SendGrid, and Mailgun — see `feedbackCapableProviders` in
  `src/config/constants.ts`) can configure its own webhook connection under
  `GET/PUT /settings/esps/:espId/feedback`, `POST .../feedback/rotate`,
  `POST .../feedback/test`, `DELETE .../feedback`. Every configuration has
  its own opaque `whc_...` connection id/URL, credential, and health —
  switching the team's default ESP never moves or copies feedback config.
  Changing an ESP's provider retires the old connection and a later `PUT`
  creates a new one; deleting an eligible ESP retires its connection while
  preserving historical events/suppressions.
- **Public webhook route.** `POST /webhooks/esp/:provider/:connectionId`
  (`src/delivery-feedback/webhook-route.ts`) is mounted before global JSON
  parsing and before any session/API-key middleware — it authenticates
  purely via the resolved connection's provider adapter (Svix signature for
  Resend, a shared secret for Postmark, ECDSA Signed Event Webhook for
  SendGrid, HMAC over timestamp+token for Mailgun), commits a durable,
  encrypted receipt (`esp_webhook_receipts`) before returning `200`, and
  never itself normalizes the payload inline.
- **Async processing.** A BullMQ `esp-feedback` queue/worker
  (`feedback-queue.ts`/`feedback-worker.ts`) plus a recovery poller
  (`poller.ts`, 30s interval) drain receipts through
  `process-receipt.ts`: provider adapter → canonical `email_delivery_events`
  (idempotent per `(connectionId, providerEventKey)`) → correlate to an
  `outbound_messages` row (`correlation.ts`) → delivery-state projection
  (`projection.ts`) → suppression side effects. A committed receipt is
  always the recovery source of truth if Redis is unavailable.
- **Suppression.** `email_suppressions` is workspace-wide and
  route-independent, keyed by an HMAC (`SUPPRESSION_HASH_KEY`) over the
  normalized address — never derived from `contacts.subscribed`, so it
  survives contact deletion/reimport. Checked before enqueue (transactional
  `422 recipient_suppressed`; sequence sends skip the recipient without
  counting it as sent) and again immediately before transport in the worker.
  `GET/POST /suppressions*` exposes the list and owner release action;
  complaint suppressions can only be released by a `sendlit_operator` actor.
- **Retention.** `retention.ts` (hourly loop) purges raw receipt payloads
  after 30 days and delivery events after 13 months, in bounded batches.
- **Not yet implemented:** the Amazon SES adapter (its own PRD phase,
  [`docs/aws-bounces-and-complaints.md`](./docs/aws-bounces-and-complaints.md) —
  SNS signature/subscription handling is materially different from a direct
  signed webhook); a provider without an adapter is never presented as
  feedback-capable. Observability is limited
  to the existing `captureEvent`/`captureError` posthog pattern — dedicated
  dashboards/alerting and load/chaos testing are deployment-level follow-ups.

## MCP Server

The MCP server is exposed at `POST /mcp` over JSON-RPC HTTP. Use the
`Mcp-Session-Id` header for session continuation.

MCP clients authenticate the same way as REST clients:

- `Authorization: Bearer <token>`
- `x-sendlit-apikey`

OAuth-capable MCP clients can discover metadata from:

- `GET /.well-known/oauth-protected-resource`
- `GET /.well-known/oauth-authorization-server`
- `GET /.well-known/openid-configuration`

OAuth client registration, authorization, token, introspection, revocation, and
userinfo endpoints are served by Better Auth under `/api/auth/oauth2/*`.

MCP tools live in `src/mcp/tools/*` and cover contacts, templates, sequences,
ESP settings (both the default-ESP singleton tools and the multi-ESP
collection tools — `list_esps`/`create_esp`/`get_esp`/`update_esp`/
`delete_esp`/`test_esp`), teams, API keys, and bounce/complaint delivery
feedback (`get_esp_feedback_connection`/`upsert_esp_feedback_connection`/
`test_esp_feedback_connection`/`delete_esp_feedback_connection`,
`list_delivery_events`/`get_delivery_event`,
`list_suppressions`/`get_suppression`/`release_suppression`).

## More Context

See the root [`ARCHITECTURE.md`](../../ARCHITECTURE.md) for the broader
CourseLit/MediaLit porting map and roadmap.
