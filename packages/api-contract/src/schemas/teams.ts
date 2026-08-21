import { z } from "zod";

export const teamSchema = z.object({
    teamId: z.string(),
    /** Public organization identifier. Present when an end user lists the
     * teams they belong to, so the dashboard can keep workspace selection
     * scoped to one organization. */
    organizationId: z.string().optional(),
    organizationName: z.string().optional(),
    name: z.string(),
    status: z.enum(["active", "sending_suspended", "archived"]),
    externalId: z.string().nullable().optional(),
    createdAt: z.string().nullable().optional(),
    updatedAt: z.string().nullable().optional(),
    /** True when the calling human is already a `team_members` row. Always
     * false for organization API keys. Omitted on non-list team payloads. */
    viewerIsMember: z.boolean().optional(),
});

/** The key's secret is stored hashed and never returned after creation —
 * list/read surfaces only ever see `keyPrefix` (e.g. `sl_live_a1b2`). */
export const apiKeySchema = z.object({
    keyId: z.string(),
    keyPrefix: z.string(),
    name: z.string(),
    expiresAt: z.string().nullable().optional(),
    lastUsedAt: z.string().nullable().optional(),
    revokedAt: z.string().nullable().optional(),
    createdAt: z.string().nullable().optional(),
});

/** Creation is the one response that carries the full `sl_live_...` secret. */
export const createdApiKeySchema = apiKeySchema.extend({
    key: z.string(),
});

export const createTeamBodySchema = z.object({ name: z.string().min(1) });
export const renameTeamBodySchema = z.object({ name: z.string().min(1) });
export const createApiKeyBodySchema = z.object({ name: z.string().min(1) });

export const provisionTeamBodySchema = z.object({
    externalId: z.string().min(1),
    name: z.string().min(1),
    sender: z
        .object({
            fromName: z.string().min(1).optional(),
            replyTo: z.string().email().optional(),
        })
        .optional(),
    mailingAddress: z.string().min(1).optional(),
    delivery: z
        .object({
            useOrganizationDefault: z.boolean().optional(),
            teamEspEnabled: z.boolean().optional(),
            teamCanChangeDefault: z.boolean().optional(),
        })
        .optional(),
    quota: z
        .object({
            dailyLimit: z.number().int().positive().nullable().optional(),
            monthlyLimit: z.number().int().positive().nullable().optional(),
        })
        .optional(),
});

const provisionedTeamBaseSchema = z.object({
    teamId: z.string(),
    externalId: z.string(),
    name: z.string(),
    deliverySource: z.object({ type: z.literal("organization") }),
});

export const provisionTeamResponseSchema = z.discriminatedUnion("created", [
    provisionedTeamBaseSchema.extend({
        created: z.literal(true),
        apiKey: z.string(),
    }),
    provisionedTeamBaseSchema.extend({
        created: z.literal(false),
        apiKey: z.null(),
    }),
]);

/** The organization-key lifecycle surface deliberately returns no provider,
 * grant, or organization topology. */
export const provisionedTeamSchema = provisionedTeamBaseSchema.extend({
    status: z.enum(["active", "sending_suspended", "archived"]),
    mailingAddress: z.string().nullable(),
    teamEspEnabled: z.boolean(),
    teamCanChangeDefault: z.boolean(),
    createdAt: z.string().nullable(),
    updatedAt: z.string().nullable(),
});

export const updateProvisionedTeamBodySchema = z
    .object({
        name: z.string().min(1).optional(),
        sender: z
            .object({
                fromName: z.string().min(1).nullable().optional(),
                replyTo: z.string().email().nullable().optional(),
            })
            .optional(),
        mailingAddress: z.string().min(1).nullable().optional(),
        delivery: z
            .object({
                teamEspEnabled: z.boolean().optional(),
                teamCanChangeDefault: z.boolean().optional(),
            })
            .optional(),
        quota: z
            .object({
                dailyLimit: z
                    .number()
                    .int()
                    .nonnegative()
                    .nullable()
                    .optional(),
                monthlyLimit: z
                    .number()
                    .int()
                    .nonnegative()
                    .nullable()
                    .optional(),
            })
            .optional(),
    })
    .refine((body) => Object.keys(body).length > 0, {
        message: "At least one field is required",
    });

export const usageWindowSchema = z.object({
    limit: z.number().int().nullable(),
    accepted: z.number().int().nonnegative(),
    reserved: z.number().int().nonnegative(),
    remaining: z.number().int().nullable(),
    resetsAt: z.string(),
});

export const provisionedTeamUsageSchema = z.object({
    day: usageWindowSchema,
    month: usageWindowSchema,
});
