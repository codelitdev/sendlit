import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
    emailHeadersSchema,
    transactionalEmailDetailSchema,
    transactionalEmailSchema,
    transactionalEmailStatus,
} from "@sendlit/api-contract";
import {
    countTransactionalEmails,
    createTransactionalEmail,
    getTransactionalEmailByTxeId,
    listTransactionalEmails,
    toPublicTransactionalEmail,
} from "../../transactional/queries";
import { MAILING_ADDRESS_REQUIRED } from "../../settings/general/constants";
import {
    MISSING_TEMPLATE_VARIABLES,
    MissingTemplateVariablesError,
} from "../../mail/render";
import { AUTH_ERROR, NOT_FOUND, errorResult, jsonResult } from "./responses";
import { getTeamId } from "./auth";

const transactionalEmailListSchema = z.object({
    items: z.array(transactionalEmailSchema),
    total: z.number(),
});

/**
 * The REST route's `202`/`400`/`422`/`429` split (see
 * `transactional/routes.ts`) doesn't map onto MCP's single tool-result shape,
 * so every `createTransactionalEmail` failure just becomes an `isError`
 * result with the same message a REST caller would have gotten in the body.
 */
export function registerTransactionalTools(server: McpServer): void {
    server.registerTool(
        "send_email",
        {
            description:
                "Sends a single transactional email (e.g. a receipt or password reset) immediately—no audience filter or marketing footer. `templateId` must identify a team-owned transactional template and every requiredVariables path must be supplied; marketing templates are rejected as template_not_transactional. Alternatively provide `html`, which is sent verbatim without Liquid rendering. Fire-and-forget: poll `get_email` with the returned `txeId` for delivery status.",
            inputSchema: {
                to: z.string().email(),
                subject: z.string().min(1),
                templateId: z
                    .string()
                    .min(1)
                    .optional()
                    .describe("Mutually exclusive with `html`"),
                html: z
                    .string()
                    .min(1)
                    .optional()
                    .describe(
                        "Sent verbatim (no Liquid pass); mutually exclusive with `templateId`",
                    ),
                variables: z
                    .record(z.any())
                    .optional()
                    .describe(
                        "Liquid merge variables; requires `templateId`. Provide every unguarded merge tag; use `{% if %}` or `default` in the template for optional values.",
                    ),
                replyTo: z.string().email().optional(),
                headers: emailHeadersSchema
                    .optional()
                    .describe(
                        "Extra SMTP headers; no CR/LF, and From/To/Subject/Content-Type are reserved",
                    ),
                idempotencyKey: z
                    .string()
                    .min(1)
                    .max(256)
                    .optional()
                    .describe(
                        "Replaying the same key returns the original send instead of sending again",
                    ),
                trackOpens: z.boolean().optional(),
                trackClicks: z.boolean().optional(),
                deliverySource: z
                    .discriminatedUnion("type", [
                        z.object({ type: z.literal("organization") }),
                        z.object({
                            type: z.literal("team"),
                            espId: z.string().min(1).optional(),
                        }),
                    ])
                    .optional(),
            },
            outputSchema: transactionalEmailSchema.pick({
                txeId: true,
                status: true,
            }),
            annotations: {
                readOnlyHint: false,
                destructiveHint: false,
                openWorldHint: true,
            },
        },
        async (args: any, extra: any) => {
            const teamId = getTeamId(extra);
            if (!teamId) return AUTH_ERROR;
            try {
                const row = await createTransactionalEmail({
                    teamId,
                    to: args.to,
                    subject: args.subject,
                    templateId: args.templateId,
                    html: args.html,
                    variables: args.variables,
                    replyTo: args.replyTo,
                    headers: args.headers,
                    idempotencyKey: args.idempotencyKey,
                    trackOpens: args.trackOpens,
                    trackClicks: args.trackClicks,
                    deliverySource: args.deliverySource,
                });
                return jsonResult({ txeId: row.txeId, status: row.status });
            } catch (err: any) {
                if (
                    err instanceof MissingTemplateVariablesError ||
                    err?.message === MISSING_TEMPLATE_VARIABLES
                ) {
                    const missingVariables = Array.isArray(err.missingVariables)
                        ? err.missingVariables.join(", ")
                        : null;
                    return errorResult(
                        missingVariables
                            ? `Missing required template variables: ${missingVariables}`
                            : "Missing required template variables",
                    );
                }
                switch (err.message) {
                    case "invalid_content":
                        return errorResult(
                            "Provide exactly one of templateId or html; variables requires templateId",
                        );
                    case "invalid_headers":
                        return errorResult(
                            "Header names/values must not contain CR/LF; From, To, Subject and Content-Type are set by the send pipeline",
                        );
                    case "template_not_transactional":
                        return errorResult("template_not_transactional");
                    case "marketing_variables_not_allowed":
                        return errorResult("marketing_variables_not_allowed");
                    case "template_not_found":
                        return errorResult("Template not found");
                    case "render_failed":
                        return errorResult("Template rendering failed");
                    case "esp_not_configured":
                        return errorResult("Team ESP is not configured.");
                    case MAILING_ADDRESS_REQUIRED:
                        return errorResult(
                            "A mailing address is required before sending email.",
                        );
                    case "esp_not_found":
                        return errorResult("ESP not found");
                    case "recipient_suppressed":
                        return errorResult(
                            "This address is suppressed after a prior hard bounce or complaint and cannot receive mail from this team.",
                        );
                    default:
                        throw err;
                }
            }
        },
    );

    server.registerTool(
        "get_email",
        {
            description:
                "Returns a single transactional email by its txe ID, including its rendered HTML snapshot and (when tracking was enabled) open/click counts.",
            inputSchema: { txeId: z.string() },
            outputSchema: transactionalEmailDetailSchema,
            annotations: {
                readOnlyHint: true,
                idempotentHint: true,
                openWorldHint: false,
            },
        },
        async (args: any, extra: any) => {
            const teamId = getTeamId(extra);
            if (!teamId) return AUTH_ERROR;
            const row = await getTransactionalEmailByTxeId(args.txeId);
            if (!row || row.teamId !== teamId) return NOT_FOUND;
            return jsonResult(
                toPublicTransactionalEmail(row, { includeHtml: true }),
            );
        },
    );

    server.registerTool(
        "list_emails",
        {
            description:
                "Returns a paginated list of transactional emails for the team, most recent first. Omits the HTML snapshot (use get_email for that).",
            inputSchema: {
                status: z.enum(transactionalEmailStatus).optional(),
                createdAfter: z
                    .number()
                    .int()
                    .optional()
                    .describe("Millisecond timestamp lower bound (inclusive)"),
                createdBefore: z
                    .number()
                    .int()
                    .optional()
                    .describe("Millisecond timestamp upper bound (exclusive)"),
                offset: z
                    .number()
                    .int()
                    .min(1)
                    .optional()
                    .describe("Page number (default: 1)"),
                itemsPerPage: z.number().int().min(1).optional(),
            },
            outputSchema: transactionalEmailListSchema,
            annotations: {
                readOnlyHint: true,
                idempotentHint: true,
                openWorldHint: false,
            },
        },
        async (args: any, extra: any) => {
            const teamId = getTeamId(extra);
            if (!teamId) return AUTH_ERROR;
            const filters = {
                status: args.status,
                createdAfter: args.createdAfter,
                createdBefore: args.createdBefore,
            };
            const [items, total] = await Promise.all([
                listTransactionalEmails({
                    teamId,
                    ...filters,
                    offset: args.offset,
                    rowsPerPage: args.itemsPerPage,
                }),
                countTransactionalEmails(teamId, filters),
            ]);
            return jsonResult({
                items: items.map((row) =>
                    toPublicTransactionalEmail(row, { includeHtml: false }),
                ),
                total,
            });
        },
    );
}
