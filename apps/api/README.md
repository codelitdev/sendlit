# SendLit API

SendLit API powers email automation: contacts, templates, broadcasts,
sequences, tracking, unsubscribe handling, team-scoped API keys, and per-team
email provider configuration.

## What It Provides

- Transactional emails, broadcasts, sequences, and reusable templates.
- Contact management with tags, subscriptions, and email-based segmentation.
- Event-driven automation for tag changes, new subscribers, and scheduled
  broadcasts.
- Email delivery through BullMQ and nodemailer, using a team's configured ESP
  when available.
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

Each team can configure its own SMTP-compatible ESP, such as SendGrid, Mailgun,
Postmark, SES, Resend, or a custom SMTP server. Credentials are encrypted at
rest with AES-256-GCM in `src/utils/secret-crypto.ts` and are never returned to
clients. If a team has no ESP configured, `src/mail/transport.ts` falls back to
the platform `EMAIL_HOST` settings.

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
ESP settings, teams, and API keys.

## More Context

See the root [`ARCHITECTURE.md`](../../ARCHITECTURE.md) for the broader
CourseLit/MediaLit porting map and roadmap.
