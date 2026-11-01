import {
  listWebIssuesQuerySchema,
  updateWebPublishingBodySchema,
  updateWebSettingsBodySchema,
  webIssueSchema,
  webIssueSummarySchema,
  webPublishingSchema,
  webSettingsSchema,
} from "@sendlit/api-contract";
import { z } from "zod";
import { getSequenceBySequenceId } from "../../sequences/queries";
import {
  getIssue,
  getWebSettings,
  listIssues,
  toWebPublishing,
  updateWebPublishing,
  updateWebSettings,
  WebPublishingError,
} from "../../web/queries";
import type { SendLitMcpTool } from "../context";
import { dedicatedTool } from "../tool";
import { notFound, type ToolError, toolError } from "./responses";

const readOnly = { idempotentHint: true, openWorldHint: false };

const WEB_ERROR_CODES = {
  400: "validation_failed",
  404: "not_found",
  409: "conflict",
} as const;

/** A web publishing refusal keeps REST's status and code (`slug_taken`,
 * `handle_taken`, `only_broadcasts_can_be_published`, ...) as the reason. */
async function run<T>(fn: () => Promise<T>): Promise<T | ToolError> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof WebPublishingError) {
      return toolError(WEB_ERROR_CODES[error.status], { reason: error.message });
    }
    throw error;
  }
}

export const webTools = (): SendLitMcpTool[] => [
  dedicatedTool({
    name: "get_broadcast_web_publishing",
    title: "Get Broadcast Web Publishing",
    operationId: "sequences.getWeb",
    risk: "read",
    description:
      "Returns whether a broadcast is published as a public web page, its slug, SEO fields and public URL. `live` is true once it's published and sent.",
    inputSchema: z.object({ sequenceId: z.string().min(1) }),
    outputSchema: webPublishingSchema,
    annotations: readOnly,
    async handler({ context, args }) {
      const sequence = await getSequenceBySequenceId(context.teamId, args.sequenceId);
      if (!sequence) return notFound();
      return toWebPublishing(sequence);
    },
  }),

  dedicatedTool({
    name: "update_broadcast_web_publishing",
    title: "Update Broadcast Web Publishing",
    operationId: "sequences.updateWeb",
    risk: "write",
    description:
      "Publishes a broadcast as a public web page (it goes live once sent) or unpublishes it, and sets its slug, SEO title/description, social image, noindex and canonical URL. Only broadcasts can be published. The page has no personal data, tracking or unsubscribe links.",
    inputSchema: z.object({
      sequenceId: z.string().min(1),
      ...updateWebPublishingBodySchema.shape,
    }),
    outputSchema: webPublishingSchema,
    annotations: { openWorldHint: false },
    async handler({ context, args }) {
      const { sequenceId, ...input } = args;
      const sequence = await getSequenceBySequenceId(context.teamId, sequenceId);
      if (!sequence) return notFound();
      return run(() =>
        updateWebPublishing(
          sequence,
          input as Parameters<typeof updateWebPublishing>[1],
        ),
      );
    },
  }),

  dedicatedTool({
    name: "get_web_settings",
    title: "Get Web Archive Settings",
    operationId: "settings.web.get",
    risk: "read",
    description:
      "Returns the team's web archive settings: whether SendLit hosts the archive and issue pages, the handle, title, description, signup form and the archive and RSS URLs.",
    inputSchema: z.object({}),
    outputSchema: webSettingsSchema,
    annotations: readOnly,
    async handler({ context }) {
      return getWebSettings(context.teamId);
    },
  }),

  dedicatedTool({
    name: "update_web_settings",
    title: "Update Web Archive Settings",
    operationId: "settings.web.update",
    risk: "write",
    description:
      "Updates the team's web archive. Turning `enabled` on hosts the archive at /w/<handle> and a page per published issue; a handle and a signup form are created when missing. Turn it off when a platform renders the issues itself through list_web_issues/get_web_issue.",
    inputSchema: updateWebSettingsBodySchema,
    outputSchema: webSettingsSchema,
    annotations: { openWorldHint: false },
    async handler({ context, args }) {
      return run(() =>
        updateWebSettings(
          context.teamId,
          args as Parameters<typeof updateWebSettings>[1],
        ),
      );
    },
  }),

  dedicatedTool({
    name: "list_web_issues",
    title: "List Web Issues",
    operationId: "web.list",
    risk: "read",
    description:
      "Lists the team's published issues (broadcasts published to the web and sent), newest first, with slug, title, date, excerpt and SEO fields.",
    inputSchema: listWebIssuesQuerySchema,
    outputSchema: z.object({
      items: z.array(webIssueSummarySchema),
      total: z.number(),
    }),
    annotations: readOnly,
    async handler({ context, args }) {
      return listIssues(context.teamId, args as Parameters<typeof listIssues>[1]);
    },
  }),

  dedicatedTool({
    name: "get_web_issue",
    title: "Get Web Issue",
    operationId: "web.get",
    risk: "read",
    description:
      "Returns one published issue by slug with its HTML (no personal data, tracking or unsubscribe links), for rendering on another site.",
    inputSchema: z.object({ slug: z.string().min(1) }),
    outputSchema: webIssueSchema,
    annotations: readOnly,
    async handler({ context, args }) {
      const issue = await getIssue(context.teamId, args.slug);
      return issue ?? notFound();
    },
  }),
];
