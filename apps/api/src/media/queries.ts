import { and, count, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import { db } from "../db/client";
import { emailContentVersions, media, mediaReferences } from "../db/schema";
import { captureError } from "../observability";
import { queueMediaLitDeletion } from "./deletion-queue";
import { deleteMedia as deleteMediaFile } from "./service";

export type Media = typeof media.$inferSelect;
export type MediaReference = typeof mediaReferences.$inferSelect;
export type MediaReferenceResourceType = "TEMPLATE" | "SEQUENCE_EMAIL";

export interface MediaReferenceResource {
  resourceType: MediaReferenceResourceType;
  resourceInternalId: string;
  resourcePublicId: string;
  parentResourceInternalId?: string;
  parentResourcePublicId?: string;
}

export async function getMediaByMediaLitId(
  teamId: string,
  mediaLitId: string,
): Promise<Media | null> {
  const [row] = await db
    .select()
    .from(media)
    .where(and(eq(media.teamId, teamId), eq(media.mediaLitId, mediaLitId)))
    .limit(1);
  return row ?? null;
}

export async function getMediaByMediaId(
  teamId: string,
  mediaId: string,
): Promise<Media | null> {
  const [row] = await db
    .select()
    .from(media)
    .where(and(eq(media.teamId, teamId), eq(media.mediaId, mediaId)))
    .limit(1);
  return row ?? null;
}

export async function createUploadedMedia({
  teamId,
  mediaLitId,
  url,
  thumbnailUrl,
  fileName,
  mimeType,
  size,
  width,
  height,
  alt,
  caption,
}: {
  teamId: string;
  mediaLitId: string;
  url: string;
  thumbnailUrl?: string;
  fileName?: string;
  mimeType?: string;
  size?: number;
  width?: number;
  height?: number;
  alt?: string;
  caption?: string;
}): Promise<Media> {
  const [row] = await db
    .insert(media)
    .values({
      teamId,
      mediaLitId,
      url,
      thumbnailUrl,
      fileName,
      mimeType,
      size,
      width,
      height,
      alt,
      caption,
    })
    .onConflictDoUpdate({
      target: [media.teamId, media.mediaLitId],
      set: {
        url,
        thumbnailUrl,
        fileName,
        mimeType,
        size,
        width,
        height,
        alt,
        caption,
        updatedAt: new Date(),
      },
    })
    .returning();
  return row;
}

export async function listMedia({
  teamId,
  query,
  page = 1,
  pageSize = 20,
}: {
  teamId: string;
  query?: string;
  page?: number;
  pageSize?: number;
}): Promise<Media[]> {
  const conditions = [eq(media.teamId, teamId)];
  if (query?.trim()) {
    const pattern = `%${query.trim()}%`;
    conditions.push(
      or(
        ilike(media.fileName, pattern),
        ilike(media.alt, pattern),
        ilike(media.caption, pattern),
      )!,
    );
  }

  return db
    .select()
    .from(media)
    .where(and(...conditions))
    .orderBy(desc(media.createdAt))
    .limit(pageSize)
    .offset((Math.max(page, 1) - 1) * pageSize);
}

export async function countMedia({
  teamId,
  query,
}: {
  teamId: string;
  query?: string;
}): Promise<number> {
  const conditions = [eq(media.teamId, teamId)];
  if (query?.trim()) {
    const pattern = `%${query.trim()}%`;
    conditions.push(
      or(
        ilike(media.fileName, pattern),
        ilike(media.alt, pattern),
        ilike(media.caption, pattern),
      )!,
    );
  }

  const [row] = await db
    .select({ value: count() })
    .from(media)
    .where(and(...conditions));
  return row?.value ?? 0;
}

export async function updateMediaMetadata({
  teamId,
  mediaId,
  alt,
  caption,
}: {
  teamId: string;
  mediaId: string;
  alt?: string | null;
  caption?: string | null;
}): Promise<Media | null> {
  const patch: Partial<typeof media.$inferInsert> = { updatedAt: new Date() };
  if (alt !== undefined) patch.alt = alt || null;
  if (caption !== undefined) patch.caption = caption || null;

  const [row] = await db
    .update(media)
    .set(patch)
    .where(and(eq(media.teamId, teamId), eq(media.mediaId, mediaId)))
    .returning();
  return row ?? null;
}

export async function listMediaReferences({
  teamId,
  mediaId,
}: {
  teamId: string;
  mediaId: string;
}): Promise<MediaReference[] | null> {
  const row = await getMediaByMediaId(teamId, mediaId);
  if (!row) return null;

  return db
    .select()
    .from(mediaReferences)
    .where(
      and(eq(mediaReferences.teamId, teamId), eq(mediaReferences.mediaId, row.id)),
    );
}

export async function replaceMediaReferencesForResource({
  teamId,
  resource,
  mediaRows,
}: {
  teamId: string;
  resource: MediaReferenceResource;
  mediaRows: Media[];
}): Promise<void> {
  await db
    .delete(mediaReferences)
    .where(
      and(
        eq(mediaReferences.teamId, teamId),
        eq(mediaReferences.resourceType, resource.resourceType),
        eq(mediaReferences.resourceInternalId, resource.resourceInternalId),
      ),
    );

  const uniqueMediaRows = Array.from(
    new Map(mediaRows.map((row) => [row.id, row])).values(),
  );
  if (!uniqueMediaRows.length) return;

  await db.insert(mediaReferences).values(
    uniqueMediaRows.map((row) => ({
      teamId,
      mediaId: row.id,
      resourceType: resource.resourceType,
      resourceInternalId: resource.resourceInternalId,
      resourcePublicId: resource.resourcePublicId,
      parentResourceInternalId: resource.parentResourceInternalId,
      parentResourcePublicId: resource.parentResourcePublicId,
    })),
  );
}

/** Removes the media references of one or more resources of a type and
 * returns the ids of the `media` rows they pointed at, so the caller can
 * pass them to `deleteOrphanedMedia` once the resource itself is gone. */
export async function deleteMediaReferencesForResource({
  teamId,
  resourceType,
  resourceInternalId,
}: {
  teamId: string;
  resourceType: MediaReferenceResourceType;
  resourceInternalId: string | string[];
}): Promise<string[]> {
  const ids = Array.isArray(resourceInternalId)
    ? resourceInternalId
    : [resourceInternalId];
  if (!ids.length) return [];
  const removed = await db
    .delete(mediaReferences)
    .where(
      and(
        eq(mediaReferences.teamId, teamId),
        eq(mediaReferences.resourceType, resourceType),
        inArray(mediaReferences.resourceInternalId, ids),
      ),
    )
    .returning({ mediaId: mediaReferences.mediaId });
  return Array.from(new Set(removed.map((row) => row.mediaId)));
}

export interface MediaPurgeResult {
  /** Media rows deleted (their MediaLit file deleted or queued). */
  deleted: number;
  /** Of those, files MediaLit failed to delete now; queued for retry. */
  failed: number;
}

/**
 * Deletes a MediaLit file whose last `media` row is gone. Another team can
 * hold a row for the same file (team isolation): then only the row went
 * and the file stays. When MediaLit fails, the delete is queued for retry
 * and the error goes to `captureError`; it never fails the caller.
 */
async function deleteMediaLitFile(
  teamId: string,
  mediaLitId: string,
  source: string,
): Promise<"deleted" | "shared" | "queued"> {
  const [other] = await db
    .select({ id: media.id })
    .from(media)
    .where(eq(media.mediaLitId, mediaLitId))
    .limit(1);
  if (other) return "shared";
  try {
    await deleteMediaFile(mediaLitId);
    return "deleted";
  } catch (error) {
    captureError({
      error,
      source,
      teamId,
      context: { error_code: "medialit_delete_failed" },
    });
    try {
      await queueMediaLitDeletion({ teamId, mediaLitId });
    } catch (queueError) {
      captureError({
        error: queueError,
        source,
        teamId,
        context: { error_code: "medialit_delete_queue_failed" },
      });
    }
    return "queued";
  }
}

/** Whether mail the team already sent shows this file. Sent content is
 * kept in `email_content_versions` (what each recipient got and what the
 * "view in browser" page shows), and inboxes load images by URL. */
async function usedBySentMail(teamId: string, mediaLitId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: emailContentVersions.id })
    .from(emailContentVersions)
    .where(
      and(
        eq(emailContentVersions.teamId, teamId),
        sql`strpos(${emailContentVersions.content}::text, ${`/${mediaLitId}/`}) > 0`,
      ),
    )
    .limit(1);
  return Boolean(row);
}

/**
 * The shared cleanup after a resource's media references are removed
 * (#157): deletes each given `media` row of the team that now has no
 * references and isn't shown by sent mail, along with its MediaLit file.
 * Rows still referenced elsewhere, or used by sent mail, stay in the media
 * library. Never touches another team's rows.
 */
export async function deleteOrphanedMedia(
  teamId: string,
  mediaIds: string[],
): Promise<MediaPurgeResult> {
  const result: MediaPurgeResult = { deleted: 0, failed: 0 };
  if (!mediaIds.length) return result;

  const rows = await db
    .select({ id: media.id, mediaLitId: media.mediaLitId })
    .from(media)
    .where(and(eq(media.teamId, teamId), inArray(media.id, mediaIds)));
  for (const row of rows) {
    const [referenced] = await db
      .select({ id: mediaReferences.id })
      .from(mediaReferences)
      .where(eq(mediaReferences.mediaId, row.id))
      .limit(1);
    if (referenced) continue;
    if (await usedBySentMail(teamId, row.mediaLitId)) continue;

    const [removed] = await db
      .delete(media)
      .where(and(eq(media.teamId, teamId), eq(media.id, row.id)))
      .returning({ id: media.id });
    if (!removed) continue;
    result.deleted += 1;
    const outcome = await deleteMediaLitFile(
      teamId,
      row.mediaLitId,
      "media.delete_orphaned",
    );
    if (outcome === "queued") result.failed += 1;
  }
  return result;
}

export async function deleteUnusedMedia(
  teamId: string,
  mediaId: string,
): Promise<"deleted" | "in_use" | "not_found"> {
  const row = await getMediaByMediaId(teamId, mediaId);
  if (!row) return "not_found";

  const [referenceCount] = await db
    .select({ value: count() })
    .from(mediaReferences)
    .where(
      and(eq(mediaReferences.teamId, teamId), eq(mediaReferences.mediaId, row.id)),
    );
  if ((referenceCount?.value ?? 0) > 0) return "in_use";

  await deleteMediaFile(row.mediaLitId);
  await db.delete(media).where(and(eq(media.teamId, teamId), eq(media.id, row.id)));
  return "deleted";
}

/** Deletes every `media` row of a team (their references cascade) and
 * its MediaLit files, for team purges (organization and account deletion).
 * Files another team also uses are kept. A file MediaLit fails to delete is
 * queued for retry (`failed` counts them) and the error goes to
 * `captureError`, so the database never points at a missing file. */
export async function deleteTeamMediaFiles(teamId: string): Promise<MediaPurgeResult> {
  const rows = await db
    .delete(media)
    .where(eq(media.teamId, teamId))
    .returning({ mediaLitId: media.mediaLitId });

  const result: MediaPurgeResult = { deleted: rows.length, failed: 0 };
  for (const row of rows) {
    const outcome = await deleteMediaLitFile(
      teamId,
      row.mediaLitId,
      "media.delete_team_files",
    );
    if (outcome === "queued") result.failed += 1;
  }
  return result;
}
