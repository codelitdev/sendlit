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
import type { McpToolRegistrar } from "../tool-registry";
import { getTeamId } from "./auth";
import { AUTH_ERROR, errorResult, jsonResult, NOT_FOUND } from "./responses";

const readOnly = { readOnlyHint: true, idempotentHint: true, openWorldHint: false };
const write = { readOnlyHint: false, destructiveHint: false, openWorldHint: false };

async function run<T>(fn: () => Promise<T>) {
  try {
    return jsonResult(await fn());
  } catch (error) {
    if (error instanceof WebPublishingError) return errorResult(error.message);
    throw error;
  }
}

export function registerWebTools(server: McpToolRegistrar): void {
  server.registerTool(
    "get_broadcast_web_publishing",
    {
      description:
        "Returns whether a broadcast is published as a public web page, its slug, SEO fields and public URL. `live` is true once it's published and sent.",
      inputSchema: { sequenceId: z.string().min(1) },
      outputSchema: webPublishingSchema,
      annotations: readOnly,
    },
    async (args: any, extra: any) => {
      const teamId = getTeamId(extra);
      if (!teamId) return AUTH_ERROR;
      const sequence = await getSequenceBySequenceId(teamId, args.sequenceId);
      if (!sequence) return NOT_FOUND;
      return jsonResult(await toWebPublishing(sequence));
    },
  );

  server.registerTool(
    "update_broadcast_web_publishing",
    {
      description:
        "Publishes a broadcast as a public web page (it goes live once sent) or unpublishes it, and sets its slug, SEO title/description, social image, noindex and canonical URL. Only broadcasts can be published. The page has no personal data, tracking or unsubscribe links.",
      inputSchema: {
        sequenceId: z.string().min(1),
        ...updateWebPublishingBodySchema.shape,
      },
      outputSchema: webPublishingSchema,
      annotations: write,
    },
    async (args: any, extra: any) => {
      const teamId = getTeamId(extra);
      if (!teamId) return AUTH_ERROR;
      const { sequenceId, ...input } = args;
      const sequence = await getSequenceBySequenceId(teamId, sequenceId);
      if (!sequence) return NOT_FOUND;
      return run(() => updateWebPublishing(sequence, input));
    },
  );

  server.registerTool(
    "get_web_settings",
    {
      description:
        "Returns the team's web archive settings: whether SendLit hosts the archive and issue pages, the handle, title, description, signup form and the archive and RSS URLs.",
      outputSchema: webSettingsSchema,
      annotations: readOnly,
    },
    async (extra: any) => {
      const teamId = getTeamId(extra);
      if (!teamId) return AUTH_ERROR;
      return jsonResult(await getWebSettings(teamId));
    },
  );

  server.registerTool(
    "update_web_settings",
    {
      description:
        "Updates the team's web archive. Turning `enabled` on hosts the archive at /w/<handle> and a page per published issue; a handle and a signup form are created when missing. Turn it off when a platform renders the issues itself through list_web_issues/get_web_issue.",
      inputSchema: updateWebSettingsBodySchema.shape,
      outputSchema: webSettingsSchema,
      annotations: write,
    },
    async (args: any, extra: any) => {
      const teamId = getTeamId(extra);
      if (!teamId) return AUTH_ERROR;
      return run(() => updateWebSettings(teamId, args));
    },
  );

  server.registerTool(
    "list_web_issues",
    {
      description:
        "Lists the team's published issues (broadcasts published to the web and sent), newest first, with slug, title, date, excerpt and SEO fields.",
      inputSchema: listWebIssuesQuerySchema.shape,
      outputSchema: z.object({
        items: z.array(webIssueSummarySchema),
        total: z.number(),
      }),
      annotations: readOnly,
    },
    async (args: any, extra: any) => {
      const teamId = getTeamId(extra);
      if (!teamId) return AUTH_ERROR;
      return jsonResult(await listIssues(teamId, args));
    },
  );

  server.registerTool(
    "get_web_issue",
    {
      description:
        "Returns one published issue by slug with its HTML (no personal data, tracking or unsubscribe links), for rendering on another site.",
      inputSchema: { slug: z.string().min(1) },
      outputSchema: webIssueSchema,
      annotations: readOnly,
    },
    async (args: any, extra: any) => {
      const teamId = getTeamId(extra);
      if (!teamId) return AUTH_ERROR;
      const issue = await getIssue(teamId, args.slug);
      return issue ? jsonResult(issue) : NOT_FOUND;
    },
  );
}
