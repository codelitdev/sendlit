# ADR 0006: Delete media with its resource, but never media sent mail shows

Status: accepted
Date: 2026-10-29

## Context

Images in email content are MediaLit files tracked by `media` rows and
`media_references` (one per template or sequence email that uses an image).
Deleting a resource used to remove only its references, so files piled up in
MediaLit and counted against storage forever (#157). But a delete can't
simply remove every file the resource used: sent mail loads its images by
URL from recipients' inboxes and from the "view in browser" page, and other
templates or emails can share a file.

## Decision

- Deleting a template, broadcast, sequence or sequence email deletes the
  media it leaves without references, in MediaLit and in the database
  (`deleteOrphanedMedia` in `apps/api/src/media/queries.ts`). New deletes
  under #152 reuse it.
- Media used by sent mail is kept: an email with a delivery or a stored
  content version keeps its images, a template a transactional email was
  sent with keeps its images, and media any stored sent content shows is
  never purged. These images stay in the media library, unreferenced, until
  the user deletes them there. There is no grace period: drafts were never
  seen by anyone, and sent mail is kept outright.
- Editing content never deletes media. A removed image may be in sent
  versions, or be added back; the media library is the place to delete it.
  This matches Mailchimp's and Klaviyo's content libraries, where removing an
  image from a campaign leaves the file in place.
- Archiving a team keeps its media, because archived teams can be restored.
  Organization deletion (and account deletion, #134) purges every file of its
  teams.
- A file another team also holds a row for is never deleted from MediaLit.
- MediaLit failures never fail or roll back the delete. The row goes first,
  the error goes to `captureError`, and the MediaLit delete is retried from
  the `media-deletion` BullMQ queue.

## Consequences

Storage for drafts and unsent content is reclaimed when they are deleted.
Hard-deleting sent content still leaves its images, so inboxes keep working;
those files only go when the user deletes them in the media library or the
organization is deleted. Files orphaned before this change are not cleaned
up automatically.
