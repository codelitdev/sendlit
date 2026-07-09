import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
    countMedia,
    deleteUnusedMedia,
    getMediaByMediaId,
    listMedia,
    listMediaReferences,
    updateMediaMetadata,
} from "../../media/queries";
import {
    AUTH_ERROR,
    INTERNAL_ERROR,
    NOT_FOUND,
    errorResult,
    jsonResult,
} from "./responses";
import {
    mediaListSchema,
    mediaReferenceListSchema,
    mediaSchema,
    successMessageSchema,
} from "./schemas";
import { getTeamId } from "./auth";
import { omitInternal } from "../../utils/public";

function toPublicMedia(row: Record<string, unknown>) {
    return omitInternal(row);
}

function toPublicReference(reference: {
    resourceType: string;
    resourcePublicId: string;
    parentResourcePublicId?: string | null;
    createdAt?: Date | null;
    updatedAt?: Date | null;
}) {
    return {
        resourceType: reference.resourceType,
        resourcePublicId: reference.resourcePublicId,
        parentResourcePublicId: reference.parentResourcePublicId,
        createdAt: reference.createdAt,
        updatedAt: reference.updatedAt,
    };
}

export function registerMediaTools(server: McpServer): void {
    server.registerTool(
        "list_media",
        {
            description:
                "Returns uploaded MediaLit-backed media for the team. Unsplash and external URL images are not stored here.",
            inputSchema: {
                query: z.string().optional(),
                page: z.number().int().min(1).optional(),
                pageSize: z.number().int().min(1).max(100).optional(),
            },
            outputSchema: mediaListSchema,
            annotations: {
                readOnlyHint: true,
                idempotentHint: true,
                openWorldHint: false,
            },
        },
        async (args: any, extra: any) => {
            const teamId = getTeamId(extra);
            if (!teamId) return AUTH_ERROR;
            try {
                const [items, total] = await Promise.all([
                    listMedia({
                        teamId,
                        query: args.query,
                        page: args.page,
                        pageSize: args.pageSize,
                    }),
                    countMedia({ teamId, query: args.query }),
                ]);
                return jsonResult({
                    items: items.map(toPublicMedia),
                    total,
                });
            } catch {
                return INTERNAL_ERROR;
            }
        },
    );

    server.registerTool(
        "get_media",
        {
            description: "Returns one uploaded media item by its media ID.",
            inputSchema: { mediaId: z.string().min(1) },
            outputSchema: mediaSchema,
            annotations: {
                readOnlyHint: true,
                idempotentHint: true,
                openWorldHint: false,
            },
        },
        async (args: any, extra: any) => {
            const teamId = getTeamId(extra);
            if (!teamId) return AUTH_ERROR;
            try {
                const row = await getMediaByMediaId(teamId, args.mediaId);
                if (!row) return NOT_FOUND;
                return jsonResult(toPublicMedia(row));
            } catch {
                return INTERNAL_ERROR;
            }
        },
    );

    server.registerTool(
        "update_media",
        {
            description: "Updates editable metadata for uploaded media.",
            inputSchema: {
                mediaId: z.string().min(1),
                alt: z.string().nullable().optional(),
                caption: z.string().nullable().optional(),
            },
            outputSchema: mediaSchema,
            annotations: {
                readOnlyHint: false,
                destructiveHint: false,
                openWorldHint: false,
            },
        },
        async (args: any, extra: any) => {
            const teamId = getTeamId(extra);
            if (!teamId) return AUTH_ERROR;
            try {
                const row = await updateMediaMetadata({
                    teamId,
                    mediaId: args.mediaId,
                    alt: args.alt,
                    caption: args.caption,
                });
                if (!row) return NOT_FOUND;
                return jsonResult(toPublicMedia(row));
            } catch {
                return INTERNAL_ERROR;
            }
        },
    );

    server.registerTool(
        "delete_media",
        {
            description:
                "Deletes uploaded media only when no saved template, broadcast, or sequence email references it.",
            inputSchema: { mediaId: z.string().min(1) },
            outputSchema: successMessageSchema,
            annotations: {
                readOnlyHint: false,
                destructiveHint: true,
                openWorldHint: false,
            },
        },
        async (args: any, extra: any) => {
            const teamId = getTeamId(extra);
            if (!teamId) return AUTH_ERROR;
            try {
                const result = await deleteUnusedMedia(teamId, args.mediaId);
                if (result === "not_found") return NOT_FOUND;
                if (result === "in_use") {
                    return errorResult("Media is still in use.");
                }
                return jsonResult({ message: "Media deleted." });
            } catch {
                return INTERNAL_ERROR;
            }
        },
    );

    server.registerTool(
        "list_media_references",
        {
            description:
                "Lists saved templates, broadcasts, or sequence emails that use the uploaded media item.",
            inputSchema: { mediaId: z.string().min(1) },
            outputSchema: mediaReferenceListSchema,
            annotations: {
                readOnlyHint: true,
                idempotentHint: true,
                openWorldHint: false,
            },
        },
        async (args: any, extra: any) => {
            const teamId = getTeamId(extra);
            if (!teamId) return AUTH_ERROR;
            try {
                const references = await listMediaReferences({
                    teamId,
                    mediaId: args.mediaId,
                });
                if (!references) return NOT_FOUND;
                return jsonResult({
                    items: references.map(toPublicReference),
                });
            } catch {
                return INTERNAL_ERROR;
            }
        },
    );
}
