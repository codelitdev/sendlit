import { z } from "zod";

export const contactSchema = z.object({
    id: z.string(),
    teamId: z.string(),
    contactId: z.string(),
    email: z.string(),
    name: z.string().nullable().optional(),
    active: z.boolean(),
    subscribedToUpdates: z.boolean(),
    customFields: z.record(z.string()).default({}),
    tags: z.array(z.string()),
    unsubscribeToken: z.string(),
    createdAt: z.string().nullable(),
    updatedAt: z.string().nullable(),
});

export const createContactBodySchema = z.object({
    email: z.string().email(),
    name: z.string().optional(),
    tags: z.array(z.string()).optional(),
    customFields: z.record(z.string()).optional(),
});

export const updateContactBodySchema = z.object({
    name: z.string().optional(),
    active: z.boolean().optional(),
    subscribedToUpdates: z.boolean().optional(),
    tags: z.array(z.string()).optional(),
    customFields: z.record(z.string()).optional(),
});

export const listContactsQuerySchema = z.object({
    q: z.string().optional(),
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
