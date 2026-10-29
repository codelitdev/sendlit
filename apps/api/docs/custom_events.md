# PRD: Custom Events and Event-Triggered Sequences

_Status: approved; [decisions](#decisions) settled 2026-10-28. Date: 2026-10-27, revised 2026-10-28 after a review against the code. Issue:
[#136](https://github.com/codelitdev/sendlit/issues/136). Scope: `apps/api`
(schema, contract, routes, automation, rendering), the generated REST docs
and MCP server, the `sendlit` SDK, the sequence builder and contact detail
page in `apps/web` / `packages/email-blocks`, and `apps/docs`._

## Problem

A sequence can start on only three events: `subscriber:added`, `tag:added`
and `tag:removed` (`EventType` in `src/config/constants.ts`). `fireEvent`
(`src/automation/fire-event.ts`) matches `rules` rows by `event` and compares
`eventData` only for the tag events.

SaaS lifecycle email is event-driven: trial ending, payment failed, payment
received. Platforms that embed SendLit need the same thing. CourseLit wants to
send `course purchased` with the course name and price. Today the only way is
to add and remove a tag through the API, and that has four problems:

- **No payload.** The email can't say which course was bought or for how much.
- **No repeat runs.** A second purchase while the first tag is still on the
  contact means nothing to the sequence.
- **Fake tags.** The tag list fills up with `purchased-course-123` tags.
- **Two calls and a race.** Removing and adding the tag again is two requests,
  and the order matters.

This was the #2 gap in our SendLit vs Loops comparison.

## Industry context

This table is checked against each vendor's own documentation (Sources
below), not written from memory. "Not documented" means the vendor's page
doesn't say.

| | Loops | Klaviyo | Customer.io | Brevo | Mailchimp |
| --- | --- | --- | --- | --- | --- |
| **Ingest** | `POST /v1/events/send`, `200` | `POST /api/events`, `202` (accepted, processed async) | `track` call | `POST /events`, `204` | `POST /lists/{id}/members/{hash}/events` |
| **Contact** | `email` and/or `userId`; **created if unknown** | Profile identifiers; created or updated | Person id; anonymous events merged when identified | `identifiers` (`contact_id`, `email_id`, `ext_id`, …) | Must be an existing member |
| **Update contact in same call** | Yes, root-level contact properties | Yes, profile attributes | n/a | Yes, `contact_properties` | No |
| **Event name** | Free text (e.g. `payment received`) | < 128 chars | Trimmed; spaces discouraged | ≤ 255, `[A-Za-z0-9_-]` | 2–30 chars |
| **Properties** | string, number, boolean, date; must be known to the event before they can be used in emails | ≤ 400 props, 5 MB payload, 100 KB per string | Any JSON, dot notation | Nested maps and lists, ≤ 50 KB | Key/value |
| **Dedupe** | `Idempotency-Key` header, 24 h; reuse returns **409** | `unique_id` per profile + metric; later duplicates silently dropped | Event `id`, **30 days**; duplicates silently dropped | Not documented | Not documented |
| **Historical events** | n/a | `backfill: true` records without triggering flows; `time` up to 1 year ahead | Only events from the **last 72 h** trigger automations | `event_date` | `is_syncing` skips automations |
| **Trigger filter** | n/a for events (field changes for contact updated) | Top-level props: equals, doesn't equal, contains, doesn't contain; checked **at entry only** | Event data filters with dot notation | Specific event only (community report) | n/a |
| **Re-entry** | One time / Every time | Once / whenever re-qualified / after min. period | One time / every event (default) / once per period | Not documented | Not documented |
| **In email** | `{event.orderTotal}` (workflow emails only) | `{{ event.x }}` | `{{ event.x }}` (Liquid) | Not documented | Not documented |

What the platforms agree on, which we adopt rather than reinvent:

- **An event is a name, a contact, a property bag and a timestamp.** A
  trigger is the event name plus optional property conditions, checked when
  the contact enters (Klaviyo).
- **Properties are read as `event.*`** in the triggered flow's messages
  (Klaviyo and Customer.io use Liquid, as we do).
- **Re-entry is a setting on the trigger.** All three platforms that document
  it offer "once" and "every time", and Klaviyo and Customer.io also offer
  "once per period". Event triggers default to every time.
- **Dedupe uses a caller-supplied key for a bounded time.** Two of the three
  that document it drop duplicates silently.
- **Historical events can be loaded without triggering flows.** Klaviyo has
  `backfill` and Mailchimp has `is_syncing`, and Customer.io ignores events
  older than 72 h.
- **The same call can update the contact** (Loops, Klaviyo, Brevo).
- **The trigger builder suggests events the team has already sent, and
  accepts a typed name** (Customer.io, Loops).

We also follow the majority (Loops, Klaviyo, Brevo) on unknown contacts:
**an unknown email creates the contact by default.** `createContact: false`
gives Mailchimp's behaviour (404) instead. This changes what #136 proposed
([decision 3](#decisions)).

Where we deliberately differ, and why:

- **No anonymous events** (see below).

Sources: [Loops send event](https://loops.so/docs/api-reference/send-event),
[Loops event properties](https://loops.so/docs/events/properties),
[Loops triggers](https://loops.so/docs/workflows/triggers),
[Klaviyo create event](https://developers.klaviyo.com/en/reference/create_event),
[Klaviyo flow triggers and filters](https://help.klaviyo.com/hc/en-us/articles/115002779051),
[Customer.io events](https://docs.customer.io/journeys/events/),
[Customer.io event-triggered campaigns](https://docs.customer.io/journeys/event-triggered-campaigns/),
[Brevo create event](https://developers.brevo.com/reference/create-event),
[Mailchimp add event](https://mailchimp.com/developer/marketing/api/list-member-events/add-event/).
Checked 2026-10-27.

**Decision: contact-scoped events, not a CDP.** Every event must resolve to a
contact. We don't accept anonymous events, merge identities, or build event
analytics such as funnels or counts over time. That keeps SendLit a marketing
platform rather than a Segment clone ([ADR 0005](../../../docs/decisions/0005-marketing-platform-not-esp.md)).
We'll record it as ADR 0006 alongside the first PR.

## Goals

1. `POST /events`: record a named event with properties for one contact,
   found by `email` or `contactId`. The contact can be created on the fly.
   It is authenticated per team by API key or session.
2. A new sequence trigger, `event:custom`. It enrolls a contact when an event
   with the configured name arrives, if the event's properties match an
   optional filter and the contact matches the sequence's existing audience
   and exclude filters.
3. Event properties are available as `{{ event.<prop> }}` in that sequence's
   emails.
4. Idempotent ingest: the same `idempotencyKey` stores one event and enrolls
   once.
5. Self-serve: pick or type the event name in the sequence builder, write
   property filters, and see a contact's events on the contact detail page.
6. Parity: `api-contract` (and therefore the OpenAPI and REST docs), MCP
   tools, the SDK `events.track()`, and the product docs.
7. **Phase 2:** a `contact:property_changed` trigger with optional from/to
   values.

## Non-goals (v1)

- Anonymous or pre-identify events, and identity merging.
- Event analytics: charts, funnels, or segments built on "did event X N
  times". Segment filters on events are listed under [Future work](#future-work).
- Batch ingest (`POST /events/batch`). Callers loop for now, and the rate
  limit is sized for that.
- Liquid in subject lines. Subjects are sent as written today
  (`process-ongoing-sequence.ts`, `const subject = email.subject`), and
  rendering them is a change for every campaign. It's listed under Future
  work.
- `{{ event.* }}` in broadcasts. A broadcast is not started by an event.
- Firing triggers from contact imports. Imports deliberately fire nothing
  (`contacts/import.ts`), and that stays the same for both phases.

## Data model

Migration `0027_custom_events.sql`, generated with `bun db:generate`, holds
**every** schema change in this PRD, including the phase 2 columns, so that
there is only one migration. It only adds tables, nullable or defaulted
columns, one index and seed rows, so it is compatible with the previous
release (see [Rollback](#rollback)). Check the number against `main` when
merging, because parallel branches also add migrations.

Custom events get the `evt_` prefix. Delivery events
(`email_delivery_events.event_id`) used `evt_` until now, and move to `dev_`
in the same migration. Customers send, view and `track()` custom events, so
they get the familiar prefix. Delivery events are an internal-facing log.

**Why it's safe to rename now:** on 2026-10-28, prod had **0** rows in
`email_delivery_events`, and only one internal team had sent mail (one
campaign and one transactional email). No `evt_` id has been given to anyone,
so we need no alias for the old prefix and no batched rewrite.

Migration 0027:

1. `UPDATE email_delivery_events SET event_id = 'dev_' || substring(event_id from 5) WHERE event_id LIKE 'evt\_%'`.
   This is a no-op on prod; it covers any QA or self-hosted rows.
2. Replace `email_delivery_events_event_id_check` with `^(evt|dev)_`.

Code changes:

- `schema-core.ts`: `genPublicId("dev")` and `publicIdCheck(…, "dev")`.
- `docs/bounces-and-complaints.md`: update the prefix.
- The delivery-events REST endpoints, the SDK resource and the MCP tool just
  return the new ids.

The check stays relaxed for one release, because the API runs migrations
before the new pods start (`migrate.ts`). A pod still on the old code that
inserts an `evt_` row during the rollout would otherwise fail. **The first
migration after this release** reruns step 1 and tightens the check to
`^dev_`. That follow-up is tracked in the implementation plan.

The `contact_events.event_id` check is `^evt_` from the start, since the
table is new.

### `contact_events` (new)

| Column            | Type                           | Notes                                                                                    |
| ----------------- | ------------------------------ | ---------------------------------------------------------------------------------------- |
| `id`              | uuid pk                        | Internal                                                                                 |
| `event_id`        | text unique                    | Public id, `genPublicId("evt")`                                                          |
| `team_id`         | uuid fk → teams, cascade       |                                                                                          |
| `contact_id`      | uuid fk → contacts, cascade    | Internal contact id. Deleting the contact deletes its events (GDPR erasure).             |
| `name`            | text not null                  | Normalized by `eventNameSchema` (see [Validation](#validation)); matched case-sensitively |
| `properties`      | jsonb not null default `{}`    |                                                                                          |
| `occurred_at`     | timestamptz not null           | Caller-supplied `occurredAt`, or the receive time                                         |
| `idempotency_key` | text null                      | Set to null by the retention loop 30 days after `created_at`                              |
| `backfill`        | boolean not null default false | Caller asked to record only                                                              |
| `triggers`        | boolean not null               | `false` when `backfill` or [stale](#stale-and-backfilled-events); set once, at insert      |
| `source`          | text not null                  | `api` (API key) \| `session` (dashboard session calling REST) \| `mcp`, taken from the auth |
| `processed_at`    | timestamptz null               | Set when trigger matching has finished. Set at insert when `triggers = false`.            |
| `created_at`      | timestamptz not null           | Receive time                                                                             |

Indexes:

- Partial unique index `(team_id, idempotency_key) WHERE idempotency_key IS NOT NULL`,
  the same as `transactional_emails`.
- `(contact_id, occurred_at desc, id desc)` for the timeline.
- Partial index `(created_at) WHERE processed_at IS NULL` for the
  [recovery sweep](#recovery).

### `contact_event_matches` (new)

This table records one row for each event and sequence the event was matched
against. It makes matching idempotent, so a retry or the recovery sweep can't
enroll the contact twice from one event. It also tells the timeline which
sequences an event started.

| Column             | Type                              | Notes                                     |
| ------------------ | --------------------------------- | ----------------------------------------- |
| `contact_event_id` | uuid fk → contact_events, cascade |                                           |
| `sequence_id`      | uuid fk → sequences, cascade      | Deleting a sequence removes its rows      |
| `enrolled`         | boolean not null                  | `false` when re-entry or "already in sequence" blocked it |
| `created_at`       | timestamptz                       |                                           |

Primary key `(contact_event_id, sequence_id)`.

### `event_definitions` (new)

This is the team's list of events, as on the Loops Events page. An event is
registered in one of two ways:

- **Automatically** when the first event with that name arrives (`origin = 'received'`).
- **By hand**, from the Events page or the trigger picker, before any event
  has been sent (`origin = 'manual'`). Loops allows both.

The builder reads its name and property suggestions from this table, so it
never has to run `SELECT DISTINCT` over `contact_events`.

| Column            | Type                   | Notes                                                                            |
| ----------------- | ---------------------- | -------------------------------------------------------------------------------- |
| `id`              | uuid pk                |                                                                                  |
| `team_id`         | uuid fk, cascade       |                                                                                  |
| `name`            | text                   | Unique on `(team_id, name)`; normalized by `eventNameSchema`                     |
| `origin`          | text not null          | `received` \| `manual`. Never changes after creation.                            |
| `description`     | text null              | Up to 500 chars, set in the dashboard                                            |
| `properties`      | jsonb not null default `[]` | `[{ key, type, declared }]`, at most 100. `type` is `string` \| `number` \| `boolean` \| `date` \| `object` \| `array`. `declared = true` means a person added it; otherwise it was observed in an event. |
| `last_properties` | jsonb null             | Properties of the most recent event that triggers. Builder example and test-send data (like Customer.io's "View instances"). |
| `first_seen_at`, `last_seen_at` | timestamptz null | Null until the first event arrives                                 |
| `created_at`      | timestamptz not null   |                                                                                  |

How property types are worked out:

- An observed key gets its type from the first value seen, with ISO 8601
  strings recognised as `date`.
- A declared type always wins over an observed one.
- If an event sends a different type for a key, the event is still
  accepted. Like Loops, we don't reject events over types. The mismatch is
  only shown on the Events page.

A team may have at most **500 names**, registered by hand or not. Names that
differ only in case count separately.

### `sequences`

| Column                | Type                                     | Notes                                                       |
| --------------------- | ---------------------------------------- | ----------------------------------------------------------- |
| `trigger_filter`      | jsonb null                               | Shape depends on `trigger_type` ([Contract](#sequence-contract-changes)) |
| `reentry`             | text not null default `'every_time'`     | `once` \| `every_time` \| `once_per_period`. Ignored for broadcasts. |
| `reentry_period_days` | int null                                 | Required for `once_per_period`, 1–365                       |

`triggerType = "event:custom"` and `triggerData = <event name>` reuse the
existing columns.

### `rules`

- `event_filter jsonb null`: `addRule` copies `trigger_filter` here, the same
  way it copies `triggerData` to `eventData`.
- New index `(team_id, event, event_data)`. Matching moves into SQL
  (`event = $event AND event_data = $data`).

### `sequence_entries` (new)

This is the entry history that `once` and `once_per_period` check. We need a
separate table because `ongoing_sequences` rows are deleted when a contact
finishes a sequence.

| Column             | Type                         |
| ------------------ | ---------------------------- |
| `sequence_id`      | uuid fk → sequences, cascade |
| `contact_id`       | uuid fk → contacts, cascade  |
| `first_entered_at` | timestamptz not null         |
| `last_entered_at`  | timestamptz not null         |
| `entry_count`      | int not null                 |

Primary key `(sequence_id, contact_id)`. Only `type = 'sequence'` writes to
it.

**Seeding.** The migration fills the table from the history we already have,
so switching an existing sequence to `once` doesn't let past entrants back
in:

- the distinct `(sequence_id, contact_id)` pairs in `email_deliveries` whose
  sequence is a `'sequence'`, with `min`/`max(coalesce(created_at, now()))`,
- unioned with the current `ongoing_sequences` rows,
- each seeded with `entry_count = 1`.

The seed is approximate: history before `email_deliveries` existed is lost,
and so is the true count. Deleting a contact and adding them again starts
their history fresh, because of the cascade. Both are documented.

### `ongoing_sequences`

- `trigger_event jsonb null`: the snapshot `{ eventId, name, properties, occurredAt }`
  written at enrollment.

We copy the payload onto the row instead of keeping a foreign key, for three
reasons:

- The send loop claims rows by id and renders from the row, so a snapshot
  needs no join on the hot path.
- It survives event retention while long sequences are still running.
- Renaming the trigger doesn't change what contacts already in the sequence
  receive.

## Constants

`src/config/constants.ts`:

```ts
export const EventType = {
  TAG_ADDED: "tag:added",
  TAG_REMOVED: "tag:removed",
  SUBSCRIBER_ADDED: "subscriber:added",
  DATE_OCCURRED: "date:occurred",
  CUSTOM_EVENT: "event:custom",
  CONTACT_PROPERTY_CHANGED: "contact:property_changed", // phase 2
} as const;
```

`@sendlit/api-contract` gains two lists:

- `sequenceTriggerTypes`: every trigger except `date:occurred`.
- `triggerTypes`: all of them.

`packages/email-blocks/src/types.ts` (`TriggerType`), `trigger-picker.tsx`
and MCP `update_sequence` import these lists instead of keeping their own
copies.

## API surface

A new `packages/api-contract/src/schemas/events.ts` holds the schemas. A new
`eventsContract` in `contract.ts` is mounted as `events`, and the
`contacts.events` route is added to `contactsContract`. The OpenAPI spec gets
an "Events" tag in `openapi.ts`. Auth falls through to `teamOrUser`.

### Shared schemas

- `eventNameSchema`: `z.string().trim().min(1).max(128)`, with no control
  characters and no leading `$` (reserved). It is case-sensitive. **The
  same schema** validates `POST /events` `eventName`,
  `GET /events/definitions/:name`, and `triggerData` when the trigger type is
  `event:custom`. That keeps a stored trigger and an incoming event
  normalized the same way.
- `eventPropertiesSchema`: a JSON object, at most **32 KB** as serialized
  UTF-8, at most **100 top-level keys**, nested at most **3 levels**.
  - Keys at **every** level must match `^[A-Za-z_][A-Za-z0-9_]{0,63}$`, so
    they work as Liquid paths.
  - Values may be strings, numbers, booleans, `null`, arrays or objects.
  - Express's default JSON body limit is 100 KB (`app.ts`), which leaves
    room for the rest of the body.
  - Brevo caps properties at 50 KB and Klaviyo allows far more. We stay
    smaller because the payload is copied onto each enrollment row.
- `eventPropertyFilterSchema` and `propertyChangeFilterSchema` (see
  [Property filters](#property-filters)).

### `POST /events` → `202 Accepted`

```jsonc
{
  "email": "jane@example.com",          // exactly one of email | contactId
  "contactId": "cnt_…",
  "eventName": "course purchased",
  "properties": { "courseName": "Rust 101", "price": 49, "plan": "pro" },
  "occurredAt": "2026-10-27T10:00:00Z", // optional; at most 24 h ahead of receive time
  "idempotencyKey": "order_8812",       // optional, 1–256 chars
  "backfill": false,                    // optional; true = record only, never trigger
  "createContact": true,                // optional, default true; ignored with contactId
  "contact": {                          // optional, strict: only these two keys
    "name": "Jane",
    "customFields": { "plan": "pro" }   // merged into the existing fields, never replaced
  }
}
```

Response:

```json
{ "eventId": "evt_…", "contactId": "cnt_…", "duplicate": false, "contactCreated": false }
```

- **`202`** means the event is stored. Matching runs after the commit,
  inside the same request (see [Pipeline](#ingest-pipeline)). The response
  doesn't list the sequences that started, so matching can move to a queue
  later without breaking callers. Klaviyo also returns `202` for "validated
  and submitted for processing". Loops returns `200` and Brevo `204`.
- **`contact`** follows Loops (contact properties at the root), Klaviyo
  (profile attributes) and Brevo (`contact_properties`). We nest the fields
  under `contact` so they can never collide with event fields. The schema is
  strict, so `email`, `subscribed` and `tags` can't be changed this way.
  Custom fields are merged, as Loops and Brevo merge them. `PATCH /contacts`
  replaces them, but a caller setting one field here shouldn't wipe the
  others.
- **Replays** return the original `eventId` and `contactId` with
  `duplicate: true` and `contactCreated: false`. The request body is not
  compared, and `contact` is not applied again (see [Idempotency](#idempotency)).
- **Unsubscribed contacts:** the event is stored and appears in the
  timeline, but it enrolls nobody, because `contactMatchesAudience` requires
  `subscribed = true`. A contact who is subscribed but suppressed (for
  example after a hard bounce) can enroll. Their emails are then skipped at
  send time, as for any sequence (`process-ongoing-sequence.ts`).

Errors use the existing `{ error, … }` body. Each code is added to
`errors.mdx` in the PR that introduces it.

| Status | `error`                         | When                                                                                       |
| ------ | ------------------------------- | ------------------------------------------------------------------------------------------ |
| 400    | ts-rest request validation      | Body fails the contract (same response as every other endpoint). Includes: both or neither of `email`/`contactId`; an invalid email; a bad name (`$` prefix, too long, control characters); `occurredAt` more than 24 h ahead; properties over the caps or with an invalid key; unknown keys in `contact` |
| 400    | `credential_ambiguous`          | More than one credential (existing auth behaviour)                                          |
| 401    | (existing)                      | No credential or an invalid one                                                             |
| 402    | `plan_limit_reached`, `payment_required` | Creating the contact would go over the contact limit (`reserveSubscribedContactSlot` → `PlanGateError`). Nothing is stored. |
| 404    | `contact_not_found`             | Unknown `contactId`, or one that belongs to another team (a `contactId` never creates a contact). Unknown email with `createContact: false`. |
| 409    | `team_required`                 | Session auth with no team chosen (existing `requireTeam` behaviour)                        |
| 422    | `event_name_limit_reached`      | This name is new and the team already has 500. Nothing is stored or created.                |
| 429    | `too_many_requests`             | Rate limit                                                                                 |

### `GET /contacts/:contactId/events` → `200`

- **Query:** `page` (default 1), `limit` (default `itemsPerPage` = 10, max
  `maxItemsPerPage` = 50), and `name` (optional, exact match after
  `eventNameSchema`). This follows `schemas/sequences.ts`.
- **Response:** `paginated(contactEventSchema)` → `{ items, total }`.
- **Order:** `occurred_at desc, id desc`. An `occurredAt` up to 24 h in the
  future sorts first, which is accepted.
- **Errors:** `404 contact_not_found` when the contact isn't in the team.

```ts
contactEventSchema = {
  eventId, name, properties,
  occurredAt, receivedAt,          // ISO strings
  source: "api" | "session" | "mcp",
  backfill: boolean,
  triggers: boolean,               // false = stored only (backfill or stale)
  enrolledSequences: { sequenceId: string; title: string }[], // from contact_event_matches where enrolled
}
```

When a sequence is deleted, its match rows go with it through the cascade,
so the sequence simply disappears from `enrolledSequences`.

### Event definitions endpoints

`eventDefinitionSchema = { name, origin, description, properties: [{ key, type, declared }], firstSeenAt, lastSeenAt, createdAt, sequenceCount }`.
`sequenceCount` is the number of non-deleted sequences whose trigger is this
event.

| Method and path                         | Body / response                                                                 | Errors |
| --------------------------------------- | ------------------------------------------------------------------------------- | ------ |
| `GET /events/definitions` → `200`       | `itemsList(eventDefinitionSchema)`, sorted by `lastSeenAt desc nulls last`, then `name`. At most 500, so no pagination. Doesn't include `lastProperties`. | |
| `GET /events/definitions/:name` → `200` | `eventDefinitionSchema` plus `lastProperties`                                   | `404 event_definition_not_found` |
| `POST /events/definitions` → `201`      | Body `{ name, description?, properties?: [{ key, type }] }`. Creates a row with `origin = 'manual'`. | `409 event_definition_exists`, `422 event_name_limit_reached` |
| `PATCH /events/definitions/:name` → `200` | Body `{ description?, properties? }`. `properties` replaces the **declared** set; observed keys stay. | `404` |
| `DELETE /events/definitions/:name` → `204` | Removes the row from the list. Stored events are kept. A later event with the name registers it again. | `404`; `409 event_definition_in_use` while any non-deleted sequence uses it as its trigger |

- `:name` is URL-encoded and normalized with `eventNameSchema`.
- Names can't be renamed. Event names come from the sender's code, so
  renaming one here would silently disconnect it. Loops doesn't document
  a rename either.
- Registering, editing and deleting an event never changes what the
  ingest API accepts. It only changes what the builder offers.

### Sequence contract changes

- **`triggerType`, response:** stays a string, typed as `z.enum(triggerTypes)`,
  which includes `date:occurred`. Broadcasts and sequences share
  `sequenceSchema`, so this can't reject an existing row.
- **`triggerType`, update body:** `z.enum(triggerTypes)`. The server then
  checks it against the **stored** sequence type: broadcasts only accept
  `date:occurred`, and sequences only accept `sequenceTriggerTypes`.
  Anything else is `400 invalid_trigger_type`.
- **`triggerFilter`** is added to the response and the update body
  (nullable). The update body is partial, so the server validates the
  **merged** state (stored row plus patch):
  - `event:custom` → `eventPropertyFilterSchema` or null.
  - `contact:property_changed` → `propertyChangeFilterSchema` or null.
  - Any other trigger → it must be null, otherwise `400 invalid_trigger_filter`.
  - When the patch changes `triggerType` and has no `triggerFilter`, the
    stored filter is cleared.
- **`triggerData`** for `event:custom` goes through `eventNameSchema` in
  `updateSequence` as well as `startSequence`, otherwise
  `400 invalid_trigger_data`.
- **`reentry`** and **`reentryPeriodDays`** are added to the response and the
  update body. They are only valid on sequences (`400 invalid_reentry` on a
  broadcast). `reentryPeriodDays` is required for `once_per_period`.
- **MCP `update_sequence`** reuses these contract schemas instead of its
  own free-string fields.

### Updating the trigger of an active sequence (prerequisite fix)

Today `updateSequence` writes the trigger to the sequence row but never
updates `rules`. An active sequence keeps firing on its old trigger until it
is paused and resumed.

The fix:

- `addRule` and `removeRule` take an optional `tx`.
- `updateSequence` runs in a transaction. If the sequence is `active` and
  any of `triggerType`, `triggerData` or `triggerFilter` changed, it calls
  `removeRule` and then `addRule`, built from the **merged** values.
- This also covers changing the type to or from `event:custom`.
- Contacts already in the sequence keep their payload snapshot.

### Validation

All of these rules live in the contract, so REST, the SDK and MCP share
them. `trackEvent` checks them again, because MCP requests never pass
through the REST schema (the same reason `transactional/queries.ts` gives).

### Stale and backfilled events

`triggers` is set to `false` at insert when either of these is true:

- `backfill: true`, as with Klaviyo `backfill` and Mailchimp `is_syncing`.
- `occurredAt` is more than **72 h** before the server's receive time,
  which is Customer.io's rule.

It is decided once, at insert time. The recovery sweep never looks at the
age again. An event with a future `occurredAt` (at most 24 h ahead) triggers
straight away.

When `triggers` is `false`, **nothing fires**: not `event:custom`, not the
`subscriber:added` from `createContact`, and not phase 2's
`contact:property_changed` from `contact`. The contact is still created or
updated, in the same silent way imports do it. Without this, loading a year
of purchases for new contacts would send every historical customer
both the welcome sequence and a "thanks for your purchase" email.

### Idempotency

The pattern is the one transactional emails use (`transactional/queries.ts`),
and it covers the full [pipeline](#ingest-pipeline):

1. A fast-path lookup on `(team_id, idempotency_key)`, before anything is
   written.
2. Inside the ingest transaction, the event insert uses `ON CONFLICT DO
   NOTHING` on the partial unique index. If the insert conflicts, the
   transaction is **rolled back**, so a contact it created or updated is
   undone. Then the winning row is selected and returned as a replay.
3. A replay returns `202` with `duplicate: true` and does nothing else.

This is what Klaviyo and Customer.io do, and what our own `POST /emails`
does: duplicates are dropped silently. Loops returns `409` instead, which
makes a retrying caller treat an error as success.

**Window: at least 30 days**, as Customer.io. The hourly retention loop
clears `idempotency_key` on events older than 30 days, so a key can be used
again within an hour of it expiring. We don't use Loops' 24 h, because
payment-provider webhooks are redelivered for days.

## Ingest pipeline

All of this lives in `src/events/queries.ts`, in
`trackEvent({ teamId, source, ...body })`.

This needs some contact refactoring first, with existing callers keeping
their behaviour:

- Split `createContact` into `createContactInTx(tx, input) → { contact, created }`
  and an `afterContactCreated(contact)` step. The step does the custom-field
  index sync, `contact_created` telemetry and `fireEvent(subscriber:added)`.
  `createContact` becomes the two run one after the other.
- Split `updateContact` the same way, into `updateContactInTx(tx, …, { mergeCustomFields })`
  and an after-commit step. Merging happens **after** the `FOR UPDATE` read
  (`{ ...current.customFields, ...incoming }`), and the index is synced from
  the merged row, not the patch. The shallow merge and the no-op check
  (`sameJson`) come out of `updatePatch` in `contacts/import.ts` into a shared
  helper.

The steps:

1. **Validate** with the contract schemas.
2. **Idempotency fast path.** On a hit, return the replay.
3. **Resolve the contact**, read only. With `contactId`, call
   `getContactByContactId` and check the team. With `email`, call
   `findContactByEmail` on the normalized address. Return 404 for an
   unknown `contactId`, or for an unknown email when `createContact` is
   `false`. Otherwise an unknown email is created in step 4.
4. **Run one transaction:**
   1. If the contact is missing, `createContactInTx` with `contact.name`
      and `contact.customFields`. The custom fields are in place before any
      `subscriber:added` audience check runs. A plan gate here returns 402
      and rolls everything back.
   2. If the contact exists and `contact` was sent, `updateContactInTx` in
      merge mode.
   3. **Name cap.** If there is no `event_definitions` row for the name,
      take `pg_advisory_xact_lock(hashtext('event_definitions:' || team_id))`,
      count the team's names, and throw `event_name_limit_reached` if it is
      500 or more. An `ON CONFLICT` upsert can't enforce a count on its own,
      and concurrent new names would race past it.
   4. **Insert the event** (`triggers`, and `processed_at = now()` when
      `triggers` is false). On an idempotency conflict, roll back and return
      the replay (see above).
   5. **Upsert `event_definitions`**: set `first_seen_at` if it is null,
      update `last_seen_at`, and add newly observed top-level keys to
      `properties`. Unless the event is a backfill or stale, also update
      `last_properties`. A row created by hand keeps `origin = 'manual'`
      and its declared types.
5. **After the commit:**
   1. Run the after-commit step for the contact. `subscriber:added` and the
      phase 2 property-change events fire **only when** `triggers` is true.
   2. If `triggers` is true, call `matchEventTriggers(event)` (below) and
      then set `processed_at`.
6. Send `custom_event_received` and reply `202`.

When a contact is created, `subscriber:added` fires before
`event:custom`, so a welcome sequence and a purchase sequence can both
start. That is the expected behaviour, and it fires exactly once (#136
item 6).

### Matching: `matchEventTriggers` and `fireEvent`

`fireEvent` keeps its signature for existing callers and gains an optional
`triggerEvent`. The changes:

- **SQL matching.** Rules are selected with
  `rules.event = $event AND rules.event_data = $eventData`. This applies to
  the tag events too, which removes today's comparison in JS. All matching
  sequences are then loaded in one `inArray` query, instead of one query per
  rule.
- **Then, per rule:**
  1. The sequence must be `active`.
  2. The trigger filter must match: `matchesEventFilter(rule.event_filter, properties)`,
     a pure function in `src/automation/event-filter.ts`. As in Klaviyo, it
     is checked only at entry.
  3. The contact must match the audience (`contactMatchesAudience`).
  4. Enrollment, below.
- **Enrollment.** The contact goes through a new single-contact function,
  `enrollContactFromTrigger(tx, …)`, in one transaction. The bulk
  `enrollContactsInOngoingSequence` stays as it is for broadcasts
  (`process-rules.ts`).
  1. If `triggerEvent` is set, insert into `contact_event_matches`
     (`enrolled = false`) with `ON CONFLICT DO NOTHING RETURNING`. If no row
     comes back, this event was already matched to this sequence, so skip.
     This is what makes a retry or the sweep safe.
  2. Check the plan with `assertMarketingAllowedForContactUsage` (already in
     the code).
  3. Insert into `ongoing_sequences`, including `trigger_event`, with
     `ON CONFLICT (sequence_id, contact_id) DO NOTHING RETURNING`. If no row
     comes back, the contact is already in the sequence: commit, leaving
     the match row as `enrolled = false`.
  4. Apply the [re-entry](#re-entry) upsert on `sequence_entries`. If it is
     refused, raise a sentinel that rolls back the `ongoing_sequences`
     insert, then record the match with `enrolled = false` in a second small
     statement.
  5. Set `contact_event_matches.enrolled = true`.
- **Telemetry and errors.** `contact_enrolled_in_sequence` is sent only when
  a row was actually inserted. Today it is also sent on a conflict skip.
  Errors are still caught per rule and sent with `captureError`, as they are
  today, and now carry an `error_code` (for example `plan_limit_reached`).
  They never fail the ingest: the event is already stored, and retrying
  can't fix a plan limit.

### Re-entry

Re-entry is a setting on each **sequence**. It applies to every
`fireEvent`-driven trigger (subscriber, tags, events, property change). It
doesn't apply to broadcasts, which hide the control and return 400 if it is
sent. The options are the ones all three platforms that document re-entry
share:

| `reentry`              | Enrolls when                                                    | Same as                                                       |
| ---------------------- | --------------------------------------------------------------- | ------------------------------------------------------------- |
| `every_time` (default) | Each match                                                      | Loops "Every time", Customer.io "On every event", Klaviyo "re-enter whenever they re-qualify" |
| `once`                 | No `sequence_entries` row exists                                | Loops and Customer.io "One time", Klaviyo "enter only once"   |
| `once_per_period`      | No row exists, or `last_entered_at < now() - reentry_period_days` | Customer.io "Once within a time period", Klaviyo "after a minimum time period" |

Each mode is a single atomic statement, so two concurrent events can't both
pass a `once` check:

- `once`: `INSERT … ON CONFLICT DO NOTHING RETURNING`
- `once_per_period`: `INSERT … ON CONFLICT DO UPDATE SET last_entered_at = now(), entry_count = entry_count + 1 WHERE sequence_entries.last_entered_at < now() - make_interval(days => $n) RETURNING`
- `every_time`: the same upsert with no `WHERE`

No `RETURNING` row means the entry is refused.

In every mode, a contact who is **currently** in the sequence isn't enrolled
again. The unique `(sequence_id, contact_id)` on `ongoing_sequences` blocks
it, and the payload from the first event stays. The new event is still
stored and shown. The vendors don't document this case, so we keep the
existing behaviour.

`every_time` is the default because Klaviyo (metric flows) and Customer.io
use it, and tag triggers already behave that way. For `subscriber:added`,
the trigger only fires once per contact, so the setting makes no practical
difference there.

### Paused sequences

`pauseSequence` removes the rule. Events that arrive while a sequence is
paused are stored but **not replayed** when it is resumed, which is how tag
triggers already behave. The docs and the pause confirmation say this.

### Recovery

Matching runs inline after the commit, so a crash between step 4 and step 5
would leave an event with `processed_at IS NULL`. The 60 s rules loop
(`process-rules.ts`, started from `automation/start.ts`) gets a sweep:

- It selects up to 100 events where `processed_at IS NULL AND created_at < now() - interval '2 minutes'`,
  using `FOR UPDATE SKIP LOCKED` in a short transaction to claim them.
- It runs `matchEventTriggers` for each one, then sets `processed_at`.

This is safe even when it races a slow request or another instance, because
`contact_event_matches` allows only one enrollment per event and sequence.

## Testing events

We follow Loops: marketers can test a trigger without a developer, and
without sending real mail.

### "Send test event"

This is a button on the Events page and in the trigger picker (see
[Dashboard](#dashboard)). It opens a dialog with:

- the event name;
- the contact's email;
- the properties as JSON, prefilled from `lastProperties`, or else built
  from the declared properties with placeholder values.

The dialog calls the ordinary `POST /events` with the session's
credentials. **There is no special test endpoint.** The test event is
stored, matched and timed exactly like a real one, with `source = session`.
That is the point: it proves the sequence will start. It also registers the
name and its property keys if they are new.

### Test addresses

Loops: "Events will fire as normal but emails will not be sent to
`@example.com` or `@test.com` addresses." We do the same for sequence and
broadcast mail:

- **Covered addresses:**
  - the RFC 2606/6761 reserved names `example.com`, `example.net`,
    `example.org`, and anything under the `.test`, `.example`, `.invalid`
    and `.localhost` TLDs;
  - Loops' `test.com`, which is a real domain whose owner shouldn't get our
    test mail.
- **Behaviour:** an event for one of these addresses creates the contact
  (`createContact` defaults to `true`), enrolls it and runs the sequence.
- **How the send is skipped:** `attemptMailSending`
  (`process-ongoing-sequence.ts`) skips the send right after the
  suppression recheck, the same way it handles a suppressed recipient. The
  sequence advances, nothing reaches the ESP, no `reserveSend` is made, and
  the email doesn't count toward plan limits.
- **Telemetry:** a log line and an `email_send_test_address_skipped` event
  with `sequence_id` and `sequence_type`.
- **What the tester sees:** the contact's Events card lists the sequences
  the event started.
- **Where the list lives:** in one place, `isTestAddress(email)` in
  `src/utils/mail.ts`.

The dialog's email field suggests `test+<n>@example.com`, so the default
test sends no mail. To get the real email, use your own address; test sends
from the editor already cover that.

Transactional email is out of scope here. Test addresses there are listed
under Future work.

## Property filters

Klaviyo offers equals, doesn't equal, contains and doesn't contain on
top-level properties. Customer.io allows dot paths. We reuse the
**condition names** from segment filters (`customField` in
`contacts/segment.ts`), which cover Klaviyo's four. We add numeric
comparisons, which #136 asks for (`amount > 100`), and dot paths. The type
is new, because segment filters compile to SQL and these run in memory.

```ts
type EventPropertyFilter = {
  aggregator: "and" | "or";
  filters: Array<{
    key: string;            // dot path, up to 3 levels, e.g. "course.id"
    condition:
      | "is" | "is_not" | "contains" | "not_contains"
      | "gt" | "gte" | "lt" | "lte"
      | "exists" | "not_exists";
    value?: string | number | boolean;
  }>; // 1–10 conditions
};
```

How each condition evaluates. "Missing" means the key path is absent or
`null`.

| Condition       | Missing | String property                        | Number property                         | Boolean property | Array / object |
| --------------- | ------- | -------------------------------------- | --------------------------------------- | ---------------- | -------------- |
| `is`            | false   | Equal, case-insensitive                | Numeric equality (value coerced, below) | Equality (coerced) | false (use `contains`) |
| `is_not`        | **true** (Klaviyo's "doesn't equal") | Negation of `is`         | Negation of `is`                        | Negation of `is` | true           |
| `contains`      | false   | Substring, case-insensitive            | false                                   | false            | Array: some element `is` the value. Object: false. |
| `not_contains`  | **true** | Negation of `contains`                | true                                    | true             | Negation of `contains` |
| `gt` `gte` `lt` `lte` | false | Compared numerically if the string is a finite number, otherwise false | Numeric | false | false |
| `exists`        | false   | true                                   | true                                    | true             | true           |
| `not_exists`    | true    | false                                  | false                                   | false            | false          |

- **Coercion.** A filter value that is a string is coerced when the
  property is a number (it must parse as a finite number) or a boolean
  (`"true"`/`"false"`). The dashboard value `Input` produces strings, so
  without this `amount gt "100"` would never match. The UI also saves
  numbers for `gt`/`gte`/`lt`/`lte`.
- **Dates** have no special handling in v1. ISO strings can be compared with
  `is`. Date comparisons are listed under Future work.
- **An empty filter** (null) matches everything.
- **Phase 2's `propertyChangeFilterSchema`** is `{ from?: scalar | null, to?: scalar | null }`.
  An absent side means "any value", and `null` means "unset". Each side is
  compared with the `is` rules.

`matchesEventFilter` gets a table-driven unit test covering every cell
above.

## Merge tags: `{{ event.<prop> }}`

- **Namespace.** `event` holds the event's **properties** and nothing else.
  `{{ event.name }}` is a property called `name`, not the event name. The
  author already knows which event triggers their sequence, so we don't add
  reserved keys.
- **Rendering.** `renderCampaignHtml` (`mail/campaign.ts`) accepts optional
  `event?: Record<string, unknown>` and `eventId?: string`.
  `process-ongoing-sequence.ts` passes `trigger_event?.properties ?? {}` and
  `trigger_event?.eventId`. `{{ event.* }}` has no effect in a sequence that
  wasn't triggered by an event: it renders empty.
- **Missing values** render as empty strings, because campaigns already run
  with `requireVariables: false`. Authors write fallbacks in Liquid:
  `{{ event.plan | default: "free" }}`.
- **Escaping.** `new Liquid()` in `mail/render.ts` doesn't escape output.
  When the context is built, string values in `event` are HTML-escaped,
  recursively. Campaign mail is HTML-only today, with no plain-text part, so
  no double escaping is visible. Turning on `outputEscape` for every
  variable, including `subscriber.*`, is separate hardening (Future work).
- **Subjects** are not rendered with Liquid (Non-goals).
- **Other render paths:**
  - **Test send** (`sequences/test-send.ts`) uses `last_properties` from
    `event_definitions` for the sequence's trigger name, or `{}`. The
    test-send dialog's footer context says "Sample data from the last
    `course purchased` event" (or "No events received yet"), following the
    dialog guidelines. The `[Test]` subject doesn't change. A test send has
    no real event, so its view-in-browser link renders `event` as empty.
  - **Per-recipient view in browser** (`tracking/web-view.ts`). The view
    token (`{ kind: "view", contactId, sequenceId, emailId, v? }`, minted in
    `renderCampaignHtml`) gets an optional `evt` (the custom event id). The verifier ignores
    unknown keys, so old tokens still work. The web view loads the event
    only if its `team_id` and `contact_id` match the token's sequence team
    and contact. If the event is no longer retained, it renders `{}`.
  - **Public web version** (`web/queries.ts`): `event` is always `{}`, just
    as `subscriber` is blanked there.
- **Editor hints.** `MARKETING_VARIABLES` in `email-editor-screen.tsx` adds
  `event.<key>` rows. They come from the trigger event's `properties` keys and
  appear only while the sequence's trigger is `event:custom`.

## Rate limiting and plan enforcement

- **Rate limit.** A team-keyed `express-rate-limit`, set up like
  `transactional/routes.ts` (`keyGenerator: req.teamId`, mounted after
  `requireTeam`, `standardHeaders: true`, `too_many_requests` body).
  `POST /events` allows **600/min** and the GETs 300/min.
  - The store is in memory and per instance, with the same Redis caveat as
    transactional.
  - MCP `track_event` joins `highImpactTools` (`mcp/routes.ts`) at 20/min.
    That is deliberately much lower, because MCP is for agents and people,
    not for streaming production events.
- **Billing.** Events are free and not metered, since plans are priced on
  sends ([ADR 0003](../../../docs/decisions/0003-plans-priced-on-sends-and-teams.md)).
  Everything an event can lead to is already gated:
  - contact creation: `reserveSubscribedContactSlot`, returned as 402;
  - enrollment: `assertMarketingAllowedForContactUsage`, caught per rule;
  - sending: `reserveSend`.
- **Abuse.** The payload caps, the 500-name cap and the rate limit limit
  what one team can store, and retention limits it over time.

## Retention

The hourly `delivery-feedback/retention-loop.ts` gains two purges. They
follow the pattern in `retention.ts`: bounded batches of 500, run until a
batch comes back empty.

- `idempotency_key = NULL` on events older than **30 days**.
- Delete events older than **396 days** (`EVENT_RETENTION_DAYS`, the same as
  `DELIVERY_EVENT_RETENTION_DAYS`). Their match rows go with them.

`event_definitions` rows with `origin = 'received'` whose `last_seen_at` is
older than 396 days are deleted, unless a **non-deleted sequence** (any status) has
`trigger_type = 'event:custom'` and `trigger_data` equal to the name. This
checks `sequences`, not `rules`, so a paused sequence keeps its
suggestions. Rows created by hand are never purged automatically; people
delete them from the Events page. A deleted definition frees a slot under
the 500-name cap.

## Dashboard

Everything uses shadcn/ui components, installed with the shadcn CLI if
missing. Loading states use the `Loading` component and nothing else.

The look comes from `@codelitdev/design-system`, which holds SendLit's
design tokens. Its `styles.css` is already imported in
`apps/web/app/globals.css`.

- **Use the CodeLit-styled wrappers** in `apps/web/components/ui/codelit/`
  (`badge`, `button`, `card`, `dialog`, `input`, `select`, and so on) where
  one exists. Use a plain shadcn component only where no wrapper exists, for
  example `Command`/`Popover` for the Combobox.
- **Colours, radii and spacing come from the design-system tokens**, as CSS
  variables or the Tailwind classes mapped to them, such as `text-primary`,
  `bg-muted` and `bg-[var(--primary-soft)]`. Never hard-code hex values or
  Tailwind palette colours.
  - This also applies to the components in `packages/email-blocks`
    (`trigger-picker.tsx`, `EventPropertyFilterEditor`). They render inside
    the web app and pick up its tokens.
- **Status badges** ("Backfill", "Not triggered", and the amber/green/red
  states) use the `codelit/badge` variants. That gives the design-system
  soft colour plus words, never colour alone.

### Sequence builder (`packages/email-blocks/src/trigger-picker.tsx`)

- New option **"Custom event"** (`event:custom`):
  - **Name.** A shadcn Combobox (`Popover` + `Command`) suggests names from
    `GET /events/definitions`. For a new name it offers **"Create event
    `trial ending`"**, which calls `POST /events/definitions` and selects
    the name. This is Loops' "create an event from the trigger node". Names
    are shown in monospace.
    - When the selected event has never been received, an amber note says
      "No `trial ending` events received yet" next to a **Send test event**
      button.
    - While loading, the list body shows `Loading`.
    - If loading fails, free text still works and an inline note says
      "Couldn't load your events".
    - If the team has never sent an event, one sentence links to the Events
      developer doc.
  - **Filter.** A collapsible "Only when the event's properties match…"
    holds `EventPropertyFilterEditor`. Each row has:
    - a key Combobox, seeded from the event's `properties` and also accepting free
      text;
    - a condition `Select`;
    - a value `Input`, which is `type="number"` for `gt`/`gte`/`lt`/`lte`
      and hidden for `exists`/`not_exists`. Otherwise it follows the
      property's known type: a `Switch` for `boolean`, a number `Input` for
      `number`, and text for everything else. Numbers and booleans are
      saved typed, not as strings.

    The editor uses the shapes of `contact-filter-builder.tsx` but isn't a
    fork of it, because that builder's definitions are keyed by field name.
  - **Example.** The last payload (`GET /events/definitions/:name` →
    `lastProperties`) appears read-only in monospace with a copy button.
- **"Who can enter"** appears for every sequence trigger and is hidden for
  broadcasts. It is a `Select` with "Every time the trigger happens", "Only
  once" and "Once every N days", plus a number `Input` for N.
- `TriggerPicker` props add `triggerFilter`, `eventDefinitions` and
  `onLoadDefinition(name)`. `onChange` now returns
  `{ triggerType, triggerData, triggerFilter }`.
- In the sequence editor (`apps/web/app/(dashboard)/sequences/[sequenceId]/page.tsx`),
  `saveMeta()` sends `triggerFilter`, `reentry` and `reentryPeriodDays`, and
  `apps/web/lib/api.ts` `updateSequence` gains those fields.
  - Fix a bug on the way: today `saveMeta` turns an empty trigger value
    into `undefined`, so a value can't be cleared.
  - Server errors such as `invalid_trigger_filter` are shown inline.

### Events page (`apps/web/app/(dashboard)/events/page.tsx`)

This is SendLit's version of Loops' Events page: a new **Events** entry in
`app-sidebar.tsx`, placed after Contacts.

- **The table** has one row per event, with:
  - the name in monospace;
  - the description;
  - a property count;
  - "Last received" as a relative time, or "Never received" as a neutral
    badge with words;
  - "Used by N sequences";
  - a "Created by hand" badge where it applies.
- **Empty state:** one sentence, the **Create event** button, and a link to
  the Events developer doc.
- **Create / edit dialog**, following the domain authentication dialog:
  - **Header:** the event name in monospace, and one sentence: "Your app
    sends this event with `events.track()`, and sequences can start when it
    arrives."
  - **Body:**
    - the name, which can't be changed after creation;
    - the description;
    - a **Properties** section with key `Input` + type `Select` rows;
    - for a received event, a collapsible "Last payload" in monospace with
      a copy button;
    - a collapsible "How to send it" with a ready-made `events.track()`
      snippet and a copy button.
  - **Footer:** "Last received …" on the left; Close and **Save** (with an
    icon) on the right.
- **Delete** sits in the row's menu. It is disabled with a tooltip while
  sequences use the event, which matches `409 event_definition_in_use`.
- **Send test event** sits in the row's menu, and in the trigger picker
  (see [Testing events](#testing-events)). It opens a dialog:
  - **Header:** the event name.
  - **Body:**
    - the email, prefilled with `test+1@example.com`, with the helper text
      "Test addresses run the sequence without sending mail";
    - the properties as monospace JSON, prefilled;
    - a collapsible "Sending to a real address?" warning that real mail
      will go out.
  - **Footer:** Close and **Send event**.
  - **After sending:** the result shows the new event id with a link to
    the contact.
- **Loading:** `Loading`, centred.
- **Errors:** inline, using the API's error codes.

### Contact detail page (`apps/web/app/(dashboard)/contacts/[contactId]/page.tsx`)

- A new **Events** card goes after Custom fields and before Delivery
  history. It loads **on its own**, not as part of the shared `load()`, so a
  failure doesn't block the page.
  - **Loading:** `Loading`, centred in the card body.
  - **Error:** one sentence and a Retry button.
  - **Empty:** "No events yet", with a link to the Events developer doc.
- **Each row** shows:
  - the name in monospace;
  - `occurredAt` as relative time, with the exact time and the received
    time on hover;
  - a "Backfill" or "Not triggered" badge with text when `triggers` is
    false (colour plus words);
  - links to the sequences it started;
  - a collapsible with the properties as monospace JSON and a copy button.
- **"Load more"** fetches the next page. While it loads, the button is
  disabled and `Loading` shows below the list.
- Merging events and deliveries into one timeline is in Future work.

## MCP, SDK and docs

- **MCP** (`src/mcp/tools/events.ts`, registered in `server.ts`, with
  entries in `toolPolicies` in `policy.ts`):

  | Tool                    | Scope            | Input                          | Output                     |
  | ----------------------- | ---------------- | ------------------------------ | -------------------------- |
  | `track_event`           | `contacts:write` | The `POST /events` body (all fields, `createContact` and `backfill` included) | The `POST /events` response |
  | `list_event_definitions`| `contacts:read`  | none                           | The `GET /events/definitions` response |
  | `get_event_definition`  | `contacts:read`  | `{ name }`                     | The `GET /events/definitions/:name` response |
  | `create_event_definition` | `contacts:write` | The `POST /events/definitions` body | The `201` response |
  | `update_event_definition` | `contacts:write` | `{ name, description?, properties? }` | The `PATCH` response |
  | `delete_event_definition` | `contacts:write` | `{ name }`                     | `{ deleted: true }`        |
  | `get_contact_events`    | `contacts:read`  | `{ contactId, page?, limit?, name? }` | The `GET /contacts/:contactId/events` response |

  - The tools reuse the contacts scopes. Events are contact data, and a new
    `events:*` scope would mean changes in `better-auth.ts`,
    `mcp/routes.ts`, `scripts/token.ts` and `mcp.mdx`.
  - Errors use `errorResult`/`NOT_FOUND`/`planGateResult`. Telemetry
    `source` is `mcp.track_event`.
  - Every new contract route needs a `required(...)` entry in
    `mcp-parity.ts`: `events.track`, `events.definitions`,
    `events.definition`, `events.createDefinition`,
    `events.updateDefinition`, `events.deleteDefinition` and
    `contacts.events`. `parity.test.ts` enforces this.
  - `update_sequence` uses the contract trigger schemas and documents
    `event:custom`, `triggerFilter`, `reentry` and `reentryPeriodDays`.
- **SDK** (`packages/sendlit`):
  - New `resources/events.ts`:
    - `track(input)`, where the input is the `POST /events` body, with
      `retrySafe: !!idempotencyKey`;
    - `definitions.list()`, `definitions.get(name)`,
      `definitions.create(input)`, `definitions.update(name, input)` and
      `definitions.delete(name)`.
  - `contacts.events(contactId, query)`.
  - Rows in `resources.test.ts`, a retry test in `client.test.ts`, the
    README resources table, and a minor changeset (0.2.0 → 0.3.0).
  - #136 suggests `track(contactId | email, eventName, properties)`. We use
    a single object, the same as `emails.send`, so `idempotencyKey`,
    `createContact`, `contact` and `backfill` fit naturally.
- **Docs** (`apps/docs`). Each PR documents what it ships.
  - New `developers/events.mdx`, added to `meta.json`. It covers:
    - an **Integration flow** section:
      1. Send events from your backend with `events.track()`. Nothing has
         to be defined in SendLit first.
      2. The first event with a new name registers it, along with its
         property keys and an example payload. You can also register it
         ahead of time on the Events page, or from the trigger picker.
      3. Build a sequence on "Custom event". Pick the name, or type one
         that hasn't been sent yet so you can build ahead of launch. Add
         property filters and `{{ event.* }}` merge tags.
      4. Activate it. Each matching event from then on enrolls the contact.
      5. Test it with **Send test event**, or by calling the API for an
         `@example.com` address. The sequence runs but no mail is sent.

      The section also says:
      - **Events are never applied retroactively.** Events received before
        a sequence is activated, or while it is paused, don't enroll
        anyone later.
      - **Names are case-sensitive.** An event no active sequence listens
        for is stored, returns `202`, and counts toward the 500-name limit.
    - tracking an event;
    - idempotency;
    - `createContact` and `contact`;
    - backfilling history;
    - limits;
    - a CourseLit example;
    - a "Coming from Loops / Klaviyo" table mapping their fields to ours.
  - `email-marketing/sequences.mdx`: the trigger list, property filters,
    re-entry, the paused-sequence behaviour, and `{{ event.* }}`.
  - `sdk.mdx`, `mcp.mdx` (tools and limits), `errors.mdx` (new codes), and
    `email-blocks/trigger-picker.mdx`.
  - The API reference is generated from the contract.

## Observability

Telemetry goes through `src/observability`. **We never send event names,
property keys or values.** They are defined by the customer and can hold
personal data.

- **`custom_event_received`**, sent with source `events.track` (REST) or
  `mcp.track_event`. Its properties:
  - `duplicate`
  - `contact_created`
  - `backfill`
  - `stale`
  - `sequences_enrolled` (a count)
  - `event_source` (`api` | `session` | `mcp`)
- **`contact_enrolled_in_sequence`** (existing) now also covers
  `event_type = "event:custom"`. It is only sent for an actual insert.
- **`captureError`** for matching failures (with `error_code`) and sweep
  failures.
- **`PROPERTY_ALLOWLIST`:** add `duplicate`, `contact_created`, `backfill`,
  `stale`, `sequences_enrolled`, `event_source`, `error_code` (if
  missing) and `definition_origin`. No new identifier keys.
- **`event_definition_created`** (with `definition_origin`) and
  **`event_definition_deleted`**, sent from the definitions routes.
- **`email_send_test_address_skipped`**, sent from the send loop (see
  [Test addresses](#test-addresses)).
- **A separate commit in PR 3:** add `txe_id` and `delivery_source`. They
  are sent already but missing from the allowlist, so they are dropped
  today.

## Rollback

Every schema change only adds things, so the previous release keeps working
on the new schema. If we roll back:

- The old `fireEvent` never matches `event:custom` rules, so those
  sequences stop enrolling. Contacts already enrolled keep receiving emails,
  but `{{ event.* }}` renders empty.
- The old dashboard shows an unknown trigger type and ignores
  `trigger_filter` and `reentry`. Saving the sequence there leaves the
  columns as they are.
- `once` / `once_per_period` aren't enforced. Every sequence behaves as
  `every_time`.

**Runbook:** pause the `event:custom` sequences before rolling back, and
resume them after rolling forward. There is no down-migration. The new
tables are inert under the old code.

## Phase 2: contact property changed

This ships as its own PR; the schema is already in 0027.

- **Trigger:** `contact:property_changed`. `triggerData` is a **custom
  field** key; built-in fields such as `name` are out of scope.
  `triggerFilter` is `propertyChangeFilterSchema`.
- **Where it fires:** in the after-commit step of `updateContactInTx`. The
  step compares `current.customFields` with the merged row and calls
  `fireEvent` once for each changed key, with eventData set to the key and
  `triggerEvent.properties = { key, from, to }`. Emails can use
  `{{ event.from }}` and `{{ event.to }}`. The callers are:
  - `PATCH /contacts/:id`;
  - MCP `update_contact`;
  - `POST /events` with `contact.customFields`, only when the event's
    `triggers` is true.
- **Where it doesn't fire:** imports (no change there) and `createContact`.
  A contact who didn't exist before is covered by `subscriber:added`.
- **Matching** uses the `from`/`to` rules in [Property filters](#property-filters).
  Re-entry applies as usual.
- **Not stored** in `contact_events`, so system changes don't crowd out the
  customer's own events.
  - So `contact_event_matches` doesn't apply.
  - A retry can't happen, because firing is a one-shot after the commit.
- **UI:** a "Contact property changed" option, with a key Combobox (the
  team's custom field keys) and optional From and To inputs.

## Implementation plan

The work goes in the order `AGENTS.md` asks for: correctness of the ingest
and enrollment path first, then enforcement, then the dashboard, then
operations and docs. Every PR keeps REST, MCP, the generated API reference
and `errors.mdx` in step, and every PR must pass:

- `bun run lint`
- `bun test --parallel`
- `bun run --filter "*/api" check:drift`
- `bun run --filter "*/api" test:conformance`

1. **PR 1: ingest, trigger and re-entry (API).**
   - ADR 0006.
   - Migration 0027, all of it, seeding included. This also moves delivery
     events from `evt_` to `dev_` (see [Data model](#data-model)).
   - The trigger-type constants and lists.
   - The shared schemas, with every cap: payload size, keys, the 500-name
     limit, and `occurredAt`.
   - The contact refactor into `*InTx` plus after-commit steps.
   - `trackEvent` and the routes.
   - `fireEvent` and `enrollContactFromTrigger`.
   - `contact_event_matches`.
   - `sequence_entries` and re-entry.
   - The rule refresh on trigger edits.
   - Backfill and the stale rule.
   - The recovery sweep.
   - The event definitions endpoints, registered by hand or on first
     receipt.
   - The MCP tools and parity entries.
   - Tests:
     - **`events/*.test.ts`:**
       - an unknown email creates the contact by default;
       - `createContact: false` and an unknown `contactId` both return 404;
       - `createContact` fires `subscriber:added` exactly once;
       - `createContact` plus a 422 name cap leaves no contact behind;
       - `backfill` plus `createContact` fires nothing;
       - a replay returns the original event and doesn't apply `contact`
         twice;
       - a `contactId` from another team returns 404;
       - an unsubscribed contact is stored but not enrolled;
       - a stale event is stored but doesn't trigger;
       - `contact.customFields` merges and syncs the custom-field index;
       - concurrent new names stop at 500, counting names registered by
         hand;
       - registering an event by hand, then receiving it, keeps
         `origin = 'manual'` and the declared types, and fills
         `first_seen_at`;
       - deleting an event that a sequence uses returns 409.
     - **`fire-event.test.ts`:**
       - other names and inactive sequences don't enroll;
       - running the sweep again with `every_time` after the contact has
         finished doesn't enroll again;
       - a contact already in the sequence ends up with
         `enrolled = false`;
       - the `once`, `once_per_period` and `every_time` cases in the
         acceptance criteria;
       - the telemetry event is only sent for an actual insert.
     - **`sequences` tests:**
       - a broadcast rejects `event:custom` and `reentry`;
       - a stray `triggerFilter` returns 400;
       - changing the type clears the filter;
       - editing the trigger of an active sequence takes effect
         immediately.
     - **`tools.test.ts`** for the seven MCP tools.
2. **PR 2: filters and merge tags.**
   - `event-filter.ts`, with the table test.
   - `event` / `eventId` in `renderCampaignHtml`, with escaping.
   - Test send, the `evt` view token with its contact check, and the blank
     `event` on the public web version.
   - Test addresses (`isTestAddress` and the skip in `attemptMailSending`).
     This touches the send loop, so it gets its own commit and tests: the
     sequence advances, there is no ESP call, no `reserveSend` and no
     delivery row.
3. **PR 3: enforcement and operations.**
   - The rate limiters, including MCP `highImpactTools`.
   - The retention purges.
   - Telemetry and allowlist entries.
   - The `txe_id`/`delivery_source` allowlist fix, as its own commit.
4. **PR 4: SDK.** `events.track`, `events.definitions.*` and
   `contacts.events`, with tests, the README and a changeset.
5. **PR 5: dashboard.**
   - The trigger picker, the filter editor and "Who can enter".
   - The sequence editor wiring, including the empty-value fix.
   - The Events card.
   - The Events page, with the create/edit dialog and the
     "Send test event" dialog.
   - "Create event" and "Send test event" in the trigger picker.
   - Editor variable hints.
   - The test-send dialog context.
   - A browser smoke test with `bun run dev:api` and `bun run dev:web`.
6. **PR 6: product docs.** `events.mdx`, `sequences.mdx` and
   `trigger-picker.mdx`. Reference docs ship with each PR before this one.
7. **PR 7 (phase 2):** `contact:property_changed`.
8. **Follow-up, in the release after PR 1:** a migration that renames any
   leftover `evt_` delivery-event ids and tightens
   `email_delivery_events_event_id_check` to `^dev_`.

## Acceptance criteria

Mapped from #136, plus the decisions above.

**Ingest**
- [ ] `POST /events` with a known email returns 202 and stores the event. It
      enrolls the contact in every active `event:custom` sequence with that
      name whose trigger filter, audience filter, exclude filter and
      re-entry setting all allow it.
- [ ] Events with other names, and sequences that aren't `active`,
      including paused ones, enroll nobody. Unsubscribed contacts are
      stored and not enrolled.
- [ ] An unknown email, with `createContact` left at its default (`true`),
      creates the contact with
      `contact.name`/`customFields`, `subscriber:added` fires exactly once,
      and the contact is enrolled. A plan limit returns 402 and stores
      nothing. With `createContact: false`, an unknown email returns
      `404 contact_not_found`. An unknown `contactId` always returns 404.
- [ ] `contact.customFields` is merged into an existing contact, and
      `email`/`subscribed`/`tags` can't be set through `contact`.
- [ ] The same `idempotencyKey` twice within 30 days stores one event,
      enrolls once, applies `contact` once, and returns the original
      `eventId` with `duplicate: true`.
- [ ] `backfill: true`, or an `occurredAt` more than 72 h in the past,
      stores the event with `triggers: false` and fires nothing, including
      `subscriber:added` for a contact it created.
- [ ] Caps: oversized or invalid properties return 400. A 501st name
      returns `422 event_name_limit_reached` and creates nothing. A
      700-request burst from one team returns 429 with `Retry-After`.

**Matching and re-entry**
- [ ] A trigger filter matches only when the properties match: `plan is pro`,
      `amount gt 100` (including when the dashboard stores `"100"`), and
      `is_not` on a missing key matches.
- [ ] `once`: a contact who has finished the sequence isn't enrolled by a
      later event. `once_per_period` (7 days): refused on day 3, enrolled on
      day 8. `every_time`: enrolled again after finishing. In every mode, an
      event that arrives while the contact is in the sequence is stored with
      `enrolled = false`.
- [ ] An event whose matching was cut off is matched by the sweep within
      about 3 minutes. Running the sweep again enrolls nobody twice.
- [ ] Editing the trigger of an active sequence takes effect without
      pausing and resuming. Broadcasts reject `event:custom`,
      `triggerFilter` and `reentry`.

**Rendering**
- [ ] `{{ event.<prop> }}` renders, HTML-escaped, in sequence emails, in
      test sends (from the last payload) and in view in browser. A missing
      property renders empty, or the Liquid `default`. A view token whose
      `evt` belongs to another contact renders `{}`.

**Surfaces**
- [ ] The trigger picker, MCP `update_sequence`, `api-contract`/OpenAPI and
      the docs all list `event:custom`. The seven MCP tools pass their auth
      and error tests.
- [ ] `GET /events/definitions` lists names without payloads, and
      `/definitions/:name` returns `lastProperties`.
- [ ] An event can be registered by hand, with a description and typed
      properties, from the Events page or the trigger picker, before any
      event is sent. It counts toward the 500-name limit. It can't be
      deleted while a sequence uses it. Retention never purges it.
- [ ] "Send test event" sends through `POST /events` and starts matching
      sequences. For a test address (`@example.com`, `@test.com`, `.test`,
      and so on) the sequence runs but nothing reaches the ESP and no send
      is counted.
- [ ] SDK `events.track()` is published with tests and documented in
      `sdk.mdx`. It takes a single object rather than #136's
      positional signature, as decided above.
- [ ] The contact detail page shows each event's name, properties, time,
      a not-triggered badge, and the sequences it started, with loading,
      empty and error states.
- [ ] The retention loop clears idempotency keys after 30 days and deletes
      events after 396 days.

**Phase 2**
- [ ] Changing a custom field through `PATCH /contacts/:id`, MCP
      `update_contact` or `POST /events` `contact` (when the event
      triggers) fires `contact:property_changed`, with optional from/to
      matching. Imports, backfills and `createContact` don't fire it.

## Risks and mitigations

| Risk                                                                  | Mitigation                                                                  |
| --------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Callers put ids in names, and the catalogue grows without limit         | 500-name cap with a clear 422; the docs show the name-plus-properties pattern |
| Inline matching adds latency to `POST /events` for teams with many rules | Indexed SQL match and a single batch load of sequences. `202` lets matching move to a BullMQ `events` queue later. |
| A crash, or a race between instances, during matching                   | `processed_at` and the sweep, with `contact_event_matches` making matching idempotent |
| A typo in an email creates a junk contact (because `createContact` defaults to `true`) | The email must be valid. Callers that only track existing users pass `createContact: false`, and the docs recommend it for them. A contact created this way is an ordinary contact that can be deleted. |
| A one-time historical import emails everyone                            | `backfill` and the 72 h rule fire nothing, contact creation included        |
| Personal data in properties                                             | Not sent to telemetry; deleted with the contact; 396-day retention          |
| HTML injection through properties                                       | `event.*` is escaped when the render context is built                       |
| The `sequence_entries` seed is approximate                              | Documented. `once` is exact from the migration onwards.                     |
| The in-memory rate-limit store with several instances                   | Same as transactional: move to Redis when we scale out                      |

## Decisions

Approved on 2026-10-28. ADR 0006 records all of these together with
"contact-scoped events, not a CDP".

1. **Return 202 without listing enrollments**, which keeps a queue
   possible later.
2. **An idempotency window of at least 30 days, with a silent replay**
   (Customer.io and Klaviyo), not 24 h with `409` (Loops).
3. **`createContact` defaults to `true`**, as in Loops, Klaviyo and Brevo:
   an unknown email creates a subscribed contact. Callers pass `false` to
   get a 404 instead. This differs from #136, which proposed 404 by
   default; we chose to match how the industry works. A `contactId` never
   creates a contact.
4. **`every_time` as the default re-entry**, which is also what tag
   triggers do today.
5. **Backfilled and stale events create or update the contact silently**,
   firing no triggers, the same way imports do.
6. **Reuse the `contacts:*` MCP scopes** instead of adding `events:*`.
7. **Escape only `event.*`** for now. Escaping every Liquid variable is
   separate hardening.
8. **Events are registered as in Loops.** An event is registered on first
   receipt, or by hand from the Events page or from the trigger picker
   ("Create event …"). Events registered by hand count toward the 500-name
   limit, and retention never purges them.
9. **Test events as in Loops.**
   - A "Send test event" button uses the ordinary ingest API.
   - Sequence and broadcast mail to reserved test addresses runs the
     sequence but is never sent.

## Future work

- Segment filters on events, for example "did `course purchased` in the
  last 30 days".
- `POST /events/batch`.
- Date comparisons in property filters.
- Liquid in subject lines.
- `outputEscape` for every campaign Liquid variable.
- A combined activity timeline of events and deliveries.
- A BullMQ `events` queue, if inline matching becomes too slow.
- Replaying events that arrive while a sequence is paused.
- Test addresses for transactional email.
- Integrations that send events in, such as Stripe `payment_failed`.
