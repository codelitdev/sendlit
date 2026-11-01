import { z } from "zod";
import {
  countMedia,
  deleteUnusedMedia,
  getMediaByMediaId,
  listMedia,
  listMediaReferences,
  updateMediaMetadata,
} from "../../media/queries";
import { omitInternal } from "../../utils/public";
import type { SendLitMcpTool } from "../context";
import { dedicatedTool } from "../tool";
import { notFound, toolError } from "./responses";
import {
  mediaListSchema,
  mediaReferenceListSchema,
  mediaSchema,
  successMessageSchema,
} from "./schemas";

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

export const mediaTools = (): SendLitMcpTool[] => [
  dedicatedTool({
    name: "list_media",
    title: "List Media",
    operationId: "media.list",
    risk: "read",
    description:
      "Returns uploaded MediaLit-backed media for the team. Unsplash and external URL images are not stored here.",
    inputSchema: z.object({
      query: z.string().optional(),
      page: z.number().int().min(1).optional(),
      pageSize: z.number().int().min(1).max(100).optional(),
    }),
    outputSchema: mediaListSchema,
    annotations: { idempotentHint: true, openWorldHint: false },
    async handler({ context, args }) {
      const [items, total] = await Promise.all([
        listMedia({
          teamId: context.teamId,
          query: args.query,
          page: args.page,
          pageSize: args.pageSize,
        }),
        countMedia({ teamId: context.teamId, query: args.query }),
      ]);
      return { items: items.map(toPublicMedia), total };
    },
  }),

  dedicatedTool({
    name: "get_media",
    title: "Get Media",
    operationId: "media.get",
    risk: "read",
    description: "Returns one uploaded media item by its media ID.",
    inputSchema: z.object({ mediaId: z.string().min(1) }),
    outputSchema: mediaSchema,
    annotations: { idempotentHint: true, openWorldHint: false },
    async handler({ context, args }) {
      const row = await getMediaByMediaId(context.teamId, args.mediaId);
      if (!row) return notFound();
      return toPublicMedia(row);
    },
  }),

  dedicatedTool({
    name: "update_media",
    title: "Update Media",
    operationId: "media.update",
    risk: "write",
    description: "Updates editable metadata for uploaded media.",
    inputSchema: z.object({
      mediaId: z.string().min(1),
      alt: z.string().nullable().optional(),
      caption: z.string().nullable().optional(),
    }),
    outputSchema: mediaSchema,
    annotations: { openWorldHint: false },
    async handler({ context, args }) {
      const row = await updateMediaMetadata({
        teamId: context.teamId,
        mediaId: args.mediaId,
        alt: args.alt,
        caption: args.caption,
      });
      if (!row) return notFound();
      return toPublicMedia(row);
    },
  }),

  dedicatedTool({
    name: "delete_media",
    title: "Delete Media",
    operationId: "media.remove",
    risk: "destructive",
    description:
      "Deletes uploaded media only when no saved template, broadcast, or sequence email references it.",
    inputSchema: z.object({ mediaId: z.string().min(1) }),
    outputSchema: successMessageSchema,
    annotations: { openWorldHint: false },
    async handler({ context, args }) {
      const result = await deleteUnusedMedia(context.teamId, args.mediaId);
      if (result === "not_found") return notFound();
      if (result === "in_use") {
        return toolError("conflict", {
          reason: "media_in_use",
          message: "Media is still in use. list_media_references shows what uses it.",
        });
      }
      return { message: "Media deleted." };
    },
  }),

  dedicatedTool({
    name: "list_media_references",
    title: "List Media References",
    operationId: "media.references",
    risk: "read",
    description:
      "Lists saved templates, broadcasts, or sequence emails that use the uploaded media item.",
    inputSchema: z.object({ mediaId: z.string().min(1) }),
    outputSchema: mediaReferenceListSchema,
    annotations: { idempotentHint: true, openWorldHint: false },
    async handler({ context, args }) {
      const references = await listMediaReferences({
        teamId: context.teamId,
        mediaId: args.mediaId,
      });
      if (!references) return notFound();
      return { items: references.map(toPublicReference) };
    },
  }),
];
