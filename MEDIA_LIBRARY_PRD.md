# PRD: Email Media Library and Image Picker

## Objective

Build a first-class media library for SendLit email images so uploaded media can be reused across templates, broadcasts, and sequence emails without being accidentally deleted when one piece of content is removed.

The current image upload integration treats uploaded assets too much like block-owned implementation detail. The target model is that media is a team-scoped asset, and saved email content creates references to that asset.

## Goals

- Let users upload an image from the email editor image block.
- Let users select an existing image from their media library.
- Let users select an external Unsplash image.
- Persist uploaded images in MediaLit and register them in SendLit's own media table.
- Track where media is used across templates, broadcasts, and sequence emails.
- Allow users to manage media from a dedicated dashboard section.
- Prevent accidental deletion of media that is still used by any saved email content.
- Keep the email editor package generic by continuing to accept a custom `uploader` component.

## Non-Goals

- Do not make the email editor package depend on MediaLit or SendLit web APIs.
- Do not auto-delete media assets when a template, broadcast, or sequence email is deleted.
- Do not implement a full digital asset management system in the first version.
- Do not support force-deleting in-use media in the first version unless explicitly approved.
- Do not introduce GraphQL for this feature; use REST APIs and keep OpenAPI documentation and the MCP server in sync.
- Do not store Unsplash or manually entered external image URLs in the media table.

## Users

- Marketers creating templates and campaigns.
- Operators maintaining reusable brand assets.
- Developers embedding the email editor with their own upload flow.

## Assumptions

- SendLit remains multi-tenant, and media belongs to the authenticated team scope.
- MediaLit remains the storage and sealing backend for uploaded files.
- SendLit stores media metadata and references only for MediaLit uploads.
- Unsplash and manually entered external image URLs are not owned by SendLit and do not require cleanup.
- Existing saved email content may already contain MediaLit IDs or direct image URLs and will need backward-compatible handling.

## Existing SendLit Naming Conventions

SendLit already has a clear tenant and ID convention:

- `teams.id` is the internal UUID primary key.
- `teams.teamId` is the public team handle, for example `team_...`.
- Resource tables store `teamId` as a foreign key to `teams.id`.
- API route params and headers use public IDs, then API code resolves them to internal IDs.
- `req.teamId` in API routes is the internal `teams.id`, not the public `teams.teamId`.

The media implementation should follow the same convention. Database rows should use `teamId` for the internal team FK. Public API responses should expose a separate public media handle, for example `med_...`, not the internal UUID.

## Product Experience

### Image Block Picker

When the user clicks the upload button in the image block settings panel, SendLit opens a dialog with three tabs:

- `Upload`
- `Your Media`
- `Unsplash`

The upload button remains the same button rendered by the email editor settings UI. The custom `uploader` supplied by SendLit web controls what happens after that button is clicked.

### Upload Tab

The upload tab keeps the current TUS-based upload experience:

- Drag and drop image.
- Click to browse files.
- Optional caption/alt text input.
- Upload progress.
- Cancel while upload is in progress.
- Clear error state when retrying.

After a successful upload:

- The file is uploaded to MediaLit.
- The selected image is returned to the image block settings.
- The image block stores the selected image URL and alt text.
- No SendLit media row is created yet.
- SendLit creates the media row only after the user saves the edited template, broadcast, or sequence email and the backend successfully seals the referenced MediaLit file.

### Your Media Tab

The Your Media tab lists images already registered in SendLit:

- Search by filename, caption, or alt text.
- Paginate or infinite-load results.
- Select an image to insert into the current image block.

Selecting media from this tab does not re-upload or reseal the image. It only returns the existing media URL and metadata to the image block.

### Unsplash Tab

The Unsplash tab lets users search Unsplash images and insert one directly into the image block.

Selecting an Unsplash image:

- Returns attribution metadata required by Unsplash to the consuming picker UI when needed.
- Returns the image URL and metadata to the image block.

Unsplash images are not sealed through MediaLit and are not stored in the SendLit media table in the first version.

### Media Library Section

Add a dashboard section for managing media:

- List uploaded MediaLit-backed media assets.
- Preview image.
- Edit alt text and caption.
- Show usage count.
- Show where the media is used.
- Delete media only when it is not used by any template, broadcast, or sequence email.

If media is in use, the delete action is disabled and the UI shows the usage locations.

## Data Model

### Media

The media table is the product-owned catalog of reusable uploaded assets. It should only store files uploaded through MediaLit. Unsplash and manually entered external URLs remain plain image block URLs.

Suggested fields:

```ts
interface Media {
    id: string;
    teamId: string;
    mediaId: string;
    url: string;
    thumbnailUrl?: string;
    mediaLitId: string;
    fileName?: string;
    mimeType?: string;
    size?: number;
    width?: number;
    height?: number;
    alt?: string;
    caption?: string;
    createdAt: string;
    updatedAt: string;
}
```

### Media References

Media references record where a media asset is used.

```ts
type MediaReferenceResourceType = "TEMPLATE" | "SEQUENCE_EMAIL";

interface MediaReference {
    id: string;
    teamId: string;
    mediaId: string;
    resourceType: MediaReferenceResourceType;
    resourceInternalId: string;
    resourcePublicId: string;
    parentResourceInternalId?: string;
    parentResourcePublicId?: string;
    createdAt: string;
    updatedAt: string;
}
```

`Media.mediaId` should be a public media handle, for example `med_...`. `Media.id` should remain internal-only, matching the existing schema convention.

`MediaReference.mediaId` should reference `media.id` internally. The public reference fields are for UI display and navigation only.

For `TEMPLATE`, `resourceInternalId` should be `email_templates.id` and `resourcePublicId` should be `email_templates.templateId`.

For `SEQUENCE_EMAIL`, `resourceInternalId` should be `sequence_emails.id` and `resourcePublicId` should be `sequence_emails.emailId`. `parentResourceInternalId` should be `sequences.id` and `parentResourcePublicId` should be `sequences.sequenceId`.

Broadcast email content is stored as a `sequence_emails` row under a `sequences` row with `type = 'broadcast'`, so broadcast usage should be represented as `SEQUENCE_EMAIL` with parent sequence context.

References should be recalculated when email content is saved. They should be removed when the owning template, broadcast, sequence, or sequence email is deleted.

## Email Content Contract

Image block settings should remain storage-agnostic. The generic email editor package should not know about SendLit media IDs, MediaLit IDs, or any persistence model owned by the consuming app.

```ts
interface ImageBlockSettings {
    src?: string;
    alt?: string;
}
```

The email renderer should continue to use `src`. The configured uploader returns image display data to the image block. Any uploaded media identity needed by SendLit should be tracked by the consuming app, not by the generic image block API.

For reconciliation, SendLit can derive uploaded media usage from the selected uploaded image URL, from a URL-to-media mapping maintained by the media table, or from app-level metadata outside the editor package. Unsplash and external images should only use `src` and `alt` and should not participate in cleanup.

## REST API

All endpoints must be scoped to the authenticated team. In API handlers this means using `req.teamId`, which is the internal `teams.id` resolved by `requireTeam`.

### List Media

`GET /media`

Query params:

- `page`
- `pageSize`
- `query`

Response includes media rows and pagination metadata.

### Get Media

`GET /media/:mediaId`

Returns one media row and its usage summary.

### Update Media

`PATCH /media/:mediaId`

Allows updating user-editable metadata:

- `alt`
- `caption`

The initial version should not allow mutating `mediaLitId` or ownership fields.

### Delete Media

`DELETE /media/:mediaId`

Deletion rules:

- If the media has active references, return `409 Conflict`.
- If the media has no active references, delete the SendLit media row and the underlying MediaLit asset.

### Media References

`GET /media/:mediaId/references`

Returns the saved content locations using this media.

### Presigned Upload

Keep the current upload signature endpoint:

`POST /media/presigned`

This endpoint only authorizes upload to MediaLit. It does not create the SendLit media row by itself.

## Reconciliation Rules

Uploading alone does not create a SendLit media row. A file becomes SendLit media only when saved email content references its MediaLit URL and sealing succeeds.

On saving a template, broadcast, or sequence email:

1. Parse the saved email body.
2. Extract MediaLit-backed image URLs from image blocks.
3. For each extracted URL that does not already map to a media row for the authenticated team, seal the MediaLit asset.
4. After seal succeeds, create a `Media` row for that uploaded file.
5. Replace the resource's previous `MediaReference` rows with references to the extracted uploaded media.
6. Save the email body, using the sealed URL returned by MediaLit when it differs from the draft URL.

Replacing references means the submitted email body is the source of truth for that one saved resource. If a template previously referenced media A and B, but the submitted body now references B and C, the save should remove only the template-to-A reference, keep or recreate the template-to-B reference, and add the template-to-C reference. Removing a `MediaReference` must not delete the `Media` row or the MediaLit file.

This can be implemented either as a diff or by deleting all existing references for the saved resource and inserting the newly extracted set inside the same transaction as the content save.

Unsplash and external image URLs are ignored by media reference reconciliation because SendLit does not own or clean up those assets.

On deleting a template, broadcast, sequence, or sequence email:

1. Delete the resource's media reference rows.
2. Do not delete the media rows.
3. Do not delete MediaLit files.

On deleting media from the media library:

1. Check active references.
2. If any references exist, block deletion with `409 Conflict`.
3. If no references exist, delete the product media row and the underlying MediaLit file.

This prevents the case where an email derived from a template deletes an image that is still used by the original template.

On deleting a team:

1. List all MediaLit-backed media rows for the team.
2. Delete each underlying file from MediaLit.
3. Delete the team row.
4. Let database cascades delete the team's `Media` and `MediaReference` rows.

The team deletion path must perform MediaLit cleanup before the team row is deleted because database cascades cannot clean up external storage.

## Package Boundaries

### `packages/email-editor`

- Owns generic image block settings UI.
- Accepts a custom `uploader` component.
- Does not import SendLit web code.
- Does not import MediaLit.
- Does not know about REST APIs.

### `apps/web`

- Owns the image picker dialog.
- Owns MediaLit upload UX.
- Owns Your Media and Unsplash tabs.
- Calls SendLit REST APIs.

### `apps/api`

- Owns REST media endpoints.
- Owns media persistence.
- Owns content reference reconciliation.
- Owns MediaLit server-side sealing/deletion calls.
- Owns matching MCP media tools for clients that use the MCP server.

### `packages/api-contract`

- Owns request and response schemas for media APIs.
- Must stay in sync with `apps/api`.

### MCP Server

- Expose media management operations that match REST where useful:
    - list media
    - get media
    - update media metadata
    - delete unused media
    - list media references
- Do not expose direct file upload through MCP in the first version.
- Preserve the same team scoping and in-use deletion rules as REST.
- Update MCP tool schemas and tests whenever REST media contracts change.

## Testing Strategy

### API Tests

Cover:

- Creating media rows during template, broadcast, or sequence email save.
- Listing media rows by team.
- Updating editable metadata.
- Blocking delete when references exist.
- Deleting unused uploaded media and calling MediaLit deletion.
- Ignoring Unsplash and external URLs during media reference reconciliation.
- Replacing media references when template content changes.
- Removing references when template, broadcast, sequence, or sequence email is deleted.
- Not deleting media assets when content is deleted.
- MCP media tools follow the same team scoping, response shape, and delete semantics as REST.

### Web Tests

Cover:

- Upload tab returns uploaded media to the image block.
- Your Media tab returns selected existing media to the image block.
- Unsplash tab returns selected image data to the image block.
- Delete button is disabled for in-use media in the media library.

### Email Editor Package Tests

Cover:

- Custom uploader receives the current image value.
- Custom uploader can return `src` and `alt`.
- Default prompt upload behavior still works when no uploader is configured.

## Commands

Use these commands while implementing:

```sh
pnpm --filter @sendlit/api test
pnpm --filter @sendlit/api typecheck
pnpm --filter @sendlit/web check-types
pnpm --filter @sendlit/api build
pnpm --filter @sendlit/web build
pnpm lint
```

## Success Criteria

- Clicking the image block upload button opens the tabbed picker.
- Uploading an image creates a MediaLit asset and inserts the URL into the image block.
- Uploading alone does not create a SendLit media row.
- Saving content with an uploaded MediaLit image seals the file, creates the SendLit media row, and creates the media reference.
- Selecting Your Media inserts an existing media item without re-uploading.
- Selecting Unsplash inserts the selected URL without creating a media row.
- Saving email content records accurate media references.
- Deleting templates, broadcasts, sequences, or sequence emails removes references but does not delete media assets.
- Deleting media from the media library is blocked while it is still used.
- Deleting unused uploaded media removes the SendLit media row and the MediaLit asset.
- Deleting a team deletes that team's MediaLit files before database cascades remove media rows and references.
- REST API, OpenAPI docs, and MCP media tools are updated together.
- The email editor package remains reusable without a SendLit or MediaLit dependency.

## Rollout Plan

### Phase 1: Data and API

- Add media and media reference persistence.
- Add REST contracts.
- Add MCP media tools aligned with REST media operations.
- Add CRUD endpoints.
- Update reconciliation to maintain references instead of deleting assets on content deletion.

### Phase 2: Editor Picker

- Refactor the existing email image upload dialog into a tabbed picker.
- Keep the current Upload tab behavior.
- Add Your Media tab backed by the media API.
- Add Unsplash tab that returns a direct external image URL.

### Phase 3: Media Library UI

- Add dashboard media section.
- Add list, search, preview, metadata edit, usage display, and safe delete.

### Phase 4: Migration and Cleanup

- Backfill media rows and references from existing saved email content where possible.
- Keep backward-compatible URL scanning for older saved content.
- Add cleanup for abandoned temporary MediaLit uploads.

## Open Questions

- Should Unsplash require a configured API key before the tab is visible?
- Do we need folders/tags in the first version of the media library?
- Should duplicate uploaded files be deduplicated by hash in a later phase?
- Should the media library support replacing an image in place, or should replacement create a new media row?
