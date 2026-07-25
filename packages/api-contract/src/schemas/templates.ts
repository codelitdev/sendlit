import { z } from "zod";
import { emailContentSchema } from "./common";

export const templatePurposes = ["marketing", "transactional"] as const;
export const templatePurposeSchema = z
    .enum(templatePurposes)
    .describe(
        "Immutable sending purpose. Marketing templates require a final managed footer; transactional templates are footer-free and are valid for POST /emails.",
    );
export type TemplatePurpose = z.infer<typeof templatePurposeSchema>;

export const templateVariableDefinitionSchema = z.object({
    path: z.string().min(1).describe("Dot-separated Liquid variable path."),
    description: z.string().describe("Human-readable value description."),
    example: z.any().describe("Example value used in generated requests."),
});
export type TemplateVariableDefinition = z.infer<
    typeof templateVariableDefinitionSchema
>;

export const emailTemplateSchema = z.object({
    templateId: z.string(),
    title: z.string(),
    purpose: templatePurposeSchema,
    content: emailContentSchema,
    requiredVariables: z
        .array(z.string())
        .describe(
            "Sorted, server-discovered Liquid paths that must be supplied. Defaults and inactive guarded branches are omitted.",
        ),
    validationError: z
        .string()
        .optional()
        .describe(
            "Present only for a retired template that predates the managed-footer format. It cannot be edited, duplicated, or sent; recreate it instead.",
        ),
    createdAt: z.string().nullable(),
    updatedAt: z.string().nullable(),
});

export const createTemplateBodySchema = z.object({
    title: z.string().min(1),
    purpose: templatePurposeSchema.default("marketing"),
    content: emailContentSchema,
});

export const updateTemplateBodySchema = z.object({
    title: z.string().min(1).optional(),
    content: emailContentSchema.optional(),
});

/** Built-in starting templates (`apps/api/src/templates/system-templates.ts`)
 * \u2014 not team-scoped, identical for every team. */
export const systemTemplateSchema = z.object({
    templateId: z.string(),
    title: z.string(),
    description: z.string(),
    purpose: templatePurposeSchema,
    content: emailContentSchema,
    requiredVariables: z
        .array(z.string())
        .describe(
            "Sorted, server-discovered Liquid paths that must be supplied.",
        ),
    variableDefinitions: z
        .array(templateVariableDefinitionSchema)
        .optional()
        .describe(
            "Documentation metadata for built-in starter variables; runtime discovery remains authoritative.",
        ),
});

export const listTemplatesQuerySchema = z.object({
    purpose: templatePurposeSchema.optional(),
});

export const duplicateTemplateBodySchema = z.object({
    title: z.string().min(1).optional(),
});

export const templateValidationErrorSchema = z.object({
    error: z.string(),
    variables: z.array(z.string()).optional(),
});

export const templateNotTransactionalErrorSchema = z.object({
    error: z.literal("template_not_transactional"),
});

export const templateNotMarketingErrorSchema = z.object({
    error: z.literal("template_not_marketing"),
});
