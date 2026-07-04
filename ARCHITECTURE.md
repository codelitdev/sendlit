# SendLit Architecture & Migration Plan

SendLit is being bootstrapped by extracting the email composing/sending/automation
capabilities that already exist (and are proven in production) inside **CourseLit**,
and by reusing the **OAuth2 + passwordless (email OTP) authentication** implementation
from **MediaLit**'s API. This document tracks the mapping between the source projects
and SendLit, the architectural decisions made along the way, and what is still left
to port.

## Tech stack (decided, see root `README.md`)

- TypeScript everywhere
- PostgreSQL (via `drizzle-orm` + `pg`) — CourseLit/MediaLit use MongoDB/Mongoose;
  SendLit intentionally uses Postgres, so every Mongoose schema below has been
  redesigned as a relational table.
- Redis + BullMQ for queues/workers (mail sending, sequence delivery)
- Express for the API (`apps/api`), mirroring MediaLit's app structure —
  request/response validation, the OpenAPI doc, and the web client are all
  generated from one `ts-rest` contract (`packages/api-contract`)
- Next.js 16 (App Router, Turbopack by default) + shadcn/ui for the web app
  (`apps/web`)
- React 19.2 + react-email for the WYSIWYG editor (`packages/email-editor`)

## Source → destination mapping

| Concept | Source | Destination |
|---|---|---|
| OAuth2 server (PKCE, DCR, email-OTP login, JWT access/refresh, revocation) | `medialit/apps/api/src/oauth/*` | `sendlit/apps/api/src/oauth/*` (persistence rewritten for Postgres/Drizzle, static/dynamic clients, JWT signing unchanged) |
| API-key auth | `medialit/apps/api/src/apikey/*` | `sendlit/apps/api/src/apikey/*` |
| Bearer/API-key resolution middleware | `medialit/apps/api/src/auth/*` | `sendlit/apps/api/src/auth/*` |
| Account/owner identity | `medialit/apps/api/src/user/*` | `sendlit/apps/api/src/account/*` (a SendLit "account" is a pure login identity — one email = one account, OTP-based. It is *not* the tenant/data-scope — see "Teams" below) |
| Tenant/data-scope boundary | *(new concept — see "Teams" below; CourseLit's closest analog is its multi-tenant "domain", MediaLit's closest analog is its per-key "App")* | `sendlit/apps/api/src/team/*` — every resource (contacts, templates, sequences, ESP config, API keys) is scoped by `teamId`, not `accountId` |
| Contacts / subscribers | `courselit` `User` model (doubles as subscriber) — `packages/orm-models/src/models/user` | `sendlit/apps/api/src/contacts/*` — dedicated `contacts` table, not overloaded with course/product fields |
| Segmentation filters | `packages/orm-models/src/models/user-filter.ts`, `@courselit/common-logic` `convertFiltersToDBConditions` | `sendlit/apps/api/src/contacts/segment.ts` (trimmed to the filters that make sense without courses/communities: tag, email, subscription status, signed-up date) |
| Email templates | `apps/web/graphql/mails/logic.ts` (`*EmailTemplate*`), `packages/orm-models/src/models` (implicit) | `sendlit/apps/api/src/templates/*` |
| Broadcasts & sequences | `apps/web/graphql/mails/*`, `packages/orm-models/src/models/sequence/*` | `sendlit/apps/api/src/sequences/*` |
| Rule engine (event → sequence trigger) | `packages/orm-models/src/models/rule.ts`, `apps/queue/src/domain/process-rules.ts` | `sendlit/apps/api/src/automation/process-rules.ts` |
| Ongoing sequence delivery (the actual send loop, pixel + click tracking, unsubscribe, liquid templating) | `apps/queue/src/domain/process-ongoing-sequences/*` | `sendlit/apps/api/src/automation/process-ongoing-sequence.ts` |
| Mail transport & queue | `apps/queue/src/mail.ts`, `apps/queue/src/domain/queue.ts`, `.../handler.ts`, `.../worker.ts` | `sendlit/apps/api/src/mail/*` |
| Delivery/open/click tracking | `packages/orm-models/src/models/email-delivery.ts`, `email-event.ts` | `sendlit/apps/api/src/db/schema.ts` (`email_deliveries`, `email_events`) + `sendlit/apps/api/src/tracking/routes.ts` |
| WYSIWYG email editor | `packages/email-editor` (already stack-agnostic: React + Radix + react-email + Tailwind) | `packages/email-editor` (copied as-is, renamed to `@sendlit/email-editor`) |
| Headless broadcast/sequence/template composer blocks | *(did not exist as a standalone package in CourseLit — it's inlined in `apps/web/components/admin/mails/*` and `apps/web/app/.../dashboard/mail/*`)* | `packages/email-blocks` — built (see Roadmap) |
| Dashboard UI | `apps/web/app/(with-contexts)/dashboard/(sidebar)/mails/*` | `apps/web` — built (see Roadmap) |
| MCP server | `medialit/apps/api/src/mcp/*` (media-specific tools) | `sendlit/apps/api/src/mcp/*` — built (see Roadmap) |

### Deliberately dropped/out of scope

- **Course drip campaigns** (`apps/queue/src/domain/process-drip.ts`): entirely tied to
  CourseLit's course/section model. SendLit has no concept of courses, so this was not
  ported.
- Segmentation filters tied to products/communities/memberships (`UserFilter.PRODUCT`,
  `COMMUNITY`, `PERMISSION`) — not applicable without a course platform behind SendLit.
- Multi-tenant "domain" abstraction — CourseLit's per-domain settings/quota model
  reappears in SendLit as the per-*team* `teams` table (see "Teams" below), so
  `domain` foreign keys became `team_id`, not `account_id`.

## Data model (Postgres/Drizzle) — `apps/api/src/db/schema.ts`

`accounts`, `teams`, `team_members`, `oauth_clients`, `oauth_pending_auth`,
`oauth_revoked_tokens`, `api_keys`, `esp_configs`, `contacts`, `email_templates`,
`sequences`, `sequence_emails`, `rules`, `ongoing_sequences`, `email_deliveries`,
`email_events`.

Every table above except `accounts`/`team_members` (account-scoped) and the
OAuth bookkeeping tables (client-scoped) carries a `team_id`, not `account_id`
— see "Teams" below.

See the schema file for exact columns; column names intentionally mirror the Mongoose
field names from CourseLit so the port is easy to audit.

## Roadmap / what's left

Phase 1 — **done**:
- [x] `packages/email-editor` ported
- [x] `apps/api`: Postgres schema, OAuth2 (email OTP + PKCE + DCR + JWT), API keys
- [x] `apps/api`: contacts CRUD + tag-based segmentation
- [x] `apps/api`: email templates CRUD
- [x] `apps/api`: sequences/broadcasts CRUD (+ per-email sub-resource, start/pause)
- [x] `apps/api`: mail sending queue/worker (BullMQ + nodemailer)
- [x] `apps/api`: automation loops — rule processing (date-based broadcast scheduling)
      and ongoing-sequence delivery (with open/click tracking pixels + unsubscribe)

Phase 2 — **done**:
- [x] `packages/email-blocks`: headless `value`/`onChange` components — `TemplateForm`,
      `SequenceMetaForm`, `SequenceEmailForm`, `SequenceEmailList`,
      `ContactFilterBuilder`, `TriggerPicker`, `TagEditor` — built on top of
      `@sendlit/email-editor`
- [x] `apps/web`: Next.js dashboard — OAuth2 PKCE login against the API (via a
      same-origin `/api/proxy` BFF that keeps tokens in httpOnly cookies and
      silently refreshes them), contacts, templates, broadcasts and sequences
      screens built on `packages/email-blocks`

Both were validated end-to-end against a real Postgres+Redis+API+web stack
(login → create contact → tag it → create a template in the WYSIWYG editor →
create a broadcast, filter by tag, publish and start it → automation loop
enrolls the matching contact and delivers the email → stats update; same for
a `subscriber:added`-triggered sequence). That pass caught and fixed three
real bugs in the Phase 1 automation engine:
- `process-ongoing-sequence.ts` looked up the sequence by internal `id`
  using the ongoing sequence's public `sequenceId`, so every tick silently
  no-opped and deleted the ongoing-sequence row without ever sending mail.
- Finishing a `sequence`-type automation's delivery to one contact
  incorrectly flipped the whole sequence to `completed` (copied from the
  broadcast-only behavior in CourseLit without the `type === "broadcast"`
  guard), which would have stopped it from ever enrolling future contacts.
- The public tracking-pixel/click/unsubscribe routes were mounted *after*
  the authenticated routers, whose router-level `requireAuth` middleware has
  no path scoping and therefore intercepted (401'd) every request that
  reached it — including these public, unauthenticated endpoints. Fixed by
  mounting `trackingRoutes` before the authenticated routers.

Phase 3 — **done**:
- [x] `apps/api/src/mcp`: OAuth/API-key-protected MCP server (`POST /mcp`), ported from
      `medialit/apps/api/src/mcp` — same `StreamableHTTPServerTransport` session
      handling, CORS and Accept-header patching. 20 tools across three files
      (`mcp/tools/contacts.ts`, `templates.ts`, `sequences.ts`) cover the same surface
      as the REST API: list/get/create/update/delete contacts + tag add/remove,
      list/get/create/update/delete templates, and list/get/create/update sequences +
      add/update/delete a sequence email + start/pause + stats.
- [x] Sequence email reordering: `SequenceEmailList` (in `packages/email-blocks`) grew
      an `onReorder` prop with move-up/move-down controls (chosen over a drag-and-drop
      library to avoid an extra dependency for a small, keyboard-accessible affordance);
      wired to `PATCH /sequences/:id` (`emailsOrder`) in the sequence editor page.
- [x] Contact detail page now shows a "Delivery history" panel — a new
      `getDeliveriesByContact` query/route (`GET /contacts/:contactId/deliveries`,
      joining `email_deliveries` with `sequences`) surfaced in `apps/web`.

All three were validated end-to-end: the MCP server was driven with raw
JSON-RPC over HTTP (initialize → tools/list → tools/call, plus an
invalid-API-key rejection test) against a live Postgres-backed account/API-key;
reordering and delivery history were exercised in the browser against the
real API, including a reload to confirm persistence.

Phase 4 — **done**:
- [x] Per-account ESP (email sending provider) configuration. New `esp_configs`
      table (one row per account: provider label, SMTP host/port/secure,
      username, AES-256-GCM encrypted password, from name/email, last-test
      status). Any provider that exposes an SMTP relay works — SendGrid,
      Mailgun, Postmark, SES and Resend all do, alongside a fully custom SMTP
      server — so the transport is always plain SMTP via nodemailer; `provider`
      is just a label for the UI/API.
  - `apps/api/src/esp/*`: `GET/PUT/DELETE /esp-config`, `POST /esp-config/test`
    (always attempts a real send, regardless of `NODE_ENV`, so users can verify
    their config immediately).
  - `apps/api/src/utils/secret-crypto.ts`: AES-256-GCM at rest, keyed by
    `ESP_CREDENTIALS_ENCRYPTION_KEY`; the API refuses to start if it's missing
    or too short (same pattern as `OAUTH_SIGNING_KEY`). The password is never
    returned to API/MCP clients — only a `hasPassword` boolean.
  - `apps/api/src/mail/transport.ts`: resolves (and caches) a per-account
    nodemailer transporter; `mail/send.ts`'s `sendMail`/`sendTestMail` use the
    account's transporter when configured, falling back to the platform's
    `EMAIL_HOST`/etc otherwise. Wired through `mail/worker.ts` and
    `automation/process-ongoing-sequence.ts` (both already carried `accountId`).
  - `apps/api/src/mcp/tools/esp.ts`: `get_esp_config`, `update_esp_config`,
    `delete_esp_config`, `send_test_email` MCP tools mirror the REST API.
  - `apps/web`: new `/dashboard/settings` page (provider/host/port/TLS/
    username/password/from-name/from-email form, save, send-test-email with
    live success/failure feedback, remove).

Validated end-to-end against a real Postgres + local SMTP test server
(Mailpit): saved an SMTP config, sent a test email and confirmed it was
actually received (correct from/to/subject/body), removed the config, and
drove the same flow through the MCP tools via raw JSON-RPC (`update_esp_config`
→ `send_test_email` → confirmed receipt → `delete_esp_config`). This pass also
found and fixed two more bugs:
- `next dev` crashed compiling any API route because `tailwind.config.ts` used
  `require("tailwindcss-animate")`, which fails under the loader Next.js uses
  for route handlers; switched to a static `import`.
- The `apps/web` BFF proxy (`app/api/proxy/[...path]/route.ts`) constructed a
  `NextResponse` with the raw (empty-string) upstream body for every response,
  which throws for status codes the fetch spec defines as having *no* body
  (204, 205, 304, ...) — so **every** `DELETE` in the app (contacts, templates,
  and now ESP config, all of which return `204 No Content`) 500'd in the
  browser even though the underlying delete had actually succeeded. Fixed by
  passing `null` instead of the body for those status codes.

Phase 5 — **done**:
- [x] `apps/api`: **Teams** — the tenant/data-scope boundary, decoupled from
      the OAuth login identity. An `account` is purely who's logged in (one
      email = one account); a `team` is what everything else (contacts,
      templates, sequences, ESP config, mail quota, API keys) is scoped to.
      An account can own/belong to any number of teams.
  - New tables: `teams` (name, owner, `externalId` for programmatic
    provisioning, sending identity, mail quota) and `team_members`
    (account ↔ team, `role: owner | member`).
  - Every previously `account_id`-scoped column (`contacts`, `email_templates`,
    `sequences`, `rules`, `ongoing_sequences`, `email_deliveries`,
    `esp_configs`, `email_events`, `api_keys`) is now `team_id`-scoped instead.
    The account-level `fromName`/`fromEmail`/`mailingAddress`/mail-quota
    columns moved from `accounts` to `teams` accordingly.
  - **API keys are team-scoped, not account-scoped** (`src/apikey/*`,
    `POST/GET/DELETE /teams/:teamId/keys`): a team can hold several,
    independently named/revocable keys (e.g. one per external integration)
    without any of them being able to see another team the owning account
    belongs to. A key always resolves to exactly one, fixed team — no
    ambiguity for API/MCP clients authenticated this way.
  - `src/auth/require-team.ts`: a new middleware, layered after
    `requireAuth`/`mcpAuth`, that resolves `req.teamId`. For API-key auth it's
    a no-op (the key already carries it). For OAuth (browser/human) auth, it
    reads an explicit `X-Sendlit-Team-Id` header, validated against team
    membership on every request — this is what lets the web dashboard switch
    teams instantly, without re-authenticating — falling back to the
    account's sole team if the header is omitted and it only has one.
  - `src/team/routes.ts`: `GET/POST/PATCH/DELETE /teams` (list/create/rename/
    delete a team) is deliberately account-level, not team-scoped, and
    restricted to OAuth-authenticated sessions — an API key enumerating every
    team its owning account belongs to would defeat the point of scoping keys
    to one team.
  - `src/provisioning/routes.ts`: `POST /provisioning/teams`, a separate,
    static-secret-guarded (`PROVISIONING_SECRET`, compared with
    `crypto.timingSafeEqual`), server-to-server endpoint for multi-tenant
    consumers (the motivating case: CourseLit provisioning one SendLit team
    per one of its own tenants/"domains") to find-or-create a team at any
    point after both stacks have booted — not just at container start.
    Idempotent, keyed by a consumer-supplied `externalId` (e.g.
    `courselit:<domainId>`) rather than the owner's email, since two of a
    consumer's own tenants may share an owner email (which would otherwise
    incorrectly merge them into one team).
  - `src/bootstrap.ts`: a *separate*, boot-time-only convenience directly
    ported from MediaLit's `createAdminUser()` — if `SUPER_ADMIN_EMAIL` is
    set and no account exists for it yet, creates one (with its default team
    + key) and logs the key once. Useful for local dev/self-hosting a single
    instance; not a substitute for `/provisioning/teams`, which a multi-tenant
    consumer needs in order to provision many teams over the running lifetime
    of the app, not just once at boot.
  - `apps/web`: a `/dashboard/teams` page (list teams, create new ones,
    switch — a plain form POST to `/api/team/switch` sets a
    `sendlit_team_id` cookie the BFF proxy forwards as `X-Sendlit-Team-Id` —
    and manage each team's API keys). Nav link added alongside Settings.

  **Why a dedicated `teams` table instead of MediaLit's "Apps" pattern**
  (where an API key *is* the container, one key = one owner, forever): that
  model would have permanently welded a team's identity to a single secret
  (no way to rotate/add a second key without losing or duplicating the
  container), and given every OAuth session a fixed "default key" instead of
  a real, nameable, switchable team. The `teams` table keeps the good part of
  that pattern — lightweight, independently creatable, named containers —
  while decoupling it from any one credential, and sets up the CourseLit
  integration cleanly: one team per CourseLit domain, each with its own
  contacts, sending identity, and quota, regardless of how many people or
  integration keys touch it.

Validated end-to-end against a live Postgres + Redis + Mailpit stack: booted
with `SUPER_ADMIN_EMAIL` set and confirmed the account/team/key were created
and logged; created a contact via that key; provisioned a second team via
`POST /provisioning/teams` (simulating a CourseLit tenant) and created a
contact with the *same* email address under it — confirmed both contacts
exist independently, one per team, with no collision; confirmed re-provisioning
the same `externalId` is idempotent (returns the same team + key); confirmed
an invalid provisioning secret is rejected (401) and that an API key cannot
call the account-level `/teams` endpoints (403, `oauth_required`); configured
a per-team ESP and sent a real test email through Mailpit, confirming the
correct per-team From name/address and that the *other* team's ESP config
stayed `null`; drove `list_contacts` through the MCP JSON-RPC surface with an
API key and confirmed it returned only that key's team's contact. Both
`apps/api` (`tsc --noEmit`) and `apps/web` (`tsc --noEmit` + `next build`)
compile clean.

Gap fix (post-Phase-5) — **done**: **system/starter templates**. CourseLit
offers four themed starting templates (Announcement, New user welcome,
Upsell products, Newsletter) plus a Blank one, selectable alongside a user's
own templates whenever creating a template, broadcast, or sequence, or
adding an email to a sequence (`apps/web/.../mails/new/new-mail-page-client.tsx`,
CourseLit's `getSystemEmailTemplates`). This had not been ported — SendLit's
equivalent flows only ever offered a blank canvas (new template) or required
an existing saved template (new broadcast/sequence/sequence-email), with no
way to start from a themed default. Fixed:
- `apps/api/src/templates/system-templates.ts`: the same five templates as
  static, in-code data (`SYSTEM_TEMPLATES`) rather than files read off disk
  per-request like CourseLit — they never vary per deployment, so there's no
  need for filesystem I/O at request time.
- `templates/queries.ts`'s new `resolveStartingTemplate(teamId, templateId)`
  checks the system list first, then falls back to a team's own saved
  template — used by `sequences/queries.ts`'s `createSequence` and
  `addMailToSequence` (and therefore both the REST and MCP surfaces, and both
  broadcasts and sequences, for free) instead of requiring a real DB row.
  A system template id can be passed anywhere a `templateId` is accepted.
- `GET /system-templates` (not team-scoped — identical for every team) +
  the `list_system_templates` MCP tool.
- `packages/email-blocks`'s new `TemplateChooser` component — a single,
  reusable "pick a system template or one of your own" grid, wired into all
  three call sites: the templates page's "New template" dialog, the broadcast/
  sequence creation dialog, and the sequence editor's "add email" dialog.

Validated end-to-end: listed all five system templates via the API;
created a broadcast directly from `system:newsletter` and confirmed the
full themed content (not just the title) was seeded onto its first email;
created a sequence from `system:blank` and added a second email from
`system:welcome`, confirming both are independently seeded correctly; confirmed
an unknown template id still 400s (`item_not_found`) exactly as before. Also
found and fixed a latent bug from the Phase 5 migration while in this area:
`packages/email-blocks/src/types.ts`'s `Contact`/`EmailTemplate`/`Sequence`
types still declared a stale `accountId` field (should have been renamed to
`teamId` along with everything else) — harmless at runtime since nothing read
it, but incorrect; renamed. `apps/api`, `packages/email-blocks`, and
`apps/web` all typecheck and build clean.

Gap fix (post-Phase-5) — **done**: **migrated the REST API from Express +
`swagger-autogen` to a `ts-rest` contract**. The original complaint ("payload
schemas aren't documented") turned out to need more than a docs-generator
swap — `swagger-autogen`'s comment/introspection approach couldn't produce
request-body schemas at all for routes that `zod.safeParse(req.body)` the
whole object at once (its runtime auto-detection needs individual
`req.body.x` property access), and hand-writing `#swagger.requestBody`
annotations (eval'd JS object literals in comments) for 37 endpoints would
have been exactly the kind of docs/code drift risk this project has been
trying to avoid. `ts-rest` (evaluated against Hono/Fastify migration and
plain `@asteasolutions/zod-to-openapi`) was chosen because it *also* gives a
fully-typed client, removing the hand-maintained, independently-drifting
API-shape duplication that previously lived in `apps/web/lib/api.ts`.

- **New workspace package `packages/api-contract`** (`@sendlit/api-contract`):
  the single source of truth. Zod schemas for every entity (`contactSchema`,
  `emailTemplateSchema`, `sequenceSchema`, `espConfigSchema`, `teamSchema`,
  `apiKeySchema`, ...) and every request body, plus the full route tree
  (`contract.contacts`, `.templates`, `.sequences`, `.esp`, `.teams`,
  `.provisioning`) built with `initContract()`. Consumed by:
  - `apps/api` — `@ts-rest/express`'s `initServer()`/`createExpressEndpoints`
    validates every request and response against these schemas at runtime.
  - `apps/api/src/swagger-generator.ts` — `@ts-rest/open-api`'s
    `generateOpenApi(contract, ...)` generates `swagger_output.json` directly
    from the contract; no more hand-written annotations, and it's no longer
    possible for the doc to describe a shape the server doesn't actually
    accept/return.
  - `apps/web/lib/api.ts` — `@ts-rest/core`'s `initClient(contract, ...)`
    gives a fully-typed client; every existing exported function
    (`listContacts`, `createSequence`, ...) is a thin wrapper around it that
    preserves its exact previous signature and error-handling behaviour (401
    → redirect to `/login`, 409 `team_required`/`no_team` → redirect to
    `/dashboard/teams`, otherwise throw `ApiError`), so **no dashboard page
    component needed to change**.
- **Every domain's `routes.ts` became a thin ts-rest adapter** — handlers
  extract `params`/`query`/`body` (already validated), call the *same,
  unchanged* `queries.ts` functions, and map the result to `{ status, body }`.
  No business logic was moved into the ts-rest layer, deliberately: `queries.ts`
  stays framework-agnostic, so a future Fastify/Hono swap (if ever pursued)
  would only touch these thin adapter files.
- `apps/api/src/utils/serialize.ts`'s new `serializeDates()` converts
  Drizzle's real `Date` objects to ISO strings (both at runtime *and* in the
  type system, via a `SerializedDates<T>` mapped type) before a route returns
  `{ status, body }` — `queries.ts` intentionally keeps returning raw rows;
  serializing for HTTP is a transport concern, not business logic, so it
  belongs in the adapter, not the query layer.
- A real monorepo pitfall worth recording: `initClient()` failed to typecheck
  in `apps/web` with every contract route resolving to `never`, because pnpm
  had installed *two different physical copies* of `@ts-rest/core` (keyed by
  differing `@types/node` peer-dependency hashes across `apps/web` and
  `packages/api-contract`), and `@ts-rest/core`'s route/body types rely on
  TypeScript `unique symbol`s, which aren't structurally compatible across
  separate copies of the same package version. Fixed by adding a root-level
  `pnpm.overrides` pinning `@types/node` to one version workspace-wide.

Validated end-to-end against the real Postgres/Redis stack (a throwaway API
instance on a spare port, torn down immediately after — the normal dev
instances were left untouched throughout): confirmed all 34 contract
endpoints registered correctly at boot; created a contact through the new
ts-rest-validated `POST /contacts` and confirmed the row persisted correctly;
confirmed an invalid payload (`{"email": "not-an-email"}`) is now rejected
with a real Zod validation error (not just a docs gap — actual stricter
runtime enforcement than before, since the schema is now the single
enforcement point for both); confirmed `/system-templates`, `/teams`
(correctly still rejecting API-key auth with `oauth_required`), and
`/openapi.json`/`/docs` all still work. Both `apps/api` (`tsc --noEmit`) and
`apps/web` (`tsc --noEmit` + `next build`) compile clean.

Follow-up cleanup — **done**: removed the last cosmetic traces of the old
`swagger-autogen` era. `tracking/routes.ts` (`/track/open`, `/track/click`,
`/unsubscribe/:unsubscribeToken`) and `index.ts` (`/health`,
`/openapi.json`) still had dead `#swagger.summary`/`#swagger.ignore`
comments left over from before the migration — these routes were never fed
through `swagger-autogen` even in the old setup that generated
`swagger_output.json` from source comments in `apps/api`'s prior life, and
they aren't part of the `ts-rest` contract either (they return a tracking
pixel/redirect/HTML page for email clients and recipients, not JSON for API
consumers, so they were deliberately left out of the documented surface).
Replaced the dead annotation comments with plain descriptive comments.
Also confirmed `swagger-autogen` is not referenced by any workspace
`package.json` or `pnpm-lock.yaml` anymore; a stale copy in
`node_modules/.pnpm` survived a plain `pnpm install`/`pnpm prune` (a virtual
-store caching quirk, not a real dependency) and was removed by directly
deleting `node_modules/.pnpm/swagger-autogen@2.23.7` and its
`node_modules/.pnpm/node_modules/swagger-autogen` symlink. Validated:
`apps/api` typechecks clean and `pnpm --filter @sendlit/api build`
(swagger-generate + `tsc`) still succeeds end-to-end after the cleanup.

Gap fix (post-Phase-5) — **done**: upgraded `apps/web` to **Next.js 16.2.9**
(from 15.1/15.5) and **React 19.2**, following the official upgrade guide
(`pnpm add next@latest react@latest react-dom@latest`, plus `@types/react`/
`@types/react-dom`; also fixed `packages/email-editor`'s stale `@types/react
@^18` devDependency, which no longer matched the workspace's React 19). Checked
every Next 16 breaking change against this app before touching anything: no
`middleware.ts` (nothing to rename to `proxy.ts`), no custom `webpack` config
(Turbopack — now default for both `dev` and `build` — works with zero config
changes), no `next/image` usage, no parallel routes, no `revalidateTag`/
runtime-config usage — so this was a low-risk, mostly mechanical bump. The one
real casualty: `next lint` was removed in v16 and this app never had an ESLint
config to fall back to, so the now-broken `lint` script was removed from
`package.json` rather than left silently failing (a real ESLint setup is a
fast-follow if wanted).

A real, non-trivial snag along the way: `pnpm add next@latest react@latest
react-dom@latest --filter @sendlit/web` appeared to succeed (package.json
updated), but a subsequent unfiltered `pnpm install` left `apps/web`'s
`node_modules/next` symlink and `pnpm-lock.yaml` pointing at the *old* 15.x
resolution — `next build` kept reporting "Next.js 15.5.19" despite the
correct version in `package.json`. Re-running the same targeted
`pnpm --filter @sendlit/web add next@latest` fixed the lockfile/symlink
mismatch. Also had to delete the stale `apps/web/.next` directory — Next 16
changed the build output layout (`next dev` now writes to `.next/dev`,
separate from `next build`'s output), and a leftover 15.x-era `.next` caused a
confusing `<Html> should not be imported outside of pages/_document` error
unrelated to any actual code change.

Validated: `apps/web` builds clean under Turbopack (`▲ Next.js 16.2.9
(Turbopack)`, all 18 routes compiled) and typechecks clean, as do
`packages/email-blocks` and `packages/email-editor` (whose React 19 peer dep
now resolves without warnings). **Anyone with a `next dev` process already
running from before this upgrade needs to restart it** — it will otherwise
keep running the old, now-unlinked 15.x build.

Gap fix (post-Phase-5) — **done**: **ESP config moved from a top-level
contract group to a `settings` namespace**. ESP configuration is a per-team
*singleton setting* (get/upsert/remove/test — never a list, never more than
one per team), unlike Contacts/Templates/Sequences, which are true resource
collections (list, paginate, create many, delete individually). Sitting as
`contract.esp` alongside those made it look like a peer entity when it isn't
one. Fixed by nesting it under a new `contract.settings` group
(`contract.settings.esp`), which also gives a natural home for future
per-team settings (default sending identity, branding, webhook URLs, ...)
without forcing them into ESP's specific schema or a schema-less blob.
Route paths moved from `/esp-config`(`/test`) to `/settings/esp`(`/test`);
`apps/api/src/esp/` was renamed to `apps/api/src/settings/esp/`. Deliberately
**kept the underlying `esp_configs` Postgres table separate** rather than
folding it into a generic settings blob/table: it holds an encrypted secret
(the SMTP password), and an isolated table with narrow, explicitly-scoped
query functions (`getDecryptedEspCredentials` used only internally by mail
sending) is a stronger security boundary than a general "team settings" row
that a future bulk-read endpoint could too easily return unfiltered. MCP tool
names (`get_esp_config`, `update_esp_config`, ...) were left unchanged —
only their internal import paths moved — since renaming them wouldn't add
clarity for MCP/AI consumers. This was a breaking API change (route paths),
made safely pre-launch with no external consumers yet. Validated:
`packages/api-contract`, `apps/api` (`tsc --noEmit` + `pnpm run build`, which
regenerates the OpenAPI doc from the updated contract), and `apps/web`
(`tsc --noEmit` + `next build`) all compile clean.

Gap fix (post-Phase-5) — **done**: fixed a bug in `packages/email-editor`
(present verbatim in CourseLit's original source too, so pre-existing rather
than introduced by the port) where editing any block setting from the
`BlockSettingsPanel` sidebar caused the panel to go completely blank,
making further editing impossible. Root cause: `EmailEditor` is used as a
fully controlled component (`template-form.tsx` passes `email={value.content}`
from parent state, and `onChange` writes back into that same state), but its
`useEffect` on `initialEmail` unconditionally called `getEmailWithBlockIds`,
which assigns a **fresh random id to every block** on every render of that
effect — including when `initialEmail` was merely the parent echoing back
the editor's own last change as a new object reference. This silently
regenerated all block ids, which orphaned `selectedBlockId` (still pointing
at the old id), so `BlockSettingsPanel`'s `email.content.find((b) => b.id
=== blockId)` came up empty and the component returned `null`. Fixed by
adding a `lastEmittedRef` that records the last id-stripped email this
component itself emitted via `onChange`; the `initialEmail` effect now
skips resyncing (and thus skips regenerating ids) whenever the incoming
value is structurally identical to that last-emitted value, treating it as
an echo rather than a genuine external reset (e.g. navigating to a
different template, which nonetheless already gets a real remount via
Next.js's dynamic route segment). Validated: `packages/email-editor` and
`packages/email-blocks` typecheck and build clean, and `apps/web` typechecks
and builds clean under Turbopack.

Phase 6 — **not started, follow-up work**:
- [ ] Richer segmentation (signed-up date ranges, last-active) and team-wide
      analytics dashboards (open rate / CTR endpoints exist and are shown
      per-sequence, but there's no team-wide rollup view yet)
- [ ] Bounce handling / webhook ingestion from the SMTP/ESP provider (could
      layer on top of the per-team ESP config, e.g. per-provider webhook
      verification)
- [ ] Team member invitations (the `team_members` table already supports
      several accounts per team with a `role`; there's no invite-by-email flow
      yet, so every team currently has exactly one `owner` member)
- [ ] Native API-based sending (SendGrid/Mailgun/SES SDKs) as an alternative to
      SMTP, if a customer's provider doesn't expose an SMTP relay or higher
      throughput than SMTP allows is needed

## Environment variables (`apps/api`)

See `apps/api/.env.example`.
