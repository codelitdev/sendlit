import { contactFilterSchema } from "@sendlit/api-contract";
import { z } from "zod";
import {
  createSegment,
  deleteSegment,
  getSegment,
  listSegments,
  updateSegment,
} from "../../contacts/segments-queries";
import { omitInternal } from "../../utils/public";
import type { SendLitMcpTool } from "../context";
import { dedicatedTool } from "../tool";
import { notFound, toolError } from "./responses";
import { segmentListSchema, segmentSchema } from "./schemas";

function duplicateName(err: any) {
  return err?.message === "duplicate_name"
    ? toolError("conflict", {
        reason: "duplicate_name",
        message: "A segment with this name already exists",
      })
    : null;
}

export const segmentTools = (): SendLitMcpTool[] => [
  dedicatedTool({
    name: "list_segments",
    title: "List Segments",
    operationId: "segments.list",
    risk: "read",
    description:
      "Returns all saved segments (named, reusable contact filters) for the team.",
    inputSchema: z.object({}),
    outputSchema: segmentListSchema,
    annotations: { idempotentHint: true, openWorldHint: false },
    async handler({ context }) {
      const items = await listSegments(context.teamId);
      return { items: items.map((item) => omitInternal(item)) };
    },
  }),

  dedicatedTool({
    name: "get_segment",
    title: "Get Segment",
    operationId: "segments.get",
    risk: "read",
    description: "Returns a single saved segment by its segment ID.",
    inputSchema: z.object({ segmentId: z.string().describe("Segment ID") }),
    outputSchema: segmentSchema,
    annotations: { idempotentHint: true, openWorldHint: false },
    async handler({ context, args }) {
      const segment = await getSegment(args.segmentId);
      if (!segment || segment.teamId !== context.teamId) return notFound();
      return omitInternal(segment);
    },
  }),

  dedicatedTool({
    name: "create_segment",
    title: "Create Segment",
    operationId: "segments.create",
    risk: "write",
    description:
      "Creates a saved segment: a named, reusable contact filter that can be applied to broadcasts/sequences or listed on demand.",
    inputSchema: z.object({
      name: z.string().describe("Segment name (must be unique)"),
      filter: contactFilterSchema.describe("The filter to save"),
    }),
    outputSchema: segmentSchema,
    annotations: { openWorldHint: false },
    async handler({ context, args }) {
      try {
        const segment = await createSegment({
          teamId: context.teamId,
          name: args.name,
          filter: args.filter,
        });
        return omitInternal(segment);
      } catch (err: any) {
        const mapped = duplicateName(err);
        if (mapped) return mapped;
        throw err;
      }
    },
  }),

  dedicatedTool({
    name: "update_segment",
    title: "Update Segment",
    operationId: "segments.update",
    risk: "write",
    description: "Updates a saved segment's name and/or filter.",
    inputSchema: z.object({
      segmentId: z.string().describe("Segment ID"),
      name: z.string().optional(),
      filter: contactFilterSchema.optional(),
    }),
    outputSchema: segmentSchema,
    annotations: { openWorldHint: false },
    async handler({ context, args }) {
      const { segmentId, ...patch } = args;
      try {
        const segment = await updateSegment({
          teamId: context.teamId,
          segmentId,
          ...patch,
        } as Parameters<typeof updateSegment>[0]);
        if (!segment) return notFound();
        return omitInternal(segment);
      } catch (err: any) {
        const mapped = duplicateName(err);
        if (mapped) return mapped;
        throw err;
      }
    },
  }),

  dedicatedTool({
    name: "delete_segment",
    title: "Delete Segment",
    operationId: "segments.remove",
    risk: "destructive",
    description:
      "Permanently deletes a saved segment. This action cannot be undone; it does not delete the contacts themselves.",
    inputSchema: z.object({ segmentId: z.string() }),
    outputSchema: z.object({ message: z.string() }),
    annotations: { openWorldHint: false },
    async handler({ context, args }) {
      await deleteSegment(context.teamId, args.segmentId);
      return { message: "Segment deleted." };
    },
  }),
];
