import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
    createSegment,
    deleteSegment,
    getSegment,
    listSegments,
    updateSegment,
} from "../../contacts/segments-queries";
import { AUTH_ERROR, INTERNAL_ERROR, NOT_FOUND, jsonResult } from "./responses";
import { contactFilterSchema } from "@sendlit/api-contract";
import { segmentListSchema, segmentSchema } from "./schemas";
import { getTeamId } from "./auth";
import { omitInternal } from "../../utils/public";

export function registerSegmentTools(server: McpServer): void {
    server.registerTool(
        "list_segments",
        {
            description:
                "Returns all saved segments (named, reusable contact filters) for the team.",
            inputSchema: {},
            outputSchema: segmentListSchema,
            annotations: {
                readOnlyHint: true,
                idempotentHint: true,
                openWorldHint: false,
            },
        },
        async (_args: any, extra: any) => {
            const teamId = getTeamId(extra);
            if (!teamId) return AUTH_ERROR;
            try {
                const items = await listSegments(teamId);
                return jsonResult({
                    items: items.map((item) => omitInternal(item)),
                });
            } catch {
                return INTERNAL_ERROR;
            }
        },
    );

    server.registerTool(
        "get_segment",
        {
            description: "Returns a single saved segment by its segment ID.",
            inputSchema: { segmentId: z.string().describe("Segment ID") },
            outputSchema: segmentSchema,
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
                const segment = await getSegment(args.segmentId);
                if (!segment || segment.teamId !== teamId) return NOT_FOUND;
                return jsonResult(omitInternal(segment));
            } catch {
                return INTERNAL_ERROR;
            }
        },
    );

    server.registerTool(
        "create_segment",
        {
            description:
                "Creates a saved segment: a named, reusable contact filter that can be applied to broadcasts/sequences or listed on demand.",
            inputSchema: {
                name: z.string().describe("Segment name (must be unique)"),
                filter: contactFilterSchema.describe("The filter to save"),
            },
            outputSchema: segmentSchema,
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
                const segment = await createSegment({
                    teamId,
                    name: args.name,
                    filter: args.filter,
                });
                return jsonResult(omitInternal(segment));
            } catch (err: any) {
                return {
                    content: [{ type: "text" as const, text: err.message }],
                    isError: true,
                };
            }
        },
    );

    server.registerTool(
        "update_segment",
        {
            description: "Updates a saved segment's name and/or filter.",
            inputSchema: {
                segmentId: z.string().describe("Segment ID"),
                name: z.string().optional(),
                filter: contactFilterSchema.optional(),
            },
            outputSchema: segmentSchema,
            annotations: {
                readOnlyHint: false,
                destructiveHint: false,
                openWorldHint: false,
            },
        },
        async (args: any, extra: any) => {
            const teamId = getTeamId(extra);
            if (!teamId) return AUTH_ERROR;
            const { segmentId, ...patch } = args;
            try {
                const segment = await updateSegment({
                    teamId,
                    segmentId,
                    ...patch,
                });
                if (!segment) return NOT_FOUND;
                return jsonResult(omitInternal(segment));
            } catch (err: any) {
                return {
                    content: [{ type: "text" as const, text: err.message }],
                    isError: true,
                };
            }
        },
    );

    server.registerTool(
        "delete_segment",
        {
            description:
                "Permanently deletes a saved segment. This action cannot be undone; it does not delete the contacts themselves.",
            inputSchema: { segmentId: z.string() },
            outputSchema: z.object({ message: z.string() }),
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
                await deleteSegment(teamId, args.segmentId);
                return jsonResult({ message: "Segment deleted." });
            } catch {
                return INTERNAL_ERROR;
            }
        },
    );
}
