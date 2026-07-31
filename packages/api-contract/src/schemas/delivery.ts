import { z } from "zod";

const nullableLimit = z.number().int().nonnegative().nullable();

export const organizationDeliveryPolicySchema = z.object({
    defaultEspId: z.string().nullable(),
    autoGrantDefaultEsp: z.boolean(),
    defaultDailyLimit: nullableLimit,
    defaultMonthlyLimit: nullableLimit,
    aggregateDailyLimit: nullableLimit,
    aggregateMonthlyLimit: nullableLimit,
    teamEspEnabledByDefault: z.boolean(),
    teamCanChangeDefault: z.boolean(),
    updatedAt: z.string(),
});

export const updateOrganizationDeliveryPolicyBodySchema = z
    .object({
        defaultEspId: z.string().nullable().optional(),
        autoGrantDefaultEsp: z.boolean().optional(),
        defaultDailyLimit: nullableLimit.optional(),
        defaultMonthlyLimit: nullableLimit.optional(),
        aggregateDailyLimit: nullableLimit.optional(),
        aggregateMonthlyLimit: nullableLimit.optional(),
        teamEspEnabledByDefault: z.boolean().optional(),
        teamCanChangeDefault: z.boolean().optional(),
    })
    .refine((value) => Object.keys(value).length > 0, {
        message: "At least one field is required",
    });

export const espGrantSchema = z.object({
    grantId: z.string(),
    teamId: z.string(),
    espId: z.string(),
    status: z.enum(["active", "draining", "suspended", "revoked"]),
    drainUntil: z.string().nullable(),
    fromName: z.string().nullable(),
    replyTo: z.string().nullable(),
    dailyLimit: nullableLimit,
    monthlyLimit: nullableLimit,
    createdAt: z.string(),
    updatedAt: z.string(),
});

export const upsertEspGrantBodySchema = z.object({
    espId: z.string(),
    fromName: z.string().nullable().optional(),
    replyTo: z.string().email().nullable().optional(),
    dailyLimit: nullableLimit.optional(),
    monthlyLimit: nullableLimit.optional(),
    /** Organization owners/integrations may select the newly granted shared
     * source as the team's default. This does not grant the team access to
     * the ESP credentials. */
    makeDefault: z.boolean().optional(),
});

export const transitionEspGrantBodySchema = z.discriminatedUnion("action", [
    z.object({ action: z.literal("suspend") }),
    z.object({ action: z.literal("resume") }),
    z.object({
        action: z.literal("drain"),
        drainUntil: z.string().datetime().optional(),
    }),
    z.object({ action: z.literal("cancel") }),
]);

export const teamDeliverySettingsSchema = z.object({
    teamEspEnabled: z.boolean(),
    teamCanChangeDefault: z.boolean(),
    defaultSource: z.enum(["organization", "team"]).nullable(),
    defaultTeamEspId: z.string().nullable(),
    updatedAt: z.string(),
});

export const updateTeamDeliverySettingsBodySchema = z.object({
    deliverySource: z.discriminatedUnion("type", [
        z.object({ type: z.literal("organization") }),
        z.object({ type: z.literal("team"), espId: z.string() }),
    ]),
});

/** Public source selector used by drafts and immediate sends. Organization
 * topology remains intentionally opaque to team-authorized callers. */
export const deliverySourceSelectionSchema = z.discriminatedUnion("type", [
    z.object({ type: z.literal("organization") }),
    z.object({
        type: z.literal("team"),
        espId: z.string().min(1).optional(),
    }),
]);

export const sendingOptionSchema = z.discriminatedUnion("type", [
    z.object({
        type: z.literal("organization"),
        name: z.string(),
        fromName: z.string().nullable(),
        fromEmail: z.string().nullable(),
        replyTo: z.string().nullable(),
        isDefault: z.boolean(),
        available: z.boolean(),
        countsAgainstQuota: z.literal(true),
    }),
    z.object({
        type: z.literal("team"),
        espId: z.string(),
        name: z.string(),
        fromName: z.string().nullable(),
        fromEmail: z.string().nullable(),
        isDefault: z.boolean(),
        available: z.boolean(),
        countsAgainstQuota: z.literal(false),
    }),
]);
