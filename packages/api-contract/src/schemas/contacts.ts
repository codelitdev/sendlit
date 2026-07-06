import { z } from "zod";
import { contactFilterSchema } from "./sequences";
import { customFieldsSchema } from "./custom-fields";

export function parseContactFilterQueryParam(value: string) {
    try {
        return contactFilterSchema.safeParse(JSON.parse(value));
    } catch {
        return { success: false } as const;
    }
}

export const contactSchema = z.object({
    contactId: z.string(),
    email: z.string(),
    name: z.string().nullable().optional(),
    subscribed: z.boolean(),
    customFields: customFieldsSchema,
    tags: z.array(z.string()),
    unsubscribeToken: z.string(),
    createdAt: z.string().nullable(),
    updatedAt: z.string().nullable(),
});

export const createContactBodySchema = z.object({
    email: z.string().email(),
    name: z.string().optional(),
    tags: z.array(z.string()).optional(),
    customFields: customFieldsSchema.optional(),
});

export const updateContactBodySchema = z.object({
    name: z.string().optional(),
    subscribed: z.boolean().optional(),
    tags: z.array(z.string()).optional(),
    customFields: customFieldsSchema.optional(),
});

export const listContactsQuerySchema = z.object({
    q: z
        .string()
        .optional()
        .describe("Search term matched against email or name"),
    segmentId: z
        .string()
        .optional()
        .describe(
            "Only return contacts matching this saved segment's filter; combines with q using AND",
        ),
    filter: z
        .string()
        .optional()
        .describe(
            "Serialized ContactFilterWithAggregator JSON; combines with q and segmentId using AND",
        ),
    offset: z.coerce.number().int().min(1).optional(),
    rowsPerPage: z.coerce.number().int().min(1).optional(),
});

export const contactDeliverySchema = z.object({
    sequenceId: z.string(),
    sequenceTitle: z.string(),
    sequenceType: z.string(),
    emailId: z.string(),
    createdAt: z.string().nullable(),
});
