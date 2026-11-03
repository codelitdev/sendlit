# ADR 0008: Archive sent broadcasts instead of deleting them

Status: accepted
Date: 2026-10-29

## Context

`DELETE /sequences/:sequenceId` deletes a broadcast together with its
delivery, open and click history (#147). ADR 0007 settled deletes for
sequences and left broadcasts to this issue. A broadcast's value after it is
sent is its report and its public web archive page, and the tracker (#152)
says anything that has sent mail is archived rather than deleted.

Mailchimp lets you delete draft and unsent scheduled campaigns, and archives
sent ones: they leave the campaign list but keep their report, and can be
restored. Klaviyo and ActiveCampaign behave similarly for sent campaigns.

## Decision

- A draft broadcast, or a scheduled one whose send time hasn't come, can be
  hard deleted. Its schedule goes with it, and its images follow ADR 0006.
- A broadcast that is sending (active, with its audience locked or its send
  time reached) can't be deleted or archived: `409 sequence_active`.
- Once a broadcast has started sending (sent, or paused mid-send) it can't be
  deleted: `409 broadcast_sent`. The delete statement repeats the check, so a
  broadcast that starts sending in between is kept.
- Such a broadcast can be archived instead (`POST .../archive`, nullable
  `sequences.archived_at`). Archived broadcasts are left out of
  `GET /sequences` unless `archived=only|include`; their report, delivery
  history and images are kept, and `.../unarchive` restores them. A broadcast
  archived while paused mid-send can't resume until it is restored.
- Archived broadcasts leave the public web archive, its RSS feed and sitemap,
  as the issue asks: archiving means "hide this", and an issue the sender
  hid from their own list shouldn't keep being promoted publicly. Unarchiving
  brings the page back if it is still published. Per-recipient "view in
  browser" pages keep working, because they are linked from mail already in
  inboxes.
- Blocker codes stay in `apps/api/src/sequences/delete-blockers.ts`; MCP
  reuses `delete_sequence` and adds `archive_broadcast` and
  `unarchive_broadcast`.

## Consequences

- Sent broadcasts are never hard deleted through the API; their history only
  goes with the team or organization.
- Archive is broadcast-only. Sequences can be given it later without changing
  the delete API (see ADR 0007).
- The column is nullable and additive, so the previous release keeps working
  against the migrated schema (it simply shows archived broadcasts).
