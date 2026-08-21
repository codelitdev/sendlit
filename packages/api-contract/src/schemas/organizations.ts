import { z } from "zod";

export const organizationRoleSchema = z.enum(["owner", "admin", "member"]);

export const organizationSchema = z.object({
    organizationId: z.string(),
    name: z.string(),
    status: z.enum(["active", "suspended", "closed"]),
    createdAt: z.string(),
    updatedAt: z.string(),
});

export const organizationMemberSchema = z.object({
    userId: z.string(),
    email: z.string().email(),
    name: z.string(),
    image: z.string().nullable(),
    role: organizationRoleSchema,
    createdAt: z.string(),
    updatedAt: z.string(),
});

export const createOrganizationBodySchema = z.object({
    name: z.string().trim().min(1),
});

export const updateOrganizationBodySchema = z.object({
    name: z.string().trim().min(1),
});

export const addOrganizationMemberBodySchema = z.object({
    /** Existing Better Auth user only. This is a membership lookup, never an
     * authentication or account-creation flow. */
    email: z.string().trim().email(),
    role: organizationRoleSchema,
});

export const updateOrganizationMemberBodySchema = z.object({
    role: organizationRoleSchema,
});

export const organizationKeyScopes = [
    "organization:read",
    "teams:provision",
    "teams:read",
    "teams:manage",
    "teams:keys",
    "esps:read",
    "esps:manage",
    "grants:manage",
    "usage:read",
] as const;

export const organizationApiKeySchema = z.object({
    keyId: z.string(),
    name: z.string(),
    keyPrefix: z.string(),
    scopes: z.array(z.enum(organizationKeyScopes)),
    expiresAt: z.string().nullable(),
    lastUsedAt: z.string().nullable(),
    revokedAt: z.string().nullable(),
    createdAt: z.string(),
});

export const createOrganizationApiKeyBodySchema = z.object({
    name: z.string().trim().min(1),
    scopes: z.array(z.enum(organizationKeyScopes)).min(1),
    expiresAt: z.string().datetime().nullable().optional(),
});

export const createdOrganizationApiKeySchema = organizationApiKeySchema.extend({
    key: z.string(),
});

const organizationUsageWindowSchema = z.object({
    limit: z.number().int().nullable(),
    accepted: z.number().int().nonnegative(),
    reserved: z.number().int().nonnegative(),
    remaining: z.number().int().nullable(),
    resetsAt: z.string(),
});

/** Aggregate usage for the organization-owned delivery pool. Team-specific
 * usage remains available through the provisioning team usage endpoint. */
export const organizationUsageSchema = z.object({
    day: organizationUsageWindowSchema,
    month: organizationUsageWindowSchema,
});

/** Transactional-mail window, in days. Defaults to the last 7 days. */
export const organizationMailActivityQuerySchema = z.object({
    rangeDays: z.coerce
        .number()
        .int()
        .refine((value) => [1, 3, 7, 30].includes(value))
        .optional(),
});

export const organizationMailCountsSchema = z.object({
    sent: z.number().int().nonnegative(),
    queued: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
    bounced: z.number().int().nonnegative(),
});

export const organizationMailActivityTeamSchema = z.object({
    teamId: z.string(),
    name: z.string(),
    status: z.enum(["active", "sending_suspended", "archived"]),
    externalId: z.string().nullable(),
    mail: organizationMailCountsSchema,
});

/** Per-team and org-total transactional mail counts. Does not include
 * campaigns, broadcasts, sequences, recipients, subjects, or bodies. */
export const organizationMailActivitySchema = z.object({
    rangeDays: z.union([
        z.literal(1),
        z.literal(3),
        z.literal(7),
        z.literal(30),
    ]),
    totals: organizationMailCountsSchema,
    teams: z.array(organizationMailActivityTeamSchema),
});

export const organizationEnterTeamBodySchema = z.object({});

export const organizationEnterTeamResponseSchema = z.object({
    teamId: z.string(),
    role: z.enum(["admin", "member"]),
    created: z.boolean(),
});

/** Secret-free, administrator-visible organization activity. Internal UUIDs
 * are intentionally not exposed; optional resource references use public IDs. */
export const organizationAuditEventSchema = z.object({
    action: z.string(),
    actorType: z.enum(["user", "organization_key", "team_key", "system"]),
    teamId: z.string().nullable(),
    espId: z.string().nullable(),
    grantId: z.string().nullable(),
    metadata: z.record(z.any()),
    createdAt: z.string(),
});
