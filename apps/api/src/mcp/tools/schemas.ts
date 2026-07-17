import { z } from "zod";
import { contactFilterSchema, customFieldsSchema } from "@sendlit/api-contract";
import {
    mailTypes,
    sequenceStatus,
    emailActionTypes,
    feedbackCapableProviders,
} from "../../config/constants";

export const emailContentSchema = z.object({
    style: z.record(z.any()),
    meta: z.record(z.any()),
    content: z.array(z.record(z.any())),
});

export const contactSchema = z.object({
    contactId: z.string(),
    email: z.string(),
    name: z.string().nullable().optional(),
    subscribed: z.boolean(),
    customFields: customFieldsSchema,
    tags: z.array(z.string()),
    unsubscribeToken: z.string(),
    createdAt: z.string().or(z.date()),
    updatedAt: z.string().or(z.date()),
});

export const contactListSchema = z.object({
    items: z.array(contactSchema),
    total: z.number(),
});

export const contactDeliverySchema = z.object({
    sequenceId: z.string(),
    sequenceTitle: z.string(),
    sequenceType: z.string(),
    emailId: z.string(),
    createdAt: z.string().or(z.date()).nullable(),
});

export const contactDeliveryListSchema = z.object({
    items: z.array(contactDeliverySchema),
});

export const segmentSchema = z.object({
    segmentId: z.string(),
    name: z.string(),
    filter: contactFilterSchema,
    createdAt: z.string().or(z.date()),
    updatedAt: z.string().or(z.date()),
});

export const segmentListSchema = z.object({
    items: z.array(segmentSchema),
});

export const templateSchema = z.object({
    templateId: z.string().min(1),
    title: z.string(),
    content: emailContentSchema,
    createdAt: z.string().or(z.date()),
    updatedAt: z.string().or(z.date()),
});

export const mediaSchema = z.object({
    mediaId: z.string(),
    url: z.string(),
    thumbnailUrl: z.string().nullable().optional(),
    mediaLitId: z.string(),
    fileName: z.string().nullable().optional(),
    mimeType: z.string().nullable().optional(),
    size: z.number().nullable().optional(),
    width: z.number().nullable().optional(),
    height: z.number().nullable().optional(),
    alt: z.string().nullable().optional(),
    caption: z.string().nullable().optional(),
    createdAt: z.string().or(z.date()).nullable().optional(),
    updatedAt: z.string().or(z.date()).nullable().optional(),
});

export const mediaListSchema = z.object({
    items: z.array(mediaSchema),
    total: z.number(),
});

export const mediaReferenceSchema = z.object({
    resourceType: z.enum(["TEMPLATE", "SEQUENCE_EMAIL"]),
    resourcePublicId: z.string(),
    parentResourcePublicId: z.string().nullable().optional(),
    createdAt: z.string().or(z.date()).nullable().optional(),
    updatedAt: z.string().or(z.date()).nullable().optional(),
});

export const mediaReferenceListSchema = z.object({
    items: z.array(mediaReferenceSchema),
});

export const systemTemplateSchema = z.object({
    templateId: z.string().min(1),
    title: z.string(),
    description: z.string(),
    content: emailContentSchema,
});

export const sequenceEmailSchema = z.object({
    emailId: z.string(),
    // NOTE: intentionally no `sequenceId` here — the DB column of that name
    // on `sequence_emails` holds the *parent* sequence's internal id (see
    // `db/schema.ts`), not a public identifier, so it's never surfaced.
    subject: z.string(),
    content: emailContentSchema,
    delayInMillis: z.number(),
    published: z.boolean(),
    templateId: z.string().min(1).nullable().optional(),
    actionType: z.enum(emailActionTypes).nullable().optional(),
    actionData: z.record(z.any()).nullable().optional(),
});

export const sequenceSchema = z.object({
    sequenceId: z.string(),
    type: z.enum(mailTypes),
    title: z.string(),
    status: z.enum(sequenceStatus),
    espId: z.string().nullable(),
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
    teamId: z.string(),
    name: z.string(),
});

/** The secret is stored hashed; listings only expose `keyPrefix`. Only
 * `create_api_key` returns the full secret (see `createdApiKeySchema`). */
export const apiKeySchema = z.object({
    id: z.string(),
    keyPrefix: z.string(),
    name: z.string().nullable(),
    createdAt: z.string().or(z.date()).nullable(),
});

export const createdApiKeySchema = apiKeySchema.extend({
    key: z.string(),
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
    espId: z.string(),
    name: z.string(),
    isDefault: z.boolean(),
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

export const espConfigListSchema = z.object({
    items: z.array(espConfigSchema),
});

/** General (non-ESP) per-team settings singleton — see settings/general. */
export const generalSettingsSchema = z.object({
    mailingAddress: z.string().nullable(),
    updatedAt: z.string().or(z.date()).nullable().optional(),
});

// ---- Bounce and complaint processing (docs/bounces-and-complaints.md) -----

// Re-exported from the single source of truth so the MCP surface can never
// drift from the registered adapters (see `config/constants.ts`).
export { feedbackCapableProviders };

export const feedbackConnectionSchema = z.object({
    connectionId: z.string(),
    espId: z.string(),
    provider: z.string(),
    webhookUrl: z.string(),
    hasCredential: z.boolean(),
    status: z.enum([
        "pending",
        "healthy",
        "stale",
        "error",
        "retiring",
        "disabled",
    ]),
    lastReceivedAt: z.string().or(z.date()).nullable().optional(),
    lastVerifiedAt: z.string().or(z.date()).nullable().optional(),
    lastErrorCode: z.string().nullable().optional(),
});

export const deliveryEventSchema = z.object({
    eventId: z.string(),
    provider: z.string(),
    espId: z.string().nullable(),
    deliveryRoute: z.enum(["custom", "platform"]).nullable(),
    messageId: z.string().nullable(),
    recipientEmail: z.string().nullable(),
    eventType: z.string(),
    bounceClass: z.string().nullable().optional(),
    reason: z.string().nullable().optional(),
    occurredAt: z.string().or(z.date()),
    receivedAt: z.string().or(z.date()),
});

export const deliveryEventListSchema = z.object({
    items: z.array(deliveryEventSchema),
    total: z.number(),
});

export const suppressionSchema = z.object({
    suppressionId: z.string(),
    recipientEmail: z.string().nullable(),
    reason: z.enum([
        "hard_bounce",
        "complaint",
        "repeated_soft_bounce",
        "provider_suppression",
        "manual",
    ]),
    active: z.boolean(),
    firstSuppressedAt: z.string().or(z.date()),
    lastSuppressedAt: z.string().or(z.date()),
    releasedAt: z.string().or(z.date()).nullable().optional(),
    releaseReason: z.string().nullable().optional(),
});

export const suppressionListSchema = z.object({
    items: z.array(suppressionSchema),
    total: z.number(),
});
