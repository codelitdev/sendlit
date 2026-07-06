import { z } from "zod";
import {
    mailTypes,
    sequenceStatus,
    emailActionTypes,
} from "../../config/constants";

export const emailContentSchema = z.object({
    style: z.record(z.any()),
    meta: z.record(z.any()),
    content: z.array(z.record(z.any())),
});

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
    createdAt: z.string().or(z.date()),
    updatedAt: z.string().or(z.date()),
});

export const contactListSchema = z.object({
    items: z.array(contactSchema),
    total: z.number(),
});

export const templateSchema = z.object({
    id: z.string(),
    teamId: z.string(),
    templateId: z.string().min(1),
    title: z.string(),
    content: emailContentSchema,
    createdAt: z.string().or(z.date()),
    updatedAt: z.string().or(z.date()),
});

export const systemTemplateSchema = z.object({
    templateId: z.string().min(1),
    title: z.string(),
    description: z.string(),
    content: emailContentSchema,
});

export const sequenceEmailSchema = z.object({
    emailId: z.string(),
    subject: z.string(),
    content: emailContentSchema,
    delayInMillis: z.number(),
    published: z.boolean(),
    templateId: z.string().min(1).nullable().optional(),
    actionType: z.enum(emailActionTypes).nullable().optional(),
    actionData: z.record(z.any()).nullable().optional(),
});

export const sequenceSchema = z.object({
    id: z.string(),
    teamId: z.string(),
    sequenceId: z.string(),
    type: z.enum(mailTypes),
    title: z.string(),
    status: z.enum(sequenceStatus),
    fromName: z.string().nullable().optional(),
    fromEmail: z.string().nullable().optional(),
    triggerType: z.string().nullable().optional(),
    triggerData: z.string().nullable().optional(),
    filter: z.record(z.any()).nullable().optional(),
    excludeFilter: z.record(z.any()).nullable().optional(),
    emailsOrder: z.array(z.string()),
    entrants: z.number().optional(),
    report: z.record(z.any()).nullable().optional(),
    emails: z.array(sequenceEmailSchema),
});

export const sequenceListSchema = z.object({
    items: z.array(sequenceSchema),
    total: z.number(),
});

export const sequenceStatsSchema = z.object({
    sent: z.number(),
    openRate: z.number(),
    clickThroughRate: z.number(),
    subscribersCount: z.number(),
});

export const successMessageSchema = z.object({
    message: z.string(),
});

export const testEspResultSchema = z.object({
    success: z.boolean(),
    error: z.string().optional(),
});

export const teamSchema = z.object({
    id: z.string(),
    name: z.string(),
});

export const apiKeySchema = z.object({
    key: z.string(),
    name: z.string(),
    teamId: z.string(),
    createdAt: z.string().or(z.date()),
});

export const espProviders = [
    "smtp",
    "sendgrid",
    "mailgun",
    "postmark",
    "ses",
    "resend",
    "custom",
] as const;

export const espConfigSchema = z.object({
    provider: z.enum(espProviders),
    host: z.string(),
    port: z.number(),
    secure: z.boolean(),
    username: z.string().nullable().optional(),
    hasPassword: z.boolean(),
    fromName: z.string().nullable().optional(),
    fromEmail: z.string().nullable().optional(),
    lastTestedAt: z.string().or(z.date()).nullable().optional(),
    lastTestStatus: z.string().nullable().optional(),
    lastTestError: z.string().nullable().optional(),
});
