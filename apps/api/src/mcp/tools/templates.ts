import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  createTemplate,
  deleteTemplate,
  getTemplate,
  listTemplates,
  updateTemplate,
} from "../../templates/queries";
import { SYSTEM_TEMPLATES } from "../../templates/system-templates";
import { AUTH_ERROR, INTERNAL_ERROR, NOT_FOUND, jsonResult } from "./responses";
import {
  emailContentSchema,
  successMessageSchema,
  systemTemplateSchema,
  templateSchema,
} from "./schemas";
import { getTeamId } from "./auth";

export function registerTemplateTools(server: McpServer): void {
  server.registerTool(
    "list_system_templates",
    {
      description:
        "Returns the built-in starting templates (Announcement, New user welcome, Upsell products, Newsletter, Blank) offered alongside a team's own templates when creating a template, broadcast, sequence, or adding an email to a sequence. Not team-scoped — the same for every team.",
      outputSchema: z.object({ items: z.array(systemTemplateSchema) }),
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (extra: any) => {
      const teamId = getTeamId(extra);
      if (!teamId) return AUTH_ERROR;
      return jsonResult({ items: SYSTEM_TEMPLATES });
    },
  );

  server.registerTool(
    "list_templates",
    {
      description: "Returns every reusable email template for the team.",
      outputSchema: z.object({ items: z.array(templateSchema) }),
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (extra: any) => {
      const teamId = getTeamId(extra);
      if (!teamId) return AUTH_ERROR;
      try {
        const items = await listTemplates(teamId);
        return jsonResult({ items });
      } catch {
        return INTERNAL_ERROR;
      }
    },
  );

  server.registerTool(
    "get_template",
    {
      description: "Returns a single email template by its template ID.",
      inputSchema: { templateId: z.string() },
      outputSchema: templateSchema,
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
        const template = await getTemplate(args.templateId);
        if (!template || template.teamId !== teamId) return NOT_FOUND;
        return jsonResult(template);
      } catch {
        return INTERNAL_ERROR;
      }
    },
  );

  server.registerTool(
    "create_template",
    {
      description:
        "Creates a reusable email template. If the title already exists, a numeric suffix is added automatically.",
      inputSchema: {
        title: z.string().min(1),
        content: emailContentSchema.describe(
          "The email body: { style, meta, content: EmailBlock[] } — see @sendlit/email-editor",
        ),
      },
      outputSchema: templateSchema,
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
        const template = await createTemplate({
          teamId,
          title: args.title,
          content: args.content,
        });
        return jsonResult(template);
      } catch {
        return INTERNAL_ERROR;
      }
    },
  );

  server.registerTool(
    "update_template",
    {
      description: "Updates a template's title and/or content.",
      inputSchema: {
        templateId: z.string(),
        title: z.string().min(1).optional(),
        content: emailContentSchema.optional(),
      },
      outputSchema: templateSchema,
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
        const template = await updateTemplate({
          teamId,
          templateId: args.templateId,
          title: args.title,
          content: args.content,
        });
        if (!template) return NOT_FOUND;
        return jsonResult(template);
      } catch (err: any) {
        if (err.message === "duplicate_title") {
          return {
            content: [
              {
                type: "text" as const,
                text: "A template with this title already exists.",
              },
            ],
            isError: true,
          };
        }
        return INTERNAL_ERROR;
      }
    },
  );

  server.registerTool(
    "delete_template",
    {
      description: "Permanently deletes an email template.",
      inputSchema: { templateId: z.string() },
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
        await deleteTemplate(teamId, args.templateId);
        return jsonResult({ message: "Template deleted." });
      } catch {
        return INTERNAL_ERROR;
      }
    },
  );
}
