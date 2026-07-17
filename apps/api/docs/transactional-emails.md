# PRD: Transactional Emails

_Status: proposed. Date: 2026-07-11. Scope: `apps/api` (schema, contract,
routes, mail pipeline, tracking), the generated REST docs and MCP server, and
a read-only log page in `apps/web`._

## Problem

SendLit can only send audience-based mail today: broadcasts and multi-step
sequences, both rows in the `sequences` table, fanned out to `contacts` that
match a filter and delivered through the `ongoing_sequences` → BullMQ pipeline
(`automation/process-ongoing-sequence.ts`). There is no way for an API consumer
(e.g. CourseLit sending a purchase receipt or password reset) to say "send
_this one message_ to _this one address_, right now".

The existing pipeline cannot be bent to this use case without breaking its own
invariants:

- Recipients must be subscribed `contacts` rows; transactional mail **must**
  reach unsubscribed addresses and addresses that aren't contacts at all.
- Every render injects an unsubscribe link and the CAN-SPAM mailing address —
  required for marketing mail, actively wrong for a password reset.
- Delivery is driven by a 60s due-poll over `ongoing_sequences`; transactional
  mail needs immediate, prioritized dispatch.
- `email_deliveries` / `email_events` carry `NOT NULL` FKs to `sequences` /
  `sequence_emails`, so a message with no parent sequence has nowhere to log.

## Industry context

Every reference platform keeps transactional sending structurally separate
from campaigns: SendGrid (dedicated Mail Send API), Mailchimp (a separate
product, Mandrill), Postmark (enforced "message streams": transactional vs
broadcast), Resend/Loops (`POST /emails` with template + variables). The
common shape is a **per-message resource** created by a direct API call —
not a campaign variant. Klaviyo's "transactional flows" solve event-triggered
messaging, which SendLit's `rules`/`fire-event` automation already covers; the
gap here is the direct send API.

**Decision: new structure.** A dedicated `transactional_emails` table and
contract, reusing the transport/queue/template/render plumbing but none of the
sequence machinery. Shoehorning a `type = 'transactional'` into `sequences`
would leave nearly every column (`filter`, `entrants`, `emailsOrder`,
`triggerType`, `report`, the status lifecycle) null or meaningless and require
suppression/footer bypasses threaded through the campaign send loop.

## Goals

1. `POST /emails`: send a single message to a single recipient, authenticated
   by team (API key or session), rendered from a stored template + variables
   or inline content, dispatched immediately.
2. Per-message status a caller can query
   (`queued | sent | failed | bounced | suppressed`),
   with a list endpoint backing both API consumers and the dashboard log page.
3. Idempotent sends: a caller retrying after a timeout must not double-send.
4. Retries with backoff on transient ESP failures (the current `mail` worker
   swallows errors — unacceptable for a password reset).
5. REST docs (ts-rest contract → OpenAPI) and MCP tools updated alongside, per
   repo convention.
6. A read-only **transactional log page** in the dashboard (`apps/web`): list
   with status filter + pagination, and a per-message detail view (see
   [Web UI](#web-ui-transactional-log-page)).

## Non-goals (v1)

- Batch send (multiple recipients per call). Callers loop; the campaign
  pipeline covers real fan-out.
- Attachments.
- A dedicated transactional sending domain/outbox per team (see
  [Future work](#future-work)).
- Inbound webhook ingestion of ESP bounce notifications (tracked separately;
  v1 records what the SMTP conversation itself surfaces).
- A compose/send UI. Transactional mail is API-triggered by definition (a
  human-composed one-off is a broadcast); the dashboard surface is a
  **read-only log**, matching Postmark/Resend's activity views.

## Data model

One new table, following the repo's ID convention (internal UUIDv7 `id`,
public `txe_...` handle, `publicIdCheck`):

```
transactional_emails
  id                uuid PK ($defaultFn genId)
  team_id           uuid NOT NULL FK -> teams.id ON DELETE CASCADE
  txe_id            text NOT NULL UNIQUE  -- genPublicId("txe"), CHECK '^txe_'
  to_email          text NOT NULL         -- API field stays `to`; "to"/"from" are
  from_email        text                  --   SQL keywords, so the columns get the
  reply_to          text                  --   _email suffix (resolved at enqueue)
  subject           text NOT NULL
  template_id       text                  -- public `tpl_` id, not a FK (see note)
  html              text                  -- rendered snapshot actually sent
  variables         jsonb NOT NULL DEFAULT {}   -- liquid merge payload
  headers           jsonb
  contact_id        uuid FK -> contacts.id ON DELETE SET NULL  -- analytics link only
  status            text NOT NULL DEFAULT 'queued'  -- queued | sent | failed | bounced | suppressed
  error             text
  idempotency_key   text
  track_opens       boolean NOT NULL DEFAULT false
  track_clicks      boolean NOT NULL DEFAULT false
  open_count        integer NOT NULL DEFAULT 0   -- only if tracking opted in
  click_count       integer NOT NULL DEFAULT 0
  sent_at           timestamptz
  created_at        timestamptz DEFAULT now()
  updated_at        timestamptz DEFAULT now()

  UNIQUE (team_id, idempotency_key)  -- partial, WHERE idempotency_key IS NOT NULL
  INDEX  (team_id, created_at)       -- list endpoint
  INDEX  (team_id, status)           -- filtering / ops queries
```

Notes:

- `contact_id` is populated opportunistically when `to` matches an existing
  contact (per team). It is **never** consulted for suppression — the
  `subscribed` flag does not apply to transactional mail.
- `html` stores the final rendered output (post-Liquid, pre-tracking-rewrite).
  This is the Postmark/Resend pattern: the log shows exactly what was sent,
  immune to later template edits. Content volume is one row per message (no
  fan-out multiplication), so storage is acceptable; revisit with a retention
  policy if volume demands it.
- `template_id` is plain `text` holding the public `tpl_` id, not a FK to
  `email_templates.id` — matching the existing convention on
  `sequence_emails.templateId` in this same schema. A join-free read is
  worth more than DB-enforced referential integrity here: every other public
  field this API returns (`contactId` excepted) is already a public id read
  straight off the row, and `html`/`subject` are snapshotted regardless, so a
  `templateId` left dangling after the source template is deleted is
  harmless — same as it already is for `sequence_emails` today.
- `track_opens`/`track_clicks` are persisted (not just request params) because
  the worker applies the tracking rewrites at send time from the row, and the
  detail UI shows whether counts are meaningful for a given message.
- No new event tables: opens/clicks land as counters on the row (see
  [Tracking](#tracking-opt-in-default-off)). If per-event granularity is
  needed later, a `transactional_email_events` table can be added without
  touching the campaign event tables.

## API surface

New `transactional.ts` in `packages/api-contract/src/schemas` + a
`transactional` router in `contract.ts`, so OpenAPI stays generated. Routes
live in a new `apps/api/src/transactional/` module (`routes.ts`, `queries.ts`)
mounted like the others in `index.ts`, behind `requireAuth` + `requireTeam`.
API keys are the primary consumer (server-to-server).

### `POST /emails` → `202 Accepted`

```jsonc
{
    "to": "jane@example.com", // required, single address
    "subject": "Your receipt", // required
    "templateId": "tpl_...", // exactly one of templateId | html
    "html": "<html>...</html>",
    "variables": { "order_id": "1234" }, // liquid payload for template rendering
    "replyTo": "support@acme.com", // optional
    "headers": { "X-Entity-Ref": "…" }, // optional
    "idempotencyKey": "order-1234-receipt", // optional but recommended
    "trackOpens": false, // optional, default false
    "trackClicks": false, // optional, default false
}
```

Response: `{ "txeId": "txe_...", "status": "queued" }`.

Validation / behavior:

- Exactly one of `templateId` / `html`. `subject` is always required in v1
  (template-level default subjects are future work).
- `variables` is only accepted with `templateId` (`400` alongside `html`).
  Inline `html` is sent **verbatim** — the caller has already interpolated it,
  and running Liquid over arbitrary caller HTML would corrupt legitimate
  `{{`/`{%` content. This matches Postmark/Resend: variables are a template
  feature.
- `to` is a single email address (see Non-goals).
- `headers`: names and values must not contain CR/LF (header injection), and
  headers the pipeline owns (`From`, `To`, `Subject`, `Content-Type`) are
  rejected with `400`.
- If `(teamId, idempotencyKey)` already exists, return the **existing** row as
  `202` with its current status — no new send (Stripe/Resend semantics).
  Must be race-safe: `INSERT ... ON CONFLICT DO NOTHING` + re-select on the
  unique index, not check-then-insert — two concurrent retries of the same
  key must yield one row and one enqueued job (the `jobId` dedupe is the
  second belt).
- `422` when the team has no user-managed ESP config (mirrors the campaign path's
  `MISSING_TEAM_ESP_ERROR`, but surfaced at request time instead of dying in
  the worker).
- `429` only when the per-team request rate limit is exceeded (see
  [Rate limiting](#rate-limiting)). User-managed ESP delivery does not consume
  SendLit account quota; quota is reserved for a future platform delivery
  route.

### `GET /emails/:txeId` → `200`

Full public row: `txeId`, `to`, `from`, `subject`, `status`, `error`,
`templateId` (public `tpl_` id), `trackOpens`/`trackClicks`,
`openCount`/`clickCount`, `sentAt`, `createdAt`, plus the rendered `html`
snapshot (detail only — the list omits it). Internal `id`/FKs omitted via `omitInternal`, dates via
`serializeDates`, as elsewhere.

### `GET /emails` → `200`

Paginated list (same `offset`/`itemsPerPage` + `paginated()` envelope
conventions as `contacts`/`sequences`), filterable by `status` and a
`createdAt` range. Backs the dashboard log page and operational debugging.

### Contract schemas

`packages/api-contract/src/schemas/transactional.ts`, mirroring the existing
schema files (status unions as `as const` arrays, dates serialized to strings,
`errorSchema`/`paginated` from `common.ts`):

```ts
import { z } from "zod";

export const transactionalEmailStatus = [
    "queued",
    "sent",
    "failed",
    "bounced",
] as const;

/** Public row shape — internal `id`/FK columns are omitted (`omitInternal`),
 * dates serialized via `serializeDates`, like every other resource schema.
 * `templateId` is the public `tpl_` id, read straight off the row (plain
 * text, not a FK — see the Data model note); null for inline-html sends. */
export const transactionalEmailSchema = z.object({
    txeId: z.string(),
    to: z.string(),
    from: z.string().nullable(),
    replyTo: z.string().nullable(),
    subject: z.string(),
    templateId: z.string().nullable(),
    variables: z.record(z.any()),
    status: z.enum(transactionalEmailStatus),
    error: z.string().nullable(),
    trackOpens: z.boolean(),
    trackClicks: z.boolean(),
    openCount: z.number(),
    clickCount: z.number(),
    sentAt: z.string().nullable(),
    createdAt: z.string().nullable(),
    updatedAt: z.string().nullable(),
});

/** `get` additionally returns the rendered snapshot; the list omits it to
 * keep pages light. */
export const transactionalEmailDetailSchema = transactionalEmailSchema.extend({
    html: z.string().nullable(),
});

export const sendEmailBodySchema = z
    .object({
        to: z.string().email(),
        subject: z.string().min(1),
        templateId: z.string().min(1).optional(),
        html: z.string().min(1).optional(),
        variables: z.record(z.any()).optional(),
        replyTo: z.string().email().optional(),
        headers: z.record(z.string()).optional(),
        idempotencyKey: z.string().min(1).max(256).optional(),
        trackOpens: z.boolean().optional(),
        trackClicks: z.boolean().optional(),
    })
    .refine((body) => !!body.templateId !== !!body.html, {
        message: "Provide exactly one of templateId or html",
    })
    .refine((body) => !(body.html && body.variables), {
        message: "variables requires templateId; inline html is sent verbatim",
    });

/** 202 body — deliberately minimal (Resend-style); poll `get` for status. */
export const sendEmailResponseSchema = transactionalEmailSchema.pick({
    txeId: true,
    status: true,
});

export const listTransactionalEmailsQuerySchema = z.object({
    status: z.enum(transactionalEmailStatus).optional(),
    createdAfter: z.coerce
        .number()
        .int()
        .optional()
        .describe("Millisecond timestamp lower bound (inclusive)"),
    createdBefore: z.coerce
        .number()
        .int()
        .optional()
        .describe("Millisecond timestamp upper bound (exclusive)"),
    offset: z.coerce.number().int().min(1).optional(),
    itemsPerPage: z.coerce.number().int().min(1).optional(),
});
```

And the router in `contract.ts`, tagged for the OpenAPI docs like the others:

```ts
const transactionalContract = c.router(
    {
        send: {
            method: "POST",
            path: "/emails",
            body: sendEmailBodySchema,
            responses: {
                202: sendEmailResponseSchema,
                400: errorSchema, // validation or template/render failure
                422: errorSchema, // team has no user ESP configured
            },
            summary: "Send a transactional email",
        },
        get: {
            method: "GET",
            path: "/emails/:txeId",
            responses: {
                200: transactionalEmailDetailSchema,
                404: errorSchema,
            },
            summary: "Get a transactional email",
        },
        list: {
            method: "GET",
            path: "/emails",
            query: listTransactionalEmailsQuerySchema,
            responses: { 200: paginated(transactionalEmailSchema) },
            summary: "List transactional emails",
        },
    },
    { metadata: { tag: "Transactional Emails" } },
);

export const contract = c.router({
    // ...existing routers...
    transactional: transactionalContract,
});
```

The Drizzle table definition follows the [Data model](#data-model) column list
directly (no separate sketch needed — `db/schema.ts` conventions: `genId`,
`genPublicId("txe")`, `publicIdCheck`).

## Send pipeline

```
POST /emails
  └─ validate → resolve and pin user ESP → render → insert row (queued) → enqueue
                                                 BullMQ "mail" queue
                                                 priority: 1, attempts: 3,
                                                 exponential backoff
  worker (mail/worker.ts)
  └─ load row → apply tracking rewrites (if opted in) → sendMail()
       ├─ success → status='sent', sent_at=now()
       ├─ permanent SMTP rejection (5xx) → status='bounced' (no retry)
       └─ transient failure → retry w/ backoff; attempts exhausted →
          status='failed', error=<message>
```

Before transport submission the worker atomically acquires a ten-minute
database lease on the still-`queued` row. The lease prevents concurrent BullMQ
workers from submitting the same message while allowing a later worker to
recover a claim left by a dead process. Transient failures and terminal
transitions clear the lease. The campaign delivery worker uses the same lease
pattern on `ongoing_sequences`.

Details:

1. **Render at request time, not in the worker.** For template sends, the
   route resolves `email_templates.content` → `renderEmailToHtml` (from
   `@sendlit/email-editor`) and runs the Liquid merge with the caller's
   `variables` as the entire merge context — **no unsubscribe link, no
   mailing-address footer, no subscriber payload**. Inline `html` is stored
   as-is (no Liquid; see Validation). Rendering up front means template/merge
   errors return `400` synchronously instead of failing invisibly in a
   worker, and the stored `html` snapshot falls out for free.

    The Liquid+render step in `process-ongoing-sequence.ts` should be extracted
    into a shared helper (e.g. `mail/render.ts`) rather than duplicated; the
    campaign path keeps its footer injection as its own wrapper around it. The
    pixel-append and `transformLinksForClickTracking` rewrites in the same
    file get the same treatment (shared helper, parameterized by token
    payload) since the transactional worker needs them too.

2. **Reuse the `mail` BullMQ queue and transport** (`mail/queue.ts`,
   `mail/transport.ts`, `mail/send.ts`) — but transactional jobs are added
   under a distinct job name (`"transactional"` vs the campaign path's
   `"mail"`) with options the campaign path doesn't use today:
    - `priority: 1` so they jump ahead of broadcast fan-out sharing the queue;
    - `attempts: 3` with exponential `backoff` (e.g. base 30s);
    - `jobId: <transactional_emails.id>` as dedupe belt-and-braces on top of
      the idempotency key.

    The job payload is just `{ transactionalEmailId }` — the worker loads the
    row for `html`/`from`/`to` (single source of truth, no fat Redis
    payloads), applies the tracking rewrites when `track_opens`/`track_clicks`
    are set (the snapshot stays pre-rewrite), and sends.

    Failure handling in the worker, branched by job name: campaign jobs keep
    the current catch-and-swallow (the sequence layer owns their retries).
    Transactional jobs classify the error — a permanent SMTP rejection
    (`err.responseCode` 5xx from nodemailer) marks the row `bounced` and
    throws BullMQ's `UnrecoverableError` so no retry burns on a dead address;
    anything else rethrows so retry/backoff applies, and the final attempt
    (`job.attemptsMade + 1 >= job.opts.attempts`) marks the row `failed`.

3. **Quota**: user-managed ESPs bypass SendLit account quota and do not
   increment its counters. A future platform delivery route will own quota
   enforcement; its provider configuration is deployment-level, not stored in
   `esp_configs`.

4. **Dev behavior**: `sendMail` validates the pinned ESP in every environment,
   then only performs real delivery when `NODE_ENV === "production"` (it logs
   otherwise). `sendTestMail` remains the "really send it" escape hatch for
   ESP verification.

5. **Sender identity**: same fallback chain as `attemptMailSending` — the
   team's `esp_configs.fromName/fromEmail` → team name / owner account
   email — resolved at enqueue time and stored in `from`. v1 does not accept
   a caller-supplied `from` address (spoofing risk); revisit alongside
   sender-identity verification.

## Rate limiting

Three layers, answering different questions:

1. **Volume quota — future platform delivery only.** The account-level
   `dailyMailLimit`/`monthlyMailLimit` counters are retained for SendLit-hosted
   delivery. User-managed ESP sends do not check or increment them.

2. **Request rate limit — "how fast may this caller hit the endpoint?"
   (new).** Reuse `express-rate-limit` as `mcp/routes.ts` and
   `provisioning/routes.ts` already do, but keyed by **team**
   (`keyGenerator: req => req.teamId`, mounted after `requireTeam`) rather
   than IP — the typical consumer is one server (e.g. CourseLit) sending on
   behalf of many teams from a single IP, so IP keying would let one tenant
   exhaust another's allowance. Defaults: ~120 req/min per team on
   `POST /emails` (in line with Resend's ~2 rps), looser on the GETs.
   `standardHeaders: true` so callers get `RateLimit-Remaining`/
   `RateLimit-Reset` and a `Retry-After` on `429`. Caveat: the default store
   is per-process memory — fine for the current single-instance deployment;
   horizontal scaling requires swapping in a Redis store (Redis already backs
   BullMQ).

3. **Dispatch throughput — "how fast do we hand mail to the ESP?"
   (deliberately none in v1).** Each team brings its own SMTP config, so
   there is no shared upstream to protect. ESP-side throttling surfaces as
   transient SMTP errors, absorbed by the transactional path's
   `attempts`/backoff. A per-team BullMQ limiter is impractical (group rate
   limits are BullMQ Pro), and a global `limiter` on the shared `mail` worker
   would let one team's broadcast fan-out starve another team's password
   resets — cross-team fairness is handled by job `priority` instead.

## Tracking (opt-in, default off)

Open pixels and rewritten links inside receipts and password resets are a
trust smell, so both default **off** (Postmark's convention), enabled per
message via `trackOpens`/`trackClicks`.

When enabled, the worker applies the rewrites at send time (pixel appended to
the html, links rewritten via the shared click-tracking helper), reusing
`generatePixelToken`/`verifyPixelToken` (`utils/pixel-jwt.ts`) with a
discriminated payload — `{ type: "txe", txeId }` (plus `index`/`link` for
clicks) alongside the existing `{ contactId, sequenceId, emailId }` shape.
`tracking/routes.ts` branches on `type`: transactional tokens increment
`open_count`/`click_count` on the `transactional_emails` row instead of
inserting `email_events`. Campaign tokens (no `type` field) behave exactly as
today, so tokens already embedded in delivered mail keep working.

## Web UI: transactional log page

A read-only activity log in the dashboard (Postmark's "Activity" / Resend's
"Emails" equivalent) — no compose UI (see Non-goals).

- **Route**: `apps/web/app/dashboard/transactional/page.tsx`, sidebar entry
  "Transactional" in `components/dashboard/app-sidebar.tsx` alongside
  Broadcasts/Sequences.
- **List**: table of `to`, `subject`, `status` (badge), `sentAt`/`createdAt`,
  with a status filter and the same pagination pattern as the contacts/
  sequences pages. Data via new thin wrappers in `lib/api.ts` over the typed
  ts-rest client (`client.transactional.list/get`) — the contract addition
  makes these fall out typed for free.
- **Detail**: `app/dashboard/transactional/[txeId]/page.tsx` (same pattern as
  `contacts/[contactId]`): full metadata — `txeId`, `from`/`replyTo`,
  `templateId`, `status` + `error`, open/click counts when tracking was
  enabled, `variables` — plus a preview of the rendered `html` snapshot in a
  sandboxed `<iframe srcDoc>` (never injected into the page DOM: the snapshot
  contains caller-supplied content).
- **Components**: shadcn/ui exclusively, per repo convention (Table, Badge,
  Select for the status filter).

## Suppression and bounces

- **Unsubscribes never suppress transactional mail.** This is the defining
  compliance difference from the campaign path and must hold even when
  `contact_id` is linked.
- Hard bounces surfaced by the SMTP conversation mark the row
  `status='bounced'` with `error` populated. A team-level hard-bounce
  suppression list (shared with campaigns) is future work — v1 records
  bounces but does not yet block repeat sends to a bounced address.

## Docs & MCP (repo convention)

- **OpenAPI**: falls out of the new contract router; add the
  `Transactional Emails` tag via router `metadata` like the other contracts.
- **MCP**: new `mcp/tools/transactional.ts` registering `send_email`,
  `get_email`, `list_emails`, wired into `mcp/server.ts` alongside the
  existing tool modules.

## Implementation plan

1. **Schema + migration**: `transactional_emails` in `db/schema.ts`, drizzle
   migration, `txe` prefix following the public-id conventions.
2. **Shared render + tracking helpers**: extract Liquid+`renderEmailToHtml`,
   the pixel-append, and `transformLinksForClickTracking` from
   `process-ongoing-sequence.ts` into `mail/render.ts` (token payload
   parameterized); the campaign path keeps footer injection as its wrapper.
   (Pure refactor; existing tests must stay green.)
3. **Contract**: `packages/api-contract/src/schemas/transactional.ts`, wired
   into `contract.ts`.
4. **Routes + queries**: `src/transactional/{routes,queries}.ts`, mounted in
   `index.ts`; team-keyed `express-rate-limit`, idempotency, validation,
   user-ESP pinning, render, insert, enqueue.
5. **Worker changes**: `"transactional"` job handling in `mail/worker.ts`
   (load row, tracking rewrites, status updates, 5xx→`bounced` via
   `UnrecoverableError`, rethrow-for-retry, and `failed` on the last attempt);
   priority/attempts/backoff options at enqueue.
6. **Tracking**: discriminated pixel token + branch in `tracking/routes.ts`.
7. **MCP tools + OpenAPI tag.**
8. **Web UI**: `lib/api.ts` wrappers, sidebar entry, list page, `[txeId]`
   detail page with sandboxed HTML preview.
9. **Tests**: queries + route tests following `sequences/queries.test.ts` /
   `mcp/routes.test.ts` patterns; worker retry behavior (transient → retry →
   `failed`; 5xx → `bounced` with no retry); idempotency replay (concurrent
   duplicate requests yield one row); delivery to an unsubscribed contact's
   address (the invariant most worth pinning); `variables`-with-`html`
   rejection.

## Future work

- Per-team **transactional outbox** (dedicated `esp_configs` row / sending
  subdomain — Postmark-style stream separation). The table should gain a
  nullable `outbox_id` like `sequences.outboxId` once `esp_configs` drops its
  one-row-per-team uniqueness.
- Batch endpoint (`POST /emails/batch`) if callers need fan-out without the
  campaign machinery.
- Hard-bounce suppression list shared with the campaign path.
- ESP bounce/complaint webhook ingestion updating `status`.
- Template-level default subjects; caller-supplied verified `from` addresses.
- Retention policy for `html` snapshots.
- Redis-backed store for the request rate limiter once the API runs more than
  one instance.
