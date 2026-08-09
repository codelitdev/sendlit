import type { McpToolRegistrar } from "../tool-registry";
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
import { AUTH_ERROR, INTERNAL_ERROR, NOT_FOUND, jsonResult } from "./responses";
import {
    successMessageSchema,
    systemTemplateSchema,
    templateSchema,
} from "./schemas";
import {
    emailContentInputSchema,
    templatePurposeSchema,
} from "@sendlit/api-contract";
import { TemplateValidationError } from "../../templates/validation";
import { getTeamId } from "./auth";
import { omitInternal } from "../../utils/public";

export function registerTemplateTools(server: McpToolRegistrar): void {
    server.registerTool(
        "list_system_templates",
        {
            description:
                "Returns built-in marketing and transactional starting templates. System templates are starters and must be copied into a team-owned template before transactional sending.",
            inputSchema: {
                purpose: templatePurposeSchema.optional(),
            },
            outputSchema: z.object({ items: z.array(systemTemplateSchema) }),
            annotations: {
                readOnlyHint: true,
                idempotentHint: true,
                openWorldHint: false,
            },
        },
        async (args: any, extra: any) => {
            const teamId = getTeamId(extra);
            if (!teamId) return AUTH_ERROR;
            return jsonResult({
                items: args.purpose
                    ? SYSTEM_TEMPLATES.filter(
                          (template) => template.purpose === args.purpose,
                      )
                    : SYSTEM_TEMPLATES,
            });
        },
    );

    server.registerTool(
        "list_templates",
        {
            description:
                "Returns reusable templates for the team, optionally filtered by marketing or transactional purpose.",
            inputSchema: {
                purpose: templatePurposeSchema.optional(),
            },
            outputSchema: z.object({ items: z.array(templateSchema) }),
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
                const items = await listTemplates(teamId, args.purpose);
                return jsonResult({
                    items: items.map((item) => omitInternal(item)),
                });
            } catch {
                return INTERNAL_ERROR;
            }
        },
    );

    server.registerTool(
        "get_template",
        {
            description: "Returns a single email template by its template ID.",
            inputSchema: { templateId: z.string().min(1) },
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
                return jsonResult(omitInternal(template));
            } catch {
                return INTERNAL_ERROR;
            }
        },
    );

    server.registerTool(
        "create_template",
        {
            description:
                "Creates a reusable marketing or transactional email template. Marketing content requires one final managed footer; transactional content rejects that footer and marketing-only variables.",
            inputSchema: {
                title: z.string().min(1),
                purpose: templatePurposeSchema,
                content: emailContentInputSchema.describe(
                    "A complete SendLit email document. Include all style sections (colors, typography.header/text/link, interactives, and structure) and only text, link, image, separator, or footer blocks. Use list_system_templates and duplicate_template as the safest valid starting point.",
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
                    purpose: args.purpose,
                    content: args.content,
                });
                return jsonResult(omitInternal(template));
            } catch (error) {
                if (error instanceof TemplateValidationError) {
                    return {
                        content: [
                            {
                                type: "text" as const,
                                text: JSON.stringify({
                                    error: error.message,
                                    variables: error.variables,
                                }),
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
        "update_template",
        {
            description: "Updates a template's title and/or content.",
            inputSchema: {
                templateId: z.string().min(1),
                title: z.string().min(1).optional(),
                content: emailContentInputSchema.optional(),
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
                return jsonResult(omitInternal(template));
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
                if (err instanceof TemplateValidationError) {
                    return {
                        content: [
                            {
                                type: "text" as const,
                                text: JSON.stringify({
                                    error: err.message,
                                    variables: err.variables,
                                }),
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
        "duplicate_template",
        {
            description:
                "Copies a system or team template into a new team-owned template with the same purpose as the source.",
            inputSchema: {
                templateId: z.string().min(1),
                title: z.string().min(1).optional(),
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
                const template = await duplicateTemplate({
                    teamId,
                    templateId: args.templateId,
                    title: args.title,
                });
                if (!template) return NOT_FOUND;
                return jsonResult(omitInternal(template));
            } catch (error) {
                if (error instanceof TemplateValidationError) {
                    return {
                        content: [
                            {
                                type: "text" as const,
                                text: JSON.stringify({
                                    error: error.message,
                                    variables: error.variables,
                                }),
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
            inputSchema: { templateId: z.string().min(1) },
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
