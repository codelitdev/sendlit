# Automation pipeline: scale review (small/medium workloads)

_Review date: 2026-07-04. Scope: the trigger → enrollment → send pipeline
(`src/automation/*`, `src/mail/sequence-queue.ts`, `src/mail/sequence-worker.ts`,
`src/mail/send.ts`)._

**Verdict:** the architecture (poll-scheduler + durable BullMQ queue + idempotent
enrollment) is the right shape through medium scale (broadcasts of ~10k+,
multi-step sequences under load). The findings below were identified before
pointing real medium-sized workloads at it. Statuses reflect what has been
fixed vs. deliberately accepted.

## Pipeline recap

1. **Trigger** — event-driven (`fire-event.ts`, called synchronously on tag/contact
   events) or date-based (`process-rules.ts`, 60s polling loop for `DATE_OCCURRED`
   broadcast rules). Both insert rows into `ongoing_sequences` (one row per
   contact-in-a-sequence).
2. **Scheduler** — `process-ongoing-sequences.ts` polls every 60s for rows whose
   `nextEmailScheduledTime` has passed and enqueues each onto the BullMQ
   `sequence` queue.
3. **Worker** — `sequence-worker.ts` → `process-ongoing-sequence.ts`: checks quota,
   picks the next published/unsent email, renders (Liquid merge tags + open pixel
    - click-tracked links), sends via `sendMail()`, records an `email_deliveries`
      row, and either schedules the next email or deletes the row (marking a
      broadcast `sent` once every recipient is delivered).

## What was already solid

- **Idempotent enrollment**: unique index on `(sequence_id, contact_id)` plus
  `onConflictDoNothing` means a crash between enrollment and `deleteRule` in
  `process-rules.ts` re-runs harmlessly.
- **Durable sends**: scheduler/worker decoupling via BullMQ means sends survive
  process restarts.
- **Retry model**: on send failure the row stays due with `retryCount`
  incremented, so it is retried on a later poll until `sequenceBounceLimit` —
  a reasonable poor-man's backoff.
- Both polling loops swallow per-item errors, so one bad row cannot stall a tick.

## Findings

### 1. Duplicate enqueues → premature sends in multi-step sequences — **Fixed**

The scheduler re-enqueued **every still-due row on every 60s poll** with no
`jobId`, so BullMQ did not deduplicate. Whenever the worker backlog exceeded
60s (any broadcast beyond a few hundred recipients), the queue filled with
duplicate jobs for the same `ongoingSequenceId`.

- Broadcasts self-healed: the row is deleted after the send, so a duplicate job
  hit the `if (!ongoingSequence) return` guard.
- Multi-step sequences did **not**: `processOngoingSequence` never re-checked
  that the row was actually due. A duplicate job arriving after the first one
  advanced `nextEmailScheduledTime` found email #1 in `sentEmailIds`, picked
  email #2 as "next", and sent it immediately — skipping its configured delay.

**Fix (both halves applied):**

- `jobId: ongoingSequence.id` on `sequenceQueue.add()` — BullMQ drops adds whose
  id is already waiting/active/delayed, so a row is never queued twice at once.
- Dueness guard at the top of `processOngoingSequence`
  (`nextEmailScheduledTime > Date.now()` → return). This is the true safety
  net: it also protects against races if a second worker/instance ever runs.

### 2. Throughput ceiling (~1–3 emails/sec) — **Fixed**

The BullMQ `Worker` used the default concurrency of 1, and each job does
~5 sequential DB queries, a JSDOM parse, and an SMTP send over a **non-pooled**
nodemailer transport (a fresh SMTP connection per message). A 10k broadcast
would take 1–3 hours.

**Fix:**

- Worker `concurrency: 10`.
- `pool: true, maxConnections: 5` on per-team ESP transporters
  (`mail/transport.ts` — these are already cached per team, so pooling them is
  safe).

Note: concurrency > 1 makes finding #1's fix a **prerequisite** — without jobId
dedup + the dueness guard, duplicate jobs for the same row could run
simultaneously and double-send.

### 3. Unbounded Redis growth — **Fixed**

`sequenceQueue.add()` passed no job options and the Queue had no
`defaultJobOptions`, so every completed job was kept in Redis forever (BullMQ's
default). Combined with finding #1, a single 10k broadcast could leave tens of
thousands of dead job hashes behind.

**Fix:** `defaultJobOptions: { removeOnComplete: true, removeOnFail: 5000 }` on
the Queue constructor. `removeOnComplete` must be `true` (remove immediately)
rather than a keep-count: jobs are keyed by ongoing-sequence row id for dedup
(finding #1), and BullMQ silently ignores an `add` whose jobId still exists in
the completed set — a lingering completed job would block that row's next email
tick or retry. Send history lives in logs and `email_deliveries` instead.

### 4. No index on `next_email_scheduled_time` — **Fixed**

`getDueOngoingSequences` full-scanned `ongoing_sequences` every minute. The
table stays small because completed rows are deleted, but large long-running
sequence campaigns keep many rows resident.

**Fix:** added a b-tree index on `next_email_scheduled_time` (drizzle migration).

### 5. `countOngoingSequencesForSequence` loaded every row — **Fixed**

It selected all rows for the sequence and returned `rows.length`. After a
broadcast to N contacts, early cleanup calls pulled thousands of rows just to
count them.

**Fix:** use SQL `count()`.

## Test coverage

The pipeline is covered by a vitest suite (`pnpm test`) running against an
in-memory PGlite Postgres with the real drizzle migrations applied (see
`src/test/db.ts`), so unique indexes, `onConflictDoNothing`, and `jsonb_set`
behave exactly as in production. Only `sendMail` and the BullMQ queue are
mocked. Covered: the dueness guard (finding #1's regression), send + delivery
recording + follow-up scheduling, rendering (merge tags, pixel, click-tracked
links), broadcast completion, quota skip, missing-contact cleanup, retry and
bounce-limit handling, enrollment idempotency, due-row selection, jobId-keyed
enqueueing, and event-triggered enrollment (`fire-event.ts`).

One behavior the tests surfaced: `markBroadcastSent`'s
`jsonb_set(report, '{broadcast,sentAt}', …)` silently no-ops unless
`report.broadcast` already exists — which `lockBroadcast` guarantees in the
real flow (`processRule` locks before any delivery). If broadcasts ever get a
second enrollment path that skips `lockBroadcast`, `sentAt` would never be
recorded (status would still flip to `completed`).

## Accepted limitations (documented, not fixed)

- **Single-instance assumption.** The polling loops run inside the API process
  (`startAutomation()` in `index.ts`). Running a second API instance would
  double every enqueue; the jobId dedup and dueness guard make this safe-ish,
  but the design assumes one instance. JSDOM rendering is also CPU work on the
  API's event loop — during a big broadcast, API latency will degrade. When
  "medium" becomes "large", move the scheduler + worker into a separate process.
- **At-least-once delivery.** A crash between `sendMail()` succeeding and the
  `sentEmailIds` update landing re-sends that email on restart. Standard for
  email pipelines; a transactional outbox is not worth it at this scale.
- **Quota check is check-then-act.** `hasMailQuotaRemaining` →
  `incrementMailCount` is not atomic, so a team can overshoot its quota by
  roughly the worker concurrency (≤10 emails). Cosmetic.
- **`getDueOngoingSequences` is unbounded.** All due rows are loaded per poll.
  Fine at this scale since jobId dedup caps queue growth; add a `LIMIT` +
  cursor if tables ever reach 100k+ due rows.
