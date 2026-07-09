import { and, count, desc, eq, ilike, or } from "drizzle-orm";
import { db } from "../db/client";
import { media, mediaReferences } from "../db/schema";
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
            and(
                eq(mediaReferences.teamId, teamId),
                eq(mediaReferences.mediaId, row.id),
            ),
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
                eq(
                    mediaReferences.resourceInternalId,
                    resource.resourceInternalId,
                ),
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

export async function deleteMediaReferencesForResource({
    teamId,
    resourceType,
    resourceInternalId,
}: {
    teamId: string;
    resourceType: MediaReferenceResourceType;
    resourceInternalId: string;
}): Promise<void> {
    await db
        .delete(mediaReferences)
        .where(
            and(
                eq(mediaReferences.teamId, teamId),
                eq(mediaReferences.resourceType, resourceType),
                eq(mediaReferences.resourceInternalId, resourceInternalId),
            ),
        );
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
            and(
                eq(mediaReferences.teamId, teamId),
                eq(mediaReferences.mediaId, row.id),
            ),
        );
    if ((referenceCount?.value ?? 0) > 0) return "in_use";

    await deleteMediaFile(row.mediaLitId);
    await db
        .delete(media)
        .where(and(eq(media.teamId, teamId), eq(media.id, row.id)));
    return "deleted";
}

export async function deleteTeamMediaFiles(teamId: string): Promise<void> {
    const rows = await db
        .select({ mediaLitId: media.mediaLitId })
        .from(media)
        .where(eq(media.teamId, teamId));

    for (const row of rows) {
        await deleteMediaFile(row.mediaLitId);
    }
}
