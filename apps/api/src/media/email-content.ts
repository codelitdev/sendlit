import type { Email as EmailContent } from "@sendlit/email-editor";
import { sealMedia } from "./service";
import {
    createUploadedMedia,
    getMediaByMediaLitId,
    replaceMediaReferencesForResource,
    type Media,
    type MediaReferenceResource,
} from "./queries";

interface ExtractedMediaLitImage {
    mediaLitId: string;
    src: string;
    alt?: string;
}

function cloneEmailContent(content?: EmailContent | null): EmailContent | null {
    if (!content) return null;
    return JSON.parse(JSON.stringify(content)) as EmailContent;
}

function numberFromUnknown(value: unknown): number | undefined {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim()) {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : undefined;
    }
    return undefined;
}

export function extractMediaLitIdFromUrl(value: string): string | undefined {
    try {
        const { pathname } = new URL(value);
        const segments = pathname.split("/").filter(Boolean);
        if (segments.length < 2) return;

        const lastSegment = segments[segments.length - 1];
        if (!/^main\.[^/]+$/i.test(lastSegment)) return;

        return segments[segments.length - 2];
    } catch {
        return;
    }
}

export function extractMediaLitImagesFromEmailContent(
    content?: EmailContent | null,
): ExtractedMediaLitImage[] {
    if (!content?.content || !Array.isArray(content.content)) return [];

    const images = new Map<string, ExtractedMediaLitImage>();
    for (const block of content.content) {
        const settings = block?.settings;
        if (!settings || typeof settings !== "object") continue;

        const src = (settings as Record<string, unknown>).src;
        if (typeof src !== "string") continue;

        const mediaLitId = extractMediaLitIdFromUrl(src);
        if (!mediaLitId || images.has(mediaLitId)) continue;

        const alt = (settings as Record<string, unknown>).alt;
        images.set(mediaLitId, {
            mediaLitId,
            src,
            alt: typeof alt === "string" ? alt : undefined,
        });
    }

    return Array.from(images.values());
}

function sealedUrlFromMedia(
    media: Record<string, unknown>,
): string | undefined {
    for (const key of ["file", "url", "src", "original"]) {
        const value = media[key];
        if (typeof value === "string" && value) return value;
    }
}

function thumbnailUrlFromMedia(
    media: Record<string, unknown>,
): string | undefined {
    for (const key of ["thumbnailUrl", "thumbnail", "thumb"]) {
        const value = media[key];
        if (typeof value === "string" && value) return value;
    }
}

function updateImageSrc(
    content: EmailContent | null,
    mediaLitId: string,
    src: string,
) {
    if (!content?.content) return;

    for (const block of content.content) {
        const settings = block.settings as Record<string, unknown> | undefined;
        if (!settings || typeof settings.src !== "string") continue;
        if (extractMediaLitIdFromUrl(settings.src) === mediaLitId) {
            settings.src = src;
        }
    }
}

async function ensureUploadedMedia({
    teamId,
    mediaLitId,
    alt,
}: {
    teamId: string;
    mediaLitId: string;
    alt?: string;
}): Promise<Media> {
    const existing = await getMediaByMediaLitId(teamId, mediaLitId);
    if (existing) return existing;

    const sealed = (await sealMedia(mediaLitId)) as Record<string, unknown>;
    const url = sealedUrlFromMedia(sealed);
    if (!url) {
        throw new Error("medialit_seal_missing_url");
    }

    return createUploadedMedia({
        teamId,
        mediaLitId,
        url,
        thumbnailUrl: thumbnailUrlFromMedia(sealed),
        fileName:
            typeof sealed.fileName === "string"
                ? sealed.fileName
                : typeof sealed.name === "string"
                  ? sealed.name
                  : undefined,
        mimeType:
            typeof sealed.mimeType === "string"
                ? sealed.mimeType
                : typeof sealed.type === "string"
                  ? sealed.type
                  : undefined,
        size: numberFromUnknown(sealed.size),
        width: numberFromUnknown(sealed.width),
        height: numberFromUnknown(sealed.height),
        alt,
        caption: typeof sealed.caption === "string" ? sealed.caption : alt,
    });
}

export async function syncEmailContentMediaReferences({
    teamId,
    content,
    resource,
}: {
    teamId: string;
    content?: EmailContent | null;
    resource: MediaReferenceResource;
}): Promise<EmailContent | null> {
    const mediaLitImages = extractMediaLitImagesFromEmailContent(content);
    const reconciledContent = cloneEmailContent(content);
    const mediaRows: Media[] = [];

    for (const image of mediaLitImages) {
        const row = await ensureUploadedMedia({
            teamId,
            mediaLitId: image.mediaLitId,
            alt: image.alt,
        });
        mediaRows.push(row);
        updateImageSrc(reconciledContent, image.mediaLitId, row.url);
    }

    await replaceMediaReferencesForResource({
        teamId,
        resource,
        mediaRows,
    });

    return reconciledContent;
}
