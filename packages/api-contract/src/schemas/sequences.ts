import { z } from "zod";
import { emailContentSchema } from "./common";

export const mailTypes = ["broadcast", "sequence"] as const;
export const sequenceStatus = [
    "draft",
    "active",
    "paused",
    "completed",
] as const;
export const emailActionTypes = ["tag:add", "tag:remove"] as const;

export const sequenceEmailSchema = z.object({
    id: z.string(),
    sequenceId: z.string(),
    emailId: z.string(),
    subject: z.string(),
    content: emailContentSchema,
    delayInMillis: z.number(),
    published: z.boolean(),
    templateId: z.string().nullable().optional(),
    // Plain string (see `contactSchema.lead`'s comment) — validated on write.
    actionType: z.string().nullable().optional(),
    actionData: z.record(z.any()).nullable().optional(),
    createdAt: z.string().nullable(),
    updatedAt: z.string().nullable(),
});

export const contactFilterConditionSchema = z.object({
    name: z.enum(["tag", "email", "subscription", "signedUp"]),
    condition: z.string(),
    value: z.string(),
    valueLabel: z.string().optional(),
});

export const contactFilterSchema = z.object({
    aggregator: z.enum(["and", "or"]),
    filters: z.array(contactFilterConditionSchema),
});

export const sequenceReportSchema = z.object({
    broadcast: z
        .object({
            sentAt: z.number().nullable(),
            lockedAt: z.number().nullable(),
        })
        .optional(),
    sequence: z
        .object({
            subscribers: z.array(z.string()).optional(),
            unsubscribers: z.array(z.string()).optional(),
            failed: z.array(z.string()).optional(),
        })
        .optional(),
});

export const sequenceSchema = z.object({
    id: z.string(),
    teamId: z.string(),
    sequenceId: z.string(),
    // Plain strings (see `contactSchema.lead`'s comment) — validated on write.
    type: z.string(),
    title: z.string(),
    status: z.string(),
    fromName: z.string().nullable().optional(),
    fromEmail: z.string().nullable().optional(),
    triggerType: z.string().nullable().optional(),
    triggerData: z.string().nullable().optional(),
    filter: z.any().nullable().optional(),
    excludeFilter: z.any().nullable().optional(),
    emailsOrder: z.array(z.string()),
    entrants: z.array(z.string()),
    report: z.any(),
    createdAt: z.string().nullable(),
    updatedAt: z.string().nullable(),
    emails: z.array(sequenceEmailSchema),
});

export const listSequencesQuerySchema = z.object({
    type: z.enum(mailTypes),
    offset: z.coerce.number().int().min(1).optional(),
    itemsPerPage: z.coerce.number().int().min(1).optional(),
});

export const createSequenceBodySchema = z.object({
    type: z.enum(mailTypes),
    templateId: z.string().min(1),
});

export const updateSequenceBodySchema = z.object({
    title: z.string().optional(),
    fromName: z.string().optional(),
    fromEmail: z.string().email().optional(),
    triggerType: z.string().optional(),
    triggerData: z.string().optional(),
    filter: contactFilterSchema.optional(),
    emailsOrder: z.array(z.string()).optional(),
});

export const addSequenceEmailBodySchema = z.object({
    templateId: z.string().min(1),
});

export const updateSequenceEmailBodySchema = z.object({
    subject: z.string().optional(),
    content: emailContentSchema.optional(),
    delayInMillis: z.number().optional(),
    templateId: z.string().min(1).optional(),
    actionType: z.enum(emailActionTypes).optional(),
    actionData: z.record(z.any()).optional(),
    published: z.boolean().optional(),
});

export const sequenceStatsSchema = z.object({
    sent: z.number(),
    openRate: z.number(),
    clickThroughRate: z.number(),
    subscribersCount: z.number(),
});

export const listSubscribersQuerySchema = z.object({
    page: z.coerce.number().int().min(1).optional(),
    limit: z.coerce.number().int().min(1).optional(),
});
