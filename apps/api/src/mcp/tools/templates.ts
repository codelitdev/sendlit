import { emailContentInputSchema, templatePurposeSchema } from "@sendlit/api-contract";
import { z } from "zod";
import {
  createTemplate,
  getTemplate,
  listTemplates,
  updateTemplate,
} from "../../templates/queries";
import { TemplateValidationError } from "../../templates/validation";
import { omitInternal } from "../../utils/public";
import type { SendLitMcpTool } from "../context";
import { dedicatedTool } from "../tool";
import { notFound, type ToolError, toolError } from "./responses";
import { templateSchema } from "./schemas";

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
    name: "list_templates",
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
    operationId: "templates.create",
    risk: "write",
    description:
      "Creates a reusable marketing or transactional email template. Marketing content requires one final managed footer; transactional content rejects that footer and marketing-only variables.",
    inputSchema: z.object({
      title: z.string().min(1),
      purpose: templatePurposeSchema,
      content: emailContentInputSchema.describe(
        "A complete SendLit email document. Include all style sections (colors, typography.header/text/link, interactives, and structure) and only text, link, image, separator, or footer blocks. The safest valid starting point is a system template: list them with api.read (operation templates.listSystem) and copy one with api.write (templates.duplicate).",
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
];
