# ADR 0007: Delete paused sequences with their history; archive is for broadcasts

Status: accepted
Date: 2026-10-29

## Context

`DELETE /sequences/:sequenceId` had no status guard (#148). Deleting a
sequence cascades through `ongoing_sequences`, `rules`, `sequence_entries`,
`email_deliveries` and `email_events`, so deleting an active sequence dropped
contacts mid-flow, and deleting one that had sent mail silently removed its
stats. We had to choose between archiving a sequence that has sent mail
(stats kept, hidden from the list) and hard deleting it after an explicit
warning.

Email marketing platforms treat automations and campaigns differently:

- Mailchimp Customer Journeys and ActiveCampaign automations must be paused
  or turned off before they can be deleted, and deleting removes the
  automation together with its contacts' progress and its reporting.
  Klaviyo deletes flows the same way, after a confirmation.
- Sent campaigns, by contrast, are archived or kept for their report and
  public archive page (Mailchimp's campaign archive).

A sequence's value is the running automation, not a one-off report, and a
paused sequence already keeps its stats for as long as anyone wants them.

## Decision

- An active broadcast or sequence can't be deleted: `409 sequence_active`.
  Pausing stops sends first. The check is repeated in the delete statement,
  so one started in between is kept.
- A paused, draft or completed sequence is hard deleted, with its emails,
  triggers, enrollments, and delivery, open and click history. Before
  confirming, the dashboard and MCP show what goes with it:
  `GET /sequences/:sequenceId/deletion-preview` returns the enrolled-contact
  and sent-email counts, and the dialog says the stats can't be recovered.
  Pausing remains the way to stop a sequence and keep its numbers.
- Records that protect sending are kept: `outbound_messages` (its link to
  the delivery is set null), suppressions and the contacts themselves.
- Media follows ADR 0006: images of sent emails are kept, the rest is
  deleted when nothing else uses it.
- Blocker codes live in `apps/api/src/sequences/delete-blockers.ts`, shared
  by REST, MCP and the dashboard. Broadcasts use the same table and delete
  path; #147 adds archive for sent broadcasts and its own blocker there,
  rather than a separate mechanism.

## Consequences

- No new column or "Archived" filter for sequences; deleted sequences are
  gone, and so are their per-sequence stats.
- A deleted sequence's sends still count against plan usage, because usage
  is counted from `outbound_messages` and usage buckets, not `email_deliveries`.
- If customers ask to keep automation reports after deletion, archive can be
  extended from broadcasts (#147) to sequences without changing this API.
