import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { mailTypes, emailActionTypes } from "../../config/constants";
import {
    addMailToSequence,
    countSequences,
    createSequence,
    deleteMailFromSequence,
    getEmailSentCount,
    getSequenceBySequenceId,
    getSequenceClickThroughRate,
    getSequenceOpenRate,
    getSubscribers,
    getSubscribersCount,
    listSequences,
    pauseSequence,
    startSequence,
    updateMailInSequence,
    updateSequence,
} from "../../sequences/queries";
import {
    AUTH_ERROR,
    INTERNAL_ERROR,
    NOT_FOUND,
    errorResult,
    jsonResult,
} from "./responses";
import {
    sequenceListSchema,
    sequenceSchema,
    sequenceStatsSchema,
} from "./schemas";
import { getTeamId } from "./auth";

export function registerSequenceTools(server: McpServer): void {
    server.registerTool(
        "list_sequences",
        {
            description:
                "Returns a paginated list of broadcasts (type=broadcast, one-off) or sequences (type=sequence, multi-step, event-triggered).",
            inputSchema: {
                type: z.enum(mailTypes),
                offset: z
                    .number()
                    .int()
                    .min(1)
                    .optional()
                    .describe("Page number (default: 1)"),
                itemsPerPage: z.number().int().min(1).optional(),
            },
            outputSchema: sequenceListSchema,
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
                    listSequences({
                        teamId,
                        type: args.type,
                        offset: args.offset,
                        itemsPerPage: args.itemsPerPage,
                    }),
                    countSequences(teamId, args.type),
                ]);
                return jsonResult({ items, total });
            } catch {
                return INTERNAL_ERROR;
            }
        },
    );

    server.registerTool(
        "get_sequence",
        {
            description:
                "Returns a broadcast or sequence, including its emails, by its sequence ID.",
            inputSchema: { sequenceId: z.string() },
            outputSchema: sequenceSchema,
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
                const sequence = await getSequenceBySequenceId(
                    teamId,
                    args.sequenceId,
                );
                if (!sequence) return NOT_FOUND;
                return jsonResult(sequence);
            } catch {
                return INTERNAL_ERROR;
            }
        },
    );

    server.registerTool(
        "create_sequence",
        {
            description:
                "Creates a new broadcast or sequence, seeding its first email from an existing template.",
            inputSchema: {
                type: z.enum(mailTypes),
                templateId: z.string().min(1),
            },
            outputSchema: sequenceSchema,
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
                const sequence = await createSequence({
                    teamId,
                    type: args.type,
                    templateId: args.templateId,
                });
                return jsonResult(sequence);
            } catch (err: any) {
                return errorResult(err.message);
            }
        },
    );

    server.registerTool(
        "update_sequence",
        {
            description:
                "Updates a broadcast/sequence's title, sender identity, trigger (sequences) or audience filter (broadcasts).",
            inputSchema: {
                sequenceId: z.string(),
                title: z.string().optional(),
                fromName: z.string().optional(),
                fromEmail: z.string().email().optional(),
                triggerType: z
                    .string()
                    .optional()
                    .describe(
                        "tag:added | tag:removed | subscriber:added | date:occurred",
                    ),
                triggerData: z
                    .string()
                    .optional()
                    .describe("e.g. the tag name for tag triggers"),
                filter: z
                    .object({
                        aggregator: z.enum(["and", "or"]),
                        filters: z.array(z.record(z.any())),
                    })
                    .optional()
                    .describe(
                        "Audience filter for broadcasts (tag/email/subscription/signedUp)",
                    ),
                emailsOrder: z.array(z.string()).optional(),
            },
            outputSchema: sequenceSchema,
            annotations: {
                readOnlyHint: false,
                destructiveHint: false,
                openWorldHint: false,
            },
        },
        async (args: any, extra: any) => {
            const teamId = getTeamId(extra);
            if (!teamId) return AUTH_ERROR;
            const { sequenceId, ...patch } = args;
            try {
                const sequence = await updateSequence({
                    teamId,
                    sequenceId,
                    ...patch,
                });
                if (!sequence) return NOT_FOUND;
                return jsonResult(sequence);
            } catch (err: any) {
                return errorResult(err.message);
            }
        },
    );

    server.registerTool(
        "add_sequence_email",
        {
            description:
                "Adds a new email step to a sequence, seeded from an existing template.",
            inputSchema: {
                sequenceId: z.string(),
                templateId: z.string().min(1),
            },
            outputSchema: sequenceSchema,
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
                const sequence = await addMailToSequence({
                    teamId,
                    sequenceId: args.sequenceId,
                    templateId: args.templateId,
                });
                if (!sequence) return NOT_FOUND;
                return jsonResult(sequence);
            } catch (err: any) {
                return errorResult(err.message);
            }
        },
    );

    server.registerTool(
        "update_sequence_email",
        {
            description:
                "Updates one email within a sequence/broadcast: subject, content, delay, publish status, or the tag action fired on send.",
            inputSchema: {
                sequenceId: z.string(),
                emailId: z.string(),
                subject: z.string().optional(),
                content: z
                    .object({
                        style: z.record(z.any()),
                        meta: z.record(z.any()),
                        content: z.array(z.record(z.any())),
                    })
                    .optional(),
                delayInMillis: z
                    .number()
                    .optional()
                    .describe(
                        "Milliseconds after the previous email (sequences only)",
                    ),
                actionType: z.enum(emailActionTypes).optional(),
                actionData: z
                    .record(z.any())
                    .optional()
                    .describe('e.g. { "tag": "vip" }'),
                published: z
                    .boolean()
                    .optional()
                    .describe(
                        "Must be true before the sequence/broadcast can be started",
                    ),
            },
            outputSchema: sequenceSchema,
            annotations: {
                readOnlyHint: false,
                destructiveHint: false,
                openWorldHint: false,
            },
        },
        async (args: any, extra: any) => {
            const teamId = getTeamId(extra);
            if (!teamId) return AUTH_ERROR;
            const { sequenceId, emailId, ...patch } = args;
            try {
                const sequence = await updateMailInSequence({
                    teamId,
                    sequenceId,
                    emailId,
                    ...patch,
                });
                if (!sequence) return NOT_FOUND;
                return jsonResult(sequence);
            } catch (err: any) {
                return errorResult(err.message);
            }
        },
    );

    server.registerTool(
        "delete_sequence_email",
        {
            description:
                "Removes an email from a sequence. Broadcasts cannot have their only email removed.",
            inputSchema: { sequenceId: z.string(), emailId: z.string() },
            outputSchema: sequenceSchema,
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
                const sequence = await deleteMailFromSequence({
                    teamId,
                    sequenceId: args.sequenceId,
                    emailId: args.emailId,
                });
                if (!sequence) return NOT_FOUND;
                return jsonResult(sequence);
            } catch (err: any) {
                return errorResult(err.message);
            }
        },
    );

    server.registerTool(
        "start_sequence",
        {
            description:
                "Starts a broadcast (schedules it for delivery) or activates a sequence (begins enrolling contacts on its trigger). Requires at least one published email.",
            inputSchema: { sequenceId: z.string() },
            outputSchema: sequenceSchema,
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
                const sequence = await startSequence({
                    teamId,
                    sequenceId: args.sequenceId,
                });
                return jsonResult(sequence);
            } catch (err: any) {
                return errorResult(err.message);
            }
        },
    );

    server.registerTool(
        "pause_sequence",
        {
            description:
                "Pauses an active sequence, or an active broadcast that hasn't sent yet.",
            inputSchema: { sequenceId: z.string() },
            outputSchema: sequenceSchema,
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
                const sequence = await pauseSequence({
                    teamId,
                    sequenceId: args.sequenceId,
                });
                return jsonResult(sequence);
            } catch (err: any) {
                return errorResult(err.message);
            }
        },
    );

    server.registerTool(
        "get_sequence_stats",
        {
            description:
                "Returns delivery stats for a broadcast/sequence: emails sent, recipient count, open rate and click-through rate.",
            inputSchema: { sequenceId: z.string() },
            outputSchema: sequenceStatsSchema,
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
                const sequence = await getSequenceBySequenceId(
                    teamId,
                    args.sequenceId,
                );
                if (!sequence) return NOT_FOUND;
                const [sent, openRate, clickThroughRate, subscribersCount] =
                    await Promise.all([
                        getEmailSentCount(args.sequenceId),
                        getSequenceOpenRate(args.sequenceId),
                        getSequenceClickThroughRate(args.sequenceId),
                        getSubscribersCount(args.sequenceId),
                    ]);
                return jsonResult({
                    sent,
                    openRate,
                    clickThroughRate,
                    subscribersCount,
                });
            } catch {
                return INTERNAL_ERROR;
            }
        },
    );

    server.registerTool(
        "get_sequence_subscribers",
        {
            description:
                "Returns a paginated list of contact IDs that have received at least one email in this sequence or broadcast.",
            inputSchema: {
                sequenceId: z.string().describe("Sequence or broadcast ID"),
                page: z
                    .number()
                    .int()
                    .min(1)
                    .optional()
                    .describe("Page number (default: 1)"),
                limit: z
                    .number()
                    .int()
                    .min(1)
                    .max(200)
                    .optional()
                    .describe("Results per page (default: 50)"),
            },
            outputSchema: z.object({
                items: z.array(z.string()),
                total: z.number(),
            }),
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
                const sequence = await getSequenceBySequenceId(
                    teamId,
                    args.sequenceId,
                );
                if (!sequence) return NOT_FOUND;
                const [items, total] = await Promise.all([
                    getSubscribers({
                        sequenceId: args.sequenceId,
                        page: args.page,
                        limit: args.limit,
                    }),
                    getSubscribersCount(args.sequenceId),
                ]);
                return jsonResult({ items, total });
            } catch {
                return INTERNAL_ERROR;
            }
        },
    );
}
