import { emailContentInputSchema, templatePurposeSchema } from "@sendlit/api-contract";
import { z } from "zod";
import {
  createTemplate,
  deleteTemplate,
  duplicateTemplate,
  getTemplate,
  listTemplates,
  updateTemplate,
} from "../../templates/queries";
import { SYSTEM_TEMPLATES } from "../../templates/system-templates";
import { TemplateValidationError } from "../../templates/validation";
import { omitInternal } from "../../utils/public";
import type { SendLitMcpTool } from "../context";
import { dedicatedTool } from "../tool";
import { notFound, type ToolError, toolError } from "./responses";
import { successMessageSchema, systemTemplateSchema, templateSchema } from "./schemas";

/** Template content the purpose's rules reject, with the variables at fault
 * (comma-separated, as safe details are flat). */
function templateValidationError(error: TemplateValidationError): ToolError {
  return toolError("validation_failed", {
    reason: error.message,
    ...(error.variables?.length ? { variables: error.variables.join(", ") } : {}),
  });
}

export const templateTools = (): SendLitMcpTool[] => [
  dedicatedTool({
    name: "list_system_templates",
    title: "List System Templates",
    operationId: "templates.listSystem",
    risk: "read",
    description:
      "Returns built-in marketing and transactional starting templates. System templates are starters and must be copied into a team-owned template before transactional sending.",
    inputSchema: z.object({ purpose: templatePurposeSchema.optional() }),
    outputSchema: z.object({ items: z.array(systemTemplateSchema) }),
    annotations: { idempotentHint: true, openWorldHint: false },
    async handler({ args }) {
      return {
        items: args.purpose
          ? SYSTEM_TEMPLATES.filter((template) => template.purpose === args.purpose)
          : SYSTEM_TEMPLATES,
      };
    },
  }),

  dedicatedTool({
    name: "list_templates",
    title: "List Templates",
    operationId: "templates.list",
    risk: "read",
    description:
      "Returns reusable templates for the team, optionally filtered by marketing or transactional purpose.",
    inputSchema: z.object({ purpose: templatePurposeSchema.optional() }),
    outputSchema: z.object({ items: z.array(templateSchema) }),
    annotations: { idempotentHint: true, openWorldHint: false },
    async handler({ context, args }) {
      const items = await listTemplates(context.teamId, args.purpose);
      return { items: items.map((item) => omitInternal(item)) };
    },
  }),

  dedicatedTool({
    name: "get_template",
    title: "Get Template",
    operationId: "templates.get",
    risk: "read",
    description: "Returns a single email template by its template ID.",
    inputSchema: z.object({ templateId: z.string().min(1) }),
    outputSchema: templateSchema,
    annotations: { idempotentHint: true, openWorldHint: false },
    async handler({ context, args }) {
      const template = await getTemplate(args.templateId);
      if (!template || template.teamId !== context.teamId) return notFound();
      return omitInternal(template);
    },
  }),

  dedicatedTool({
    name: "create_template",
    title: "Create Template",
    operationId: "templates.create",
    risk: "write",
    description:
      "Creates a reusable marketing or transactional email template. Marketing content requires one final managed footer; transactional content rejects that footer and marketing-only variables.",
    inputSchema: z.object({
      title: z.string().min(1),
      purpose: templatePurposeSchema,
      content: emailContentInputSchema.describe(
        "A complete SendLit email document. Include all style sections (colors, typography.header/text/link, interactives, and structure) and only text, link, image, separator, spacer, columns, social, html, conditional (marketing only), or footer blocks. Use list_system_templates and duplicate_template as the safest valid starting point.",
      ),
    }),
    outputSchema: templateSchema,
    annotations: { openWorldHint: false },
    async handler({ context, args }) {
      try {
        const template = await createTemplate({
          teamId: context.teamId,
          title: args.title,
          purpose: args.purpose,
          content: args.content as Parameters<typeof createTemplate>[0]["content"],
        });
        return omitInternal(template);
      } catch (error) {
        if (error instanceof TemplateValidationError) {
          return templateValidationError(error);
        }
        throw error;
      }
    },
  }),

  dedicatedTool({
    name: "update_template",
    title: "Update Template",
    operationId: "templates.update",
    risk: "write",
    description: "Updates a template's title and/or content.",
    inputSchema: z.object({
      templateId: z.string().min(1),
      title: z.string().min(1).optional(),
      content: emailContentInputSchema.optional(),
    }),
    outputSchema: templateSchema,
    annotations: { openWorldHint: false },
    async handler({ context, args }) {
      try {
        const template = await updateTemplate({
          teamId: context.teamId,
          templateId: args.templateId,
          title: args.title,
          content: args.content as Parameters<typeof updateTemplate>[0]["content"],
        });
        if (!template) return notFound();
        return omitInternal(template);
      } catch (error) {
        if (error instanceof Error && error.message === "duplicate_title") {
          return toolError("conflict", {
            reason: "duplicate_title",
            message: "A template with this title already exists.",
          });
        }
        if (error instanceof TemplateValidationError) {
          return templateValidationError(error);
        }
        throw error;
      }
    },
  }),

  dedicatedTool({
    name: "duplicate_template",
    title: "Duplicate Template",
    operationId: "templates.duplicate",
    risk: "write",
    description:
      "Copies a system or team template into a new team-owned template with the same purpose as the source.",
    inputSchema: z.object({
      templateId: z.string().min(1),
      title: z.string().min(1).optional(),
    }),
    outputSchema: templateSchema,
    annotations: { openWorldHint: false },
    async handler({ context, args }) {
      try {
        const template = await duplicateTemplate({
          teamId: context.teamId,
          templateId: args.templateId,
          title: args.title,
        });
        if (!template) return notFound();
        return omitInternal(template);
      } catch (error) {
        if (error instanceof TemplateValidationError) {
          return templateValidationError(error);
        }
        throw error;
      }
    },
  }),

  dedicatedTool({
    name: "delete_template",
    title: "Delete Template",
    operationId: "templates.remove",
    risk: "destructive",
    description:
      "Permanently deletes an email template. Its images that no other template or email uses are deleted from the media library, unless a transactional email was sent with it.",
    inputSchema: z.object({ templateId: z.string().min(1) }),
    outputSchema: successMessageSchema,
    annotations: { openWorldHint: false },
    async handler({ context, args }) {
      await deleteTemplate(context.teamId, args.templateId);
      return { message: "Template deleted." };
    },
  }),
];
