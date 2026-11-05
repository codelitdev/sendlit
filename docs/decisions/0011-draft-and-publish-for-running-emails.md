# ADR 0011: Draft and publish for emails of running broadcasts and sequences

Status: accepted
Date: 2026-11-05

## Context

Saving an email of an active sequence or a scheduled broadcast wrote straight
to the version that sends use (#184). Contacts reaching that step got
half-finished edits, typos and broken merge tags right away, and the only
workaround was to pause, edit and resume.

Mailchimp, Kit, Customer.io, Braze and HubSpot all separate a working draft
from the published version and make going live an explicit step. Many let
the sender choose whether a change reaches contacts already in a journey or
only new entrants.

## Decision

- `sequence_emails.subject` and `content` stay the **published** version.
  Sends, the previous release and every reader of those columns keep working
  unchanged. Nullable `draft_subject`, `draft_content` and `draft_updated_at`
  hold the working draft; both draft columns are set together or both null.
- Draft mode applies while a broadcast or sequence is `active`: a running
  sequence or a scheduled broadcast. A draft or paused one sends nothing, so
  edits save directly, as before, folding in any draft left from while it
  was active. Drafting while paused was rejected: the dashboard treats a
  cancelled schedule as a draft again and reschedules it with `start`, and an
  auto-paused send is fixed by editing its content and resuming, so both
  would silently send the old version. Resuming already rescans content.
- A draft equal to the published version is dropped, so "unpublished
  changes" always means the two differ.
- Only subject and content are drafted: that is what a contact sees. Delay,
  the step's `published` switch and tag actions still apply on save, like a
  journey's structure in other tools.
- `POST /sequences/:id/publish-changes` (optional `emailIds`, `scope`) moves
  drafts live; `discard-changes` drops them. Publishing runs the hosted
  content scan that saving used to run, and refuses a broadcast that has
  started sending. The publish is guarded on `draft_updated_at`, so an edit
  saved during it stays a draft instead of going live unscanned.
- History reuses `email_content_versions` (already one immutable row per
  distinct content, written at send time) with a new `published_at`. A
  publish stamps the new version and records the one it replaces. `GET
  .../emails/:emailId/versions` lists them, live first; `.../restore` loads a
  version into the draft, so a rollback is published like any other change.
- `scope: "new_entrants"` writes `ongoing_sequences.pinned_versions`
  (`emailId` to the replaced version's id) for contacts who haven't had that
  email yet, in one statement. The send path renders a pinned version when
  there is one. `in_flight` (the default, as the issue asks) removes pins
  for that email, so everyone gets the new version at their next step.
- Test sends use the draft, so changes can be checked before publishing.
- The REST API, SDK and MCP all save to the draft by default; MCP gets
  `publish_sequence_changes`, `discard_sequence_changes` (destructive),
  `list_sequence_email_versions` and `restore_sequence_email_version`, so an
  agent can't change what contacts receive without an explicit publish.

## Consequences

- Draft edits keep the published version's images referenced, so the media
  library can't delete an image a live email still shows.
- Resuming a sequence paused with an open draft does not publish it. The
  dashboard shows "Unpublished changes" and, for a scheduled broadcast, warns
  that the published version will send.
- A broadcast's title is its published subject. While it's scheduled, a new
  title is saved as the draft subject and becomes the title on publish, so a
  sent broadcast (its list entry, report and web archive page) never shows a
  title it wasn't sent with.
- When a broadcast starts sending (`lockBroadcast`), its open draft is
  dropped: it can never go out, and leaving it would offer a Publish that
  can only fail.
