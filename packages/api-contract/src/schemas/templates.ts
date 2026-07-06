import { z } from "zod";
import { emailContentSchema } from "./common";

export const emailTemplateSchema = z.object({
    templateId: z.string(),
    title: z.string(),
    content: emailContentSchema,
    createdAt: z.string().nullable(),
    updatedAt: z.string().nullable(),
});

export const createTemplateBodySchema = z.object({
    title: z.string().min(1),
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
    content: emailContentSchema,
});
