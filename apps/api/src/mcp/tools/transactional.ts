import {
  emailHeadersSchema,
  transactionalEmailDetailSchema,
  transactionalEmailSchema,
  transactionalEmailStatus,
} from "@sendlit/api-contract";
import { z } from "zod";
import {
  MISSING_TEMPLATE_VARIABLES,
  MissingTemplateVariablesError,
} from "../../mail/render";
import {
  countTransactionalEmails,
  createTransactionalEmail,
  getTransactionalEmailByTxeId,
  listTransactionalEmails,
  toPublicTransactionalEmail,
} from "../../transactional/queries";
import type { SendLitMcpTool } from "../context";
import { dedicatedTool } from "../tool";
import { isPlanGateError, notFound, planGateError, toolError } from "./responses";

const transactionalEmailListSchema = z.object({
  items: z.array(transactionalEmailSchema),
  total: z.number(),
});

/** `createTransactionalEmail` failures: the platform code, the REST error
 * code as `reason`, and the message a REST caller gets in the body. */
const SEND_ERRORS: Record<string, [Parameters<typeof toolError>[0], string]> = {
  invalid_content: [
    "validation_failed",
    "Provide exactly one of templateId or html; variables requires templateId",
  ],
  invalid_headers: [
    "validation_failed",
    "Header names/values must not contain CR/LF; From, To, Subject and Content-Type are set by the send pipeline",
  ],
  template_not_transactional: [
    "validation_failed",
    "The template is a marketing template; send_email needs a transactional one.",
  ],
  marketing_variables_not_allowed: [
    "validation_failed",
    "Transactional templates can't use marketing variables.",
  ],
  template_not_found: ["not_found", "Template not found"],
  render_failed: ["validation_failed", "Template rendering failed"],
  esp_not_configured: ["conflict", "Team ESP is not configured."],
  esp_not_found: ["not_found", "ESP not found"],
  recipient_suppressed: [
    "conflict",
    "This address is suppressed after a prior hard bounce or complaint and cannot receive mail from this team.",
  ],
};

export const transactionalTools = (): SendLitMcpTool[] => [
  dedicatedTool({
    name: "send_email",
    title: "Send Email",
    operationId: "transactional.send",
    risk: "write",
    description:
      "Sends a single transactional email (e.g. a receipt or password reset) immediately—no audience filter or marketing footer. `templateId` must identify a team-owned transactional template and every requiredVariables path must be supplied; marketing templates are rejected as template_not_transactional. Alternatively provide `html`, which is sent verbatim without Liquid rendering. Fire-and-forget: poll `get_email` with the returned `txeId` for delivery status.",
    inputSchema: z.object({
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
      text: z
        .string()
        .min(1)
        .optional()
        .describe(
          "Plain-text part, sent verbatim; generated from the HTML when omitted",
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
    }),
    outputSchema: transactionalEmailSchema.pick({ txeId: true, status: true }),
    annotations: { openWorldHint: true },
    async handler({ context, args }) {
      try {
        const row = await createTransactionalEmail({ teamId: context.teamId, ...args });
        return { txeId: row.txeId, status: row.status };
      } catch (err: any) {
        if (isPlanGateError(err)) return planGateError(err);
        if (
          err instanceof MissingTemplateVariablesError ||
          err?.message === MISSING_TEMPLATE_VARIABLES
        ) {
          const missingVariables = Array.isArray(err.missingVariables)
            ? err.missingVariables.join(", ")
            : null;
          return toolError("validation_failed", {
            reason: MISSING_TEMPLATE_VARIABLES,
            message: missingVariables
              ? `Missing required template variables: ${missingVariables}`
              : "Missing required template variables",
          });
        }
        const known = SEND_ERRORS[err?.message];
        if (!known) throw err;
        return toolError(known[0], { reason: err.message, message: known[1] });
      }
    },
  }),

  dedicatedTool({
    name: "get_email",
    title: "Get Email",
    operationId: "transactional.get",
    risk: "read",
    description:
      "Returns a single transactional email by its txe ID, including its rendered HTML snapshot and (when tracking was enabled) open/click counts.",
    inputSchema: z.object({ txeId: z.string() }),
    outputSchema: transactionalEmailDetailSchema,
    annotations: { idempotentHint: true, openWorldHint: false },
    async handler({ context, args }) {
      const row = await getTransactionalEmailByTxeId(args.txeId);
      if (!row || row.teamId !== context.teamId) return notFound();
      return toPublicTransactionalEmail(row, { includeHtml: true });
    },
  }),

  dedicatedTool({
    name: "list_emails",
    title: "List Emails",
    operationId: "transactional.list",
    risk: "read",
    description:
      "Returns a paginated list of transactional emails for the team, most recent first. Omits the HTML snapshot (use get_email for that).",
    inputSchema: z.object({
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
      offset: z.number().int().min(1).optional().describe("Page number (default: 1)"),
      itemsPerPage: z.number().int().min(1).max(50).optional(),
    }),
    outputSchema: transactionalEmailListSchema,
    annotations: { idempotentHint: true, openWorldHint: false },
    async handler({ context, args }) {
      const filters = {
        status: args.status,
        createdAfter: args.createdAfter,
        createdBefore: args.createdBefore,
      };
      const [items, total] = await Promise.all([
        listTransactionalEmails({
          teamId: context.teamId,
          ...filters,
          offset: args.offset,
          rowsPerPage: args.itemsPerPage,
        }),
        countTransactionalEmails(context.teamId, filters),
      ]);
      return {
        items: items.map((row) =>
          toPublicTransactionalEmail(row, { includeHtml: false }),
        ),
        total,
      };
    },
  }),
];
