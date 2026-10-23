# ADR 0001: Build SendLit on CodeLit Platform 0.4.1

Status: accepted
Date: 2026-10-18

## Context

SendLit was the origin of several CodeLit Platform packages (billing,
observability, the migration layout) but still used pnpm, ESLint/Prettier,
Vitest, alpha Platform packages, and its own copies of logging, telemetry,
credential handling and billing glue. Production (app.sendlit.app) ran the
unmerged `subscriptions-using-billing` branch on `@codelitdev/billing`
0.1.0-alpha.3. MediaLit adopted Platform a few days earlier and served as the
reference, except where it deviates from Platform (it kept ESLint/Prettier).

## Decision

- **Toolchain.** One Bun 1.4.1 workspace (`bun.lock`), the API running its
  TypeScript on Bun with no emit, Biome for lint and format, and `bun test
  --parallel` for every workspace. `@sendlit/test-utils` fills the gaps in
  Bun's Vitest API. `@sendlit/api-contract` exports TypeScript source.
- **Packages.** Every `@codelitdev/*` package is pinned to exactly 0.4.1, and
  external dependencies to platform-cli's preset; `platform-cli doctor` reports
  no issues. `.codelit-platform.json` and the managed
  `platform-conformance.yml` come from `platform-cli sync`. Dependabot groups
  `@codelitdev/*` updates.
- **Billing.** The production branch is merged and moved to
  `@codelitdev/billing` 0.4.1 with the `@codelitdev/platform/billing` adapters
  (action grants, AES-GCM sensitive values, return-URL validation, workers,
  webhook handling). Paid access comes from `commercialState()`; SendLit's own
  sweeps, expiry checks and copied paid state are removed. SendLit keeps its
  policy columns (overrides, ramp, dunning grace) and adds cancel/resume.
- **Migrations.** `0005_billing` stays exactly as production applied it.
  `main` had shipped a different `0005` in v0.0.0 with a later timestamp, which
  would make the Drizzle migrator skip billing there, so `0006` replays the
  guarded billing SQL and adds main's column idempotently. Better Auth 1.7.7
  no longer writes `account.issuer`, so `0007` makes it nullable (dropped in a
  later release) and adds the `oauth_access_token.revoked` column the provider
  checks for.
- **Kernel.** Requests accept exactly one credential (Platform ADR 0001), using
  the kernel's extraction plus SendLit's `x-sendlit-apikey` and body key;
  `X-API-Key` is accepted too. More than one is `400 credential_ambiguous`; a
  malformed `Authorization` header is rejected. OAuth tokens are verified by
  oauth-server-kit; SendLit reads its `team_id` claim from the verified token
  and re-checks membership. `/health` and `/ready` use the kernel's reports,
  requests carry `X-Request-ID`, and SIGTERM runs an ordered graceful shutdown.
- **Observability.** One `@codelitdev/observability` instance carries logs,
  error capture and OTLP log shipping. Product events use a second instance
  with dedupe and per-source caps off, because the package applies its error
  limits to events too, which would drop all but the first `email_sent` per
  team per minute.
- **MCP.** SendLit keeps its MCP SDK 2 server on the stateless `2026-07-28`
  protocol. `mcp-server-kit` 0.4.1 is built on SDK 1.30 sessions (including
  its CORS policy, which allows `Mcp-Session-Id`), so adopting its transport
  would downgrade the protocol. SendLit uses the kit's parity manifest
  validation (`packages/api-contract/src/mcp-parity.ts`).
- **Conformance.** `runPlatformConformance` is written for the reference
  product's notes domain, so `test:conformance` runs the product-neutral MCP
  discovery suite against the real app, SendLit's kernel-rule checks, and the
  parity manifest. `check:drift` checks the billing schema and Better Auth's
  schema against the Drizzle tables.

## Consequences

- Clients that sent two credentials and relied on precedence now get
  `credential_ambiguous`.
- Deploying the billing change requires the pre-traffic
  `billing reconcile-cancellations` step in `apps/api/README.md`.
- Platform follow-ups: OTLP log shipping in the observability package sends
  one HTTP request per log line without resource attributes; event capture
  should not share error dedupe and caps; mcp-server-kit should move to MCP SDK
  2 and the stateless protocol; billing lacks read models for plan changes and
  the billing manager, operator cancel/resume, and a public checkout abandon.
