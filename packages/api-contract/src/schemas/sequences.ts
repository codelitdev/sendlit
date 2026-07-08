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
    // NOTE: intentionally no `id`/`sequenceId` here — `sequence_emails.id` is
    // internal-only, and its `sequence_id` column holds the *parent*
    // sequence's internal id (see `db/schema.ts`), not a public identifier.
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

const filterValueLabelSchema = z.object({
    valueLabel: z.string().optional(),
});

export const contactFilterConditionSchema = z.union([
    z
        .object({
            name: z.literal("email"),
            condition: z.enum(["is", "contains", "not_contains"]),
            value: z.string(),
        })
        .merge(filterValueLabelSchema),
    z
        .object({
            name: z.literal("tag"),
            condition: z.enum(["is", "is_not"]),
            value: z.string(),
        })
        .merge(filterValueLabelSchema),
    z
        .object({
            name: z.literal("subscription"),
            condition: z.literal("is"),
            value: z.enum(["subscribed", "unsubscribed"]),
        })
        .merge(filterValueLabelSchema),
    z
        .object({
            name: z.literal("signedUp"),
            condition: z.enum(["before", "after", "on"]),
            value: z
                .string()
                .refine((value) => Number.isFinite(Number(value)), {
                    message: "Expected a millisecond timestamp string",
                }),
        })
        .merge(filterValueLabelSchema),
    z
        .object({
            name: z.literal("customField"),
            key: z.string().min(1),
            condition: z.enum([
                "is",
                "is_not",
                "contains",
                "not_contains",
                "has",
                "not_has",
                "before",
                "after",
                "on",
                "exists",
                "not_exists",
            ]),
            value: z.string().optional(),
        })
        .merge(filterValueLabelSchema)
        .superRefine((filter, ctx) => {
            if (
                !["exists", "not_exists"].includes(filter.condition) &&
                typeof filter.value !== "string"
            ) {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    message: "Expected a value for this custom field filter",
                    path: ["value"],
                });
            }
        }),
]);

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
    sequenceId: z.string(),
    // Plain strings (see `contactSchema.lead`'s comment) — validated on write.
    type: z.string(),
    title: z.string(),
    status: z.string(),
    // NOTE: sender identity is intentionally NOT part of the public sequence
    // shape. Internally a sequence may pin an outbox (`sequences.outbox_id` →
    // `esp_configs.id`), but esp config is a per-team singleton addressed via
    // `/settings/esp` with no public id, so exposing the FK would leak an
    // internal id for no client benefit. Mail is sent with the team's esp
    // config identity — see settings/esp.
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
