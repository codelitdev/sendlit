# SendLit ID/Schema Refactor — Handoff Plan

This document is a complete, self-contained handoff for finishing an in-progress
schema refactor in `apps/api`. It assumes **no prior context** — read this
fully before touching code. It is safe to be aggressive: **this project is in
early development, there is no production data, and the dev database can be
dropped and recreated freely.** Do not preserve backward compatibility for its
own sake — prioritize getting the schema right.

## Background: the `id` / `<domain>_id` convention

Every table in `apps/api/src/db/schema.ts` follows this convention (already
documented in a comment at the top of that file):

- **`id`** — an internal-only surrogate primary key, generated as a **UUIDv7**
  via `genId()` (`apps/api/src/db/id.ts`). UUIDv7 keeps inserts roughly
  time-ordered (unlike UUIDv4/`gen_random_uuid()`, which scatters inserts
  randomly across the B-tree and hurts index locality at scale). `id` is
  **never** returned by any REST/MCP response, and — per the task this
  document hands off — should be the target of **every foreign key**.
- **`<domain>_id`** (e.g. `contact_id`, `sequence_id`, `template_id`,
  `segment_id`, `rule_id`, `email_id`, `team_id` on the `teams` table itself)
  — the public-facing identifier: `<prefix>_<24 random alphanumeric chars>`,
  generated via `genPublicId(prefix)` (same file). This is the **only**
  identifier ever exposed to REST/MCP API consumers, and the only one ever
  accepted back from them in a URL/param/body to address a row.

This mirrors Stripe/Shopify-style opaque, prefixed public IDs, decoupled from
the internal storage key.

**Response stripping:** `apps/api/src/utils/public.ts` exports
`omitInternal(row, extraKeys?)`, which deletes `id` and `teamId` from a row
before it's serialized into a REST/MCP response (ts-rest and the MCP SDK do
**not** validate/strip response bodies against their declared zod schemas at
runtime — schemas are compile-time-only unless you explicitly call
`.parse()` or a stripping helper, so every route/tool handler must funnel its
response through `omitInternal` or an equivalent explicit mapper).

**Important footgun already hit once:** `Array.prototype.map(omitInternal)`
is wrong — `.map` calls its callback as `(item, index, array)`, and `index`
(a number) overwrites `omitInternal`'s second parameter (`extraKeys`, expected
to be an array), throwing `TypeError: extraKeys is not iterable`. Always wrap:
`items.map((item) => omitInternal(item))`.

## What's already done (do not redo)

- `apps/api/src/db/id.ts` — `genId()` (uuidv7) and `genPublicId(prefix)` (nanoid-based).
- Every table's `id` column uses `.$defaultFn(genId)` instead of `.defaultRandom()`.
- `contacts.contactId`, `sequences.sequenceId`, `emailTemplates.templateId`,
  `segments.segmentId`, `rules.ruleId`, `sequenceEmails.emailId` are all `text`
  columns with `.$defaultFn(() => genPublicId(prefix))` defaults (`cnt_`,
  `seq_`, `tpl_`, `seg_`, `rule_`, `email_` respectively).
- `teams.teamId` (db column `team_id`) has been added as a `text` public-id
  column (`team_` prefix) — **but the rest of the "teams split" is not done**
  (see Task B below). `teams.id` remains the internal PK.
- `utils/public.ts#omitInternal()` exists and is applied throughout
  contacts/sequences/templates/segments REST routes (`apps/api/src/{contacts,sequences,templates,contacts/segments}-routes.ts`)
  and MCP tools (`apps/api/src/mcp/tools/{contacts,sequences,templates,segments}.ts`).
  `sequences/routes.ts` and `mcp/tools/sequences.ts` additionally strip the
  nested `sequence_emails.sequenceId` field (see Task A — this field currently
  holds the _parent_ sequence's internal id, which is why it's stripped rather
  than exposed).
- `packages/api-contract` schemas (`contacts.ts`, `sequences.ts`, `templates.ts`,
  `segments.ts`) have had `id`/`teamId` dropped, and `sequenceEmailSchema` has
  had `id`/`sequenceId` dropped (same reason). `contactSchema.contactId` is a
  plain `z.string()` (no longer `.uuid()`, since it's not UUID-shaped anymore).
  Mirrored in `apps/api/src/mcp/tools/schemas.ts`.
- Manual ID generation removed from `createContact`, `createSegment`,
  `createSequence`, `addMailToSequence`, `addRule`, `createTemplate` (schema
  defaults now handle it).
- `CHECK` constraints (`publicIdCheck()` helper in `schema.ts`) added for:
  `teams.teamId`, `contacts.contactId`, `emailTemplates.templateId`,
  `segments.segmentId`. **Still missing** for `sequences.sequenceId`,
  `sequenceEmails.emailId`, `rules.ruleId` — see Task C.
- `apps/web` (the dashboard frontend) already exclusively uses `.contactId`,
  `.sequenceId`, `.templateId`, `.segmentId` (never `.id`) for these four
  resources, so no frontend changes were needed for them. **`apps/web` does
  use `team.id` extensively** — that's Task B's problem.
- A migration (`apps/api/drizzle/0000_init.sql`) reflecting the above was
  generated and applied to the dev DB via a drop-schema-and-recreate script
  (see "Migration & DB reset procedure" below for the exact recipe — the
  throwaway script itself was deleted after use, recreate it the same way).

## The three remaining tasks

Do them in this order — A is the big one and the reason for this handoff; B
and C are smaller, independent, pre-existing loose ends.

---

### Task A (primary): Normalize FK relationships to reference internal `id`, with cascade deletes

**Goal:** every foreign key in the schema should reference the target table's
internal `id` (uuid), not a public `<domain>_id` (text). Add real FK
constraints with explicit `ON DELETE CASCADE` where it makes sense. Don't
worry about how many query-layer files this touches — correctness and a
clean, normalized schema come first.

#### Current state (the problem)

Four tables currently store the **public** id of the row they reference,
as loosely-typed `text` columns with **no FK constraint at all**:

| Table                         | Column        | Currently stores                                                   | Should become                                                                                       |
| ----------------------------- | ------------- | ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| `ongoing_sequences`           | `sequence_id` | `sequences.sequenceId` (public, text)                              | `uuid` FK → `sequences.id`, `ON DELETE CASCADE`                                                     |
| `ongoing_sequences`           | `contact_id`  | `contacts.contactId` (public, text)                                | `uuid` FK → `contacts.id`, `ON DELETE CASCADE`                                                      |
| `email_deliveries`            | `sequence_id` | `sequences.sequenceId`                                             | `uuid` FK → `sequences.id`, `ON DELETE CASCADE`                                                     |
| `email_deliveries`            | `contact_id`  | `contacts.contactId`                                               | `uuid` FK → `contacts.id`, `ON DELETE CASCADE`                                                      |
| `email_deliveries`            | `email_id`    | `sequence_emails.emailId` (public, text)                           | `uuid` FK → `sequence_emails.id`, `ON DELETE CASCADE`                                               |
| `email_events`                | `sequence_id` | `sequences.sequenceId`                                             | `uuid` FK → `sequences.id`, `ON DELETE CASCADE`                                                     |
| `email_events`                | `contact_id`  | `contacts.contactId`                                               | `uuid` FK → `contacts.id`, `ON DELETE CASCADE`                                                      |
| `email_events`                | `email_id`    | `sequence_emails.emailId`                                          | `uuid` FK → `sequence_emails.id`, `ON DELETE CASCADE`                                               |
| `rules`                       | `sequence_id` | `sequences.sequenceId`                                             | `uuid` FK → `sequences.id`, `ON DELETE CASCADE`                                                     |
| `contact_custom_field_values` | `contact_id`  | `contacts.contactId` (already has an FK, just to the wrong column) | change FK target to `contacts.id` (still `ON DELETE CASCADE`) — column type changes `text` → `uuid` |

**Explicit exception — do NOT change this one:** `sequence_emails.templateId`
is a loose `text` reference to `email_templates.templateId`, and must **stay**
a loose reference (no FK). It can point at a _system template_
(`apps/api/src/templates/system-templates.ts`) that only exists in code, never
in the `email_templates` table — a hard FK would break that. Leave as-is.

**Also out of scope for this task** (don't touch unless you have a strong
reason to): `sequences.entrants` (`text[]`, a point-in-time snapshot of a
broadcast's audience, not a live relationship) and `ongoing_sequences.sentEmailIds`
(`text[]` of public `emailId`s, used as a fast in-row "already sent" set —
normalizing this into its own join table is a legitimate alternative if you
want full 3NF, but it's not required to satisfy "FKs reference internal ids").

#### Why this wasn't done originally (context, not a blocker)

These four tables are written from code paths that only ever have the
**public** id in hand:

- **Tracking pixels/links**: when an email is sent, `contactId`/`sequenceId`/
  `emailId` (all public) are signed into a JWT embedded directly in the
  outgoing email's open-tracking pixel URL and click-tracking redirect URLs
  (`apps/api/src/utils/pixel-jwt.ts`, used from
  `automation/process-ongoing-sequence.ts`'s `attemptMailSending`). Days/weeks
  later, `apps/api/src/tracking/routes.ts` decodes that JWT and inserts an
  `email_events` row — it has no sequence/contact/email row loaded at that
  point, only the public ids from the token.
- **Rule processing/enrollment**: `automation/fire-event.ts` and
  `automation/process-rules.ts` call `enrollContactsInOngoingSequence`
  (`automation/queries.ts`) with public ids obtained from `getMatchingContactIds`
  and `rules.sequenceId`.

Switching to internal-id FKs means every one of these write paths needs to
**resolve public → internal id first** (an extra `SELECT`), including on the
open/click tracking path, which is the highest-volume write path in the
system. This is an accepted, deliberate tradeoff for this task — just be
aware of it; consider batching/caching later if it becomes a real bottleneck,
but don't over-engineer that now.

#### Concrete schema changes (`apps/api/src/db/schema.ts`)

For each of the 9 columns in the table above:

1. Change the Drizzle column type from `text(...)` to
   `uuid(...).references(() => <targetTable>.id, { onDelete: "cascade" })`.
2. Remove the now-inapplicable file comment that says these tables
   "intentionally store the public id" (in the schema.ts file-level doc
   comment and on the `ongoingSequences`/`emailDeliveries`/`emailEvents`
   table doc comments) — replace with a note that they now reference internal
   ids like everything else, once this is done consistently.
3. Existing unique indexes on these columns (e.g.
   `ongoing_sequences_sequence_id_contact_id_idx`) keep working unchanged —
   only the column type changes, not the index definition.

#### Query-layer fallout (this is the bulk of the actual work)

Go function-by-function. For each, decide: does it need a new "resolve public
id → internal id" step, or can it keep its existing public-id parameter and
resolve internally (via a join), keeping its external signature/behavior
unchanged for its callers? Prefer the latter where the function is only ever
called with a public id from a route/tool handler — it minimizes ripple into
routes/mcp tools and test callers. Prefer accepting the internal id directly
where the caller already has the row loaded (avoids a redundant lookup).

**`apps/api/src/contacts/queries.ts`**

- Add `getContactById(id: string): Promise<Contact | null>` (internal-id
  lookup — analogous to the existing `getContactByContactId`, needed by
  `process-ongoing-sequence.ts` and `tracking/routes.ts` below).
- `getDeliveriesByContact(teamId, contactId)`: currently joins
  `emailDeliveries` ↔ `sequences` via `eq(sequences.sequenceId, emailDeliveries.sequenceId)`
  (public-to-public) and filters `eq(emailDeliveries.contactId, contactId)`
  (public). Once `emailDeliveries.sequenceId`/`contactId` are internal-id FKs,
  this needs `eq(sequences.id, emailDeliveries.sequenceId)` and the caller
  (contacts route/mcp tool, which already has the `Contact` row from
  `getContactByContactId`) should pass `contact.id` instead of
  `contact.contactId`. Update its call sites in `contacts/routes.ts` and
  `mcp/tools/contacts.ts` (`deliveries`/no direct MCP tool currently, check).

**`apps/api/src/sequences/queries.ts`**

- `getEmailSentCount`, `getSubscribers`, `getSubscribersCount`,
  `getSequenceOpenRate`, `getSequenceClickThroughRate`,
  `countDistinctContactsWithEvent` — all currently take the **public**
  `sequenceId` and filter `emailDeliveries`/`emailEvents` directly by it.
  Recommended approach: keep their external signature (public `sequenceId`
  string param) but resolve to internal id via a join through `sequences`
  inside the function, so callers (routes, mcp tools) don't need to change.
- **Important correctness requirement:** `getSubscribers` and
  `getSubscribersCount` currently `selectDistinct({ contactId: emailDeliveries.contactId })`
  and return/count those values directly — these are surfaced to API/MCP
  consumers as a list of "contact IDs" (REST `GET /sequences/:sequenceId/subscribers`,
  MCP `get_sequence_subscribers`). Once `emailDeliveries.contactId` is the
  **internal** `contacts.id`, returning it directly would leak an internal id
  to API consumers — the exact bug this whole refactor exists to prevent!
  You must join through `contacts` and return `contacts.contactId` (public)
  instead. Check `sequences/routes.ts`'s `subscribers` handler and
  `mcp/tools/sequences.ts`'s `get_sequence_subscribers` tool after this change.

**`apps/api/src/automation/queries.ts`**

- `enrollContactsInOngoingSequence({ teamId, sequenceId, contactIds })`:
  change to accept the **internal** sequence id and internal contact ids
  (rename params or document clearly which id kind is expected). Update both
  call sites (`fire-event.ts`, `process-rules.ts`) below.
- `getMatchingContactIds(teamId, filter)`: currently returns
  `contacts.contactId` (public). Since its only consumer
  (`enrollContactsInOngoingSequence` via the two call sites below) will now
  need internal ids, change this to select `contacts.id` instead (or return
  both — your call, but don't leave a function returning public ids that's
  only ever immediately used to look up/insert internal ones).
- `countOngoingSequencesForSequence(sequenceId)`: caller
  (`process-ongoing-sequence.ts#cleanUpResources`) already has
  `ongoingSequence.sequenceId`, which will now itself be an internal id after
  this refactor — no signature change needed here, just confirm the value
  flowing in is now internal.
- `getDueOngoingSequences()`, `deleteOngoingSequence(id)`: unaffected (operate
  on `ongoing_sequences.id`, always internal).
- `getSequenceRowById`/`getSequenceRowBySequenceId`: no change needed, both
  already exist for internal/public lookup respectively — just make sure the
  right one is used at each call site after this refactor.

**`apps/api/src/automation/fire-event.ts`**

- Already loads `sequenceRow` with `{ id: sequences.id, status }` — just
  change the `enrollContactsInOngoingSequence` call to pass
  `sequenceId: sequenceRow.id` (internal) instead of `rule.sequenceId`
  (public/currently-stored-as-internal-after-Task-A — see next bullet), and
  `contactIds: [contactId]` needs to become the contact's **internal** id —
  `fireEvent`'s own `contactId` param currently comes from
  `contacts/queries.ts` call sites (`createContact`, `addTagToContact`,
  `removeTagFromContact`) passing the **public** `contact.contactId`. Decide
  whether to change `fireEvent`'s param to accept the internal id (requires
  updating those 3 call sites in `contacts/queries.ts` to pass `contact.id`)
  or resolve internally inside `fireEvent`. Prefer changing the 3 call sites —
  they already have the full `Contact` row in scope.
- Since `rules.sequenceId` becomes an internal-id FK (Task A), the
  `eq(sequences.sequenceId, rule.sequenceId)` lookup a few lines up must
  become `eq(sequences.id, rule.sequenceId)`.

**`apps/api/src/automation/process-rules.ts`**

- `processRule`'s `rule.sequenceId` is now internal — replace the
  `getSequenceRowBySequenceId(rule.teamId, rule.sequenceId)` call with
  `getSequenceRowById(rule.sequenceId)` (already exists, ignores teamId — fine
  since `rule.teamId` was only ever used for the public-id lookup's WHERE
  clause).
- `enrollContactsInOngoingSequence({ sequenceId: sequenceRow.sequenceId, ... })`
  → change to `sequenceRow.id`.
- `getMatchingContactIds` return value now internal ids (see above) — flows
  straight through to `enrollContactsInOngoingSequence`'s `contactIds`, no
  extra change needed here.
- `lockBroadcast(sequenceRow.id, contactIds)` — already uses `.id`; decide
  whether `sequences.entrants` should store internal or public contact ids
  (it's a snapshot/report field, not a live FK — public ids are probably more
  useful there since `entrants` isn't cascaded/joined anywhere; if
  `getMatchingContactIds` now only returns internal ids, either add a second
  query for public ids or keep both in the return value).

**`apps/api/src/automation/process-ongoing-sequence.ts`**

- `getSequenceRowBySequenceId(ongoingSequence.teamId, ongoingSequence.sequenceId)`
  → `getSequenceRowById(ongoingSequence.sequenceId)` (now internal).
- `getContactByContactId(ongoingSequence.contactId)` → new
  `getContactById(ongoingSequence.contactId)` (now internal — add this
  function per the contacts/queries.ts note above).
- `attemptMailSending`'s `emailDeliveries` insert currently uses
  `sequence.sequenceId`/`contact.contactId`/`email.emailId` (all public) —
  change to `sequence.id`/`contact.id`/`email.id` (internal), since those
  columns are now uuid FKs.
- **Do NOT change** the `generatePixelToken({ contactId: contact.contactId, sequenceId: ongoingSequence.sequenceId, emailId: email.emailId })`
  call or `transformLinksForClickTracking(..., contact.contactId, ongoingSequence.sequenceId, email.emailId)`
  — these embed ids into the outgoing email and **must** stay public ids,
  since the tracking endpoint (below) only has the decoded token to work
  with, days later, with no other context. `ongoingSequence.sequenceId` here
  is confusingly named — after Task A it holds the _internal_ sequence id at
  the DB layer, but the pixel token needs the **public** one, so this call
  site needs the actual `sequence.sequenceId` (public, from the `sequence`
  row already in scope as the `sequence` param) — **audit this carefully**,
  it's an easy place to accidentally leak an internal id into a public URL.
- Error logging (`logger.error({ sequence_id: sequence.sequenceId, contactId: contact.contactId, ... })`)
  should keep logging the **public** ids for operator readability — those
  fields are independent local variables already in scope, unaffected by the
  DB column changes.

**`apps/api/src/tracking/routes.ts`** (the highest-risk, highest-value file to get right)

- `/track/open` and `/track/click` both decode a JWT payload
  `{ contactId, sequenceId, emailId, ... }` (all public — from the email) and
  currently insert directly into `emailEvents` using those public values.
  Once `email_events.sequence_id`/`contact_id`/`email_id` are internal-id FKs,
  both handlers must resolve, in order:
    1. `contact = getContactByContactId(payload.contactId)` → need `contact.id`
       and `contact.teamId` (already fetched via `findTeamIdForContact`, which
       can likely be replaced/merged with this lookup — check for duplicate
       queries).
    2. `sequence = getSequenceRowBySequenceId(contact.teamId, payload.sequenceId)`
       → need `sequence.id`.
    3. Look up the `sequence_emails` row by `(sequence.id, payload.emailId)` to
       get its `id` — there may not be an existing query for this; check
       `sequences/queries.ts` for a reusable one or add
       `getSequenceEmailByEmailId(sequenceId: string, emailId: string)`.
    4. Insert `emailEvents` with the three resolved internal ids.
    - If any lookup fails (contact/sequence/email deleted since send), fail
      soft (log and return) exactly as the existing `try/catch` around the
      insert already does — don't newly throw/500 on tracking pixel requests.

**Test fixtures and tests** — expect breakage across most of these, fix by
updating the fixture/test to pass internal ids where the schema now expects
them:

- `apps/api/src/test/fixtures.ts` — `seedOngoingSequence`'s `values.sequenceId`/
  `values.contactId` params: currently documented/typed as arbitrary strings;
  once real FK constraints exist, these **must** be real `sequences.id`/
  `contacts.id` values (or the insert will fail on the FK constraint, not just
  the format check) — audit every call site.
- `apps/api/src/automation/*.test.ts` (`fire-event.test.ts`,
  `process-ongoing-sequence.test.ts`, `process-ongoing-sequences.test.ts`,
  `queries.test.ts`) — many directly `db.insert(ongoingSequences).values({ sequenceId: "seq-1", contactId: crypto.randomUUID(), ... })`
  with fake/unrelated ids (no FK existed before, so this worked). These will
  now fail FK constraint violations — each needs a real seeded
  `sequences`/`contacts` row to reference, or the test's intent needs
  reconsidering (e.g. "contact no longer exists" tests should keep using a
  syntactically-plausible-but-nonexistent uuid as `contactId`/`sequenceId` —
  that's fine, FK constraints will still reject it before the row is even
  inserted, unless the test's whole point is that the _ongoing_sequences_ row
  exists but its target is gone, which a hard `ON DELETE CASCADE` FK makes
  structurally impossible to set up directly — you may need `ON DELETE SET NULL`
  is not an option since the column is guaranteed non-null elsewhere... work
  through this specific test — "it cleans up the row when the contact no
  longer exists" — by deleting the seeded contact _after_ inserting the
  ongoing_sequences row (which will itself now cascade-delete the row, so the
  test's premise changes: cascade delete means there's nothing left for
  `processOngoingSequence` to "clean up" — you may need to rewrite this test's
  intent entirely, e.g. to assert the cascade happened instead of asserting
  app-level cleanup logic ran).
- `apps/api/src/contacts/queries.test.ts`, `apps/api/src/sequences/queries.test.ts` —
  check `getDeliveriesByContact`/subscribers/stats tests for internal-vs-public
  id expectations after the join changes above.

---

### Task B: Finish the `teams.teamId` split

The `teams.teamId` (public) column was added to the schema, but nothing else
was updated to use it — `teams.id` (internal) is still what flows through
auth middleware, route params, the `X-Sendlit-Team-Id` header, provisioning
responses, and the web dashboard.

**Design already agreed:** `req.teamId` (set by auth middleware) stays the
**internal** `teams.id` everywhere — it's the tenant-scoping value threaded
through every other table's `team_id` FK, and changing that would be a much
bigger, unnecessary ripple. Only the **outermost edges** need to speak the
public `teamId`:

1. **`apps/api/src/team/queries.ts`**: add
   `getTeamByTeamId(teamId: string): Promise<Team | null>` (public lookup,
   `eq(teams.teamId, teamId)`) alongside the existing internal-id `getTeam(id)`.
   Leave `renameTeam`, `deleteTeam`, `getTeamMembership` accepting the
   internal id, unchanged.
2. **`apps/api/src/auth/require-team.ts`**: the `X-Sendlit-Team-Id` header
   value is now the **public** teamId. Before calling `getTeamMembership`,
   resolve it via `getTeamByTeamId` to get the internal id; 400 if not found
   (same shape as the existing invalid-uuid handling). Set
   `anyReq.teamId = team.id` (internal), not the raw header value. Also
   update the 409 "multiple teams" response
   (`teams.map((t) => ({ id: t.id, name: t.name }))`) to
   `{ teamId: t.teamId, name: t.name }`.
3. **`apps/api/src/team/routes.ts`**: team management routes are **not**
   team-scoped via `requireTeam` (see the file's own comment) — they take an
   explicit `:teamId` path param instead. That param is now public. Each of
   `rename`/`remove`/`listKeys`/`createKey`/`removeKey` must resolve
   `params.teamId` → internal id via `getTeamByTeamId` first (404 if not
   found), then use the internal id for the existing
   `getTeamMembership`/`renameTeam`/`deleteTeam`/`getApiKeysByTeamId`/
   `createApiKey`/`deleteApiKey` calls (those functions' signatures don't
   change). `list`/`create` currently return the raw team row via
   `serializeDates(team)` — **do not** reuse the generic `omitInternal()`
   helper here: on the `teams` table, the field named `teamId` is the row's
   _own_ public identifier, not an internal tenant-FK to strip, so
   `omitInternal` (which unconditionally deletes any `id`/`teamId` field)
   would incorrectly strip it. Write a small bespoke mapper instead, e.g.
   `const { id, ...publicTeam } = team;` (only drop `id`). Also strip
   `teamId` from API-key list/create responses (`apiKeys.teamId` is an
   internal FK to `teams.id` — redundant and leaky to return; the caller
   already knows which team they're scoped to).
4. **`apps/api/src/provisioning/routes.ts`**: response currently sends
   `teamId: team.id` — change to `teamId: team.teamId`.
5. **`packages/api-contract/src/schemas/teams.ts`**: `teamSchema` — drop `id`,
   add `teamId: z.string()`. `apiKeySchema`/`createdApiKeySchema` — drop the
   `teamId` field (keep `id`, per the documented exception that API keys use
   their own `id`/`keyPrefix`/`keyHash` scheme rather than a `<domain>_id`).
6. **`apps/api/src/mcp/tools/teams.ts`**: `list_teams`/`rename_team` currently
   hand-construct `{ id: t.id, name: t.name }` — change to
   `{ teamId: t.teamId, name: t.name }`. `list_api_keys`/`create_api_key` —
   drop the `teamId` field from their constructed output objects.
7. **`apps/api/src/mcp/tools/schemas.ts`**: mirror the same schema changes as
   (5) in this file's own copies of `teamSchema`/`apiKeySchema`/`createdApiKeySchema`.
8. **`apps/web`** — replace every `team.id` usage with `team.teamId`:
    - `app/dashboard/teams/page.tsx`: cookie comparison, `key={team.id}`,
      `listTeamKeys(team.id)`, `createTeamKey(team.id, ...)`,
      `deleteTeamKey(team.id, ...)`, `deleteTeam(team.id)`, the hidden form
      field value used to switch teams.
    - `lib/api.ts`: the `ApiKey` interface has a `teamId: string` field —
      remove it (being dropped from the API response in step 5).
    - After the contract schema changes, run
      `pnpm --filter @sendlit/web check-types` — it will surface every
      remaining `.id`-on-a-team-or-api-key-object reference as a compile
      error (this is exactly how the equivalent contacts/sequences/templates/
      segments cleanup was validated earlier — trust the compiler here rather
      than trying to grep-audit every usage by hand).
9. Rebuild `@sendlit/api-contract` after the schema changes
   (`pnpm --filter @sendlit/api-contract build`) — both `apps/api` and
   `apps/web` consume its compiled `dist/` output, not its TS source
   directly, so edits to `packages/api-contract/src/**` are invisible to
   either app until it's rebuilt. (This bit everyone during the first pass
   of this refactor — don't skip it.)

**Explicitly out of scope / already decided against:** `accounts.id` and the
OAuth tables (`oauth_clients.client_id`, `oauth_pending_auth.pending_id`,
`oauth_revoked_tokens.jti`) — the latter three are field names mandated by
OAuth2/JWT specs (RFC 7591 dynamic client registration, JWT `jti` claim), not
resources of ours, and intentionally don't follow this convention.

---

### Task C: Finish the `CHECK` constraints

`apps/api/src/db/schema.ts` has a `publicIdCheck(name, column, prefix)` helper
(uses Postgres `~` regex match, `^<prefix>_`) already applied to
`teams.teamId`, `contacts.contactId`, `emailTemplates.templateId`,
`segments.segmentId`. Add the same to:

- `sequences.sequenceId` → prefix `seq`
- `sequenceEmails.emailId` → prefix `email`
- `rules.ruleId` → prefix `rule`

Pattern to copy (see `contacts` or `segments` in `schema.ts` for the exact
shape — add a `(table) => ({ ...quotedIdCheck: publicIdCheck("<table>_<column>_check", table.<column>, "<prefix>") })`
third argument to each `pgTable(...)` call; `sequences` and `rules` currently
have no third argument at all, so you'll need to add the `(table) => ({...})`
callback structure, following the pattern already used for `teams`).

**Do not** add a public-id-format check to the 9 columns being converted in
Task A (`ongoing_sequences.*`, `email_deliveries.*`, `email_events.*`,
`rules.sequenceId`) — after Task A they hold internal uuids, not
prefixed public strings, so a real FK constraint (which Task A adds) is the
correct integrity check for them, not a format regex.

**Test fixture fallout:** several tests currently insert non-conforming
literal values for these three columns, and the `CHECK` constraint will
reject them once added:

- `sequences.sequenceId`: `test/fixtures.ts#seedSequence` uses
  `` `seq-${crypto.randomUUID()}` `` — **hyphen**, not the required
  `seq_` underscore prefix. Fix to `` `seq_${crypto.randomUUID()}` `` (or,
  better, just delete the explicit assignment and let the schema's
  `$defaultFn` generate a real `seq_...` id — simplest and most correct).
- Various automation tests hardcode `sequenceId: "seq-1"` as a placeholder —
  same fix, or (better, given Task A also makes this column a real FK) seed
  a real `sequences` row and use its `sequenceId` instead of a fake literal.
- `sequence_emails.emailId`: pervasively hardcoded as bare `"e1"`, `"e2"`
  across `automation/fire-event.test.ts`, `process-ongoing-sequence.test.ts`,
  and others — none of these have any prefix at all. Update every literal to
  something matching `^email_` (e.g. `"email_e1"`, `"email_e2"`) — grep for
  `emailId:\s*["'\`]`across`apps/api/src/**/*.test.ts`to find every
occurrence, and check for other places in the same test file that reference
the same literal value by string (e.g.`sentEmailIds`array assertions,`emailsOrder` comparisons) so the rename stays consistent within each file.
- `rules.ruleId`: `automation/fire-event.test.ts#seedRule` uses
  `` `rule-${crypto.randomUUID()}` `` — hyphen again; fix to `rule_` or drop
  the explicit assignment and rely on the schema default.

---

## Migration & DB reset procedure (repeat this after finishing A/B/C)

This project has no production data — squash to a single fresh initial
migration every time rather than accumulating incremental migration files.

1. Make all schema.ts edits for the task(s) above.
2. Delete the existing migration: `rm -rf apps/api/drizzle` (or use a
   `delete_path`-equivalent tool).
3. Regenerate: `pnpm --filter @sendlit/api db:generate --name init` (run from
   the `sendlit` repo root). Review the generated SQL — confirm FK/CHECK
   constraints look right before applying.
4. Reset the actual dev Postgres database. `DB_CONNECTION_STRING` lives in
   `apps/api/.env` — **do not read that file directly** (it's a secret credential;
   agent tooling should refuse to display it anyway). Instead, write a
   throwaway script that uses it at runtime without ever printing it, e.g.
   `apps/api/scripts/reset-db.ts`:

    ```ts
    import { Pool } from "pg";
    import { drizzle } from "drizzle-orm/node-postgres";
    import { migrate } from "drizzle-orm/node-postgres/migrator";

    async function main() {
        const connectionString = process.env.DB_CONNECTION_STRING;
        if (!connectionString)
            throw new Error("DB_CONNECTION_STRING is not defined");
        const pool = new Pool({ connectionString });
        try {
            await pool.query("DROP SCHEMA public CASCADE");
            await pool.query("CREATE SCHEMA public");
            await migrate(drizzle(pool), { migrationsFolder: "./drizzle" });
        } finally {
            await pool.end();
        }
    }
    main().catch((err) => {
        console.error(err);
        process.exit(1);
    });
    ```

    Run it from `apps/api`: `node --env-file=.env --import tsx scripts/reset-db.ts`.
    Delete the script afterward — it's a one-off dev tool, not part of the app.

## Validation checklist (run after each task, not just at the very end)

1. `pnpm --filter @sendlit/api-contract build` (if any contract schema changed)
2. `pnpm test` (from the `sendlit` repo root — runs `apps/api`'s vitest suite;
   uses an in-memory PGlite database with the real migrations applied, so FK/
   CHECK constraint violations will surface here as real test failures, not
   just at the live-DB-reset step)
3. `pnpm --filter @sendlit/api typecheck`
4. `pnpm --filter @sendlit/api build`
5. `pnpm --filter @sendlit/web check-types`
6. Re-run the migration/DB-reset procedure above once schema changes for the
   task are finalized.

Fix failures as you go rather than batching all three tasks before testing —
Task A alone touches ~10 files; validate it in isolation before starting B or C.

## Open questions to confirm with the requesting user if genuinely ambiguous

- Whether `sequences.entrants` and `ongoing_sequences.sentEmailIds` should
  also be normalized (current recommendation: no, they're snapshots/caches,
  not live relationships — see Task A's "out of scope" note).
- Whether the "contact no longer exists" test in
  `process-ongoing-sequence.test.ts` should be rewritten to test cascade-delete
  behavior instead of app-level cleanup logic, once `ON DELETE CASCADE` makes
  the original scenario unreachable (see Task A's test-fixture section).
- Whether `getMatchingContactIds` should return both internal and public
  contact ids (for `enrollContactsInOngoingSequence` vs. `sequences.entrants`
  respectively) or just internal ids with a second lookup for `entrants`.

Don't silently guess on these three if the answer materially changes the
schema shape — ask first.
