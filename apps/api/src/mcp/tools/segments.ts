import { contactFilterSchema } from "@sendlit/api-contract";
import { z } from "zod";
import { createSegment, listSegments } from "../../contacts/segments-queries";
import { omitInternal } from "../../utils/public";
import type { SendLitMcpTool } from "../context";
import { dedicatedTool } from "../tool";
import { toolError } from "./responses";
import { segmentListSchema, segmentSchema } from "./schemas";

export const segmentTools = (): SendLitMcpTool[] => [
  dedicatedTool({
    name: "list_segments",
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
    name: "create_segment",
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
        if (err?.message === "duplicate_name") {
          return toolError("conflict", {
            reason: "duplicate_name",
            message: "A segment with this name already exists",
          });
        }
        throw err;
      }
    },
  }),
];
