import { z } from "zod";

export const billingPlanSchema = z.enum(["oss", "free", "pro", "business"]);
export const billingIntervalSchema = z.enum(["month", "year"]);
export const paymentStatusSchema = z.enum([
    "free",
    "checkout_pending",
    "trialing",
    "active",
    "past_due",
    "cancel_at_period_end",
    "cancelled",
    "expired",
]);

export const billingOfferSchema = z.object({
    catalogKey: z.enum([
        "pro_month",
        "pro_year",
        "business_month",
        "business_year",
    ]),
    plan: z.enum(["pro", "business"]),
    interval: billingIntervalSchema,
    currency: z.string().regex(/^[A-Z]{3}$/),
    amountMinor: z.number().int().positive(),
    trialDays: z.number().int().nonnegative(),
});

export const billingCatalogSchema = z.object({
    catalogRevision: z.number().int().positive().nullable(),
    currency: z
        .string()
        .regex(/^[A-Z]{3}$/)
        .nullable(),
    offers: z.array(billingOfferSchema),
    checkoutAvailable: z.boolean(),
});

export const organizationPlanUsageSchema = z.object({
    plan: billingPlanSchema,
    paymentStatus: paymentStatusSchema,
    teams: z.number().int().nonnegative(),
    subscribedContacts: z.number().int().nonnegative(),
    monthlySends: z.number().int().nonnegative(),
    monthlySendsReserved: z.number().int().nonnegative(),
    bucketStartsAt: z.string(),
    bucketEndsAt: z.string(),
    teamsLimit: z.number().int().positive().nullable(),
    subscribedContactsLimit: z.number().int().positive().nullable(),
    monthlySendsLimit: z.number().int().positive().nullable(),
});

export const billingPlanChangeSummarySchema = z.object({
    changeId: z.string(),
    targetPlan: z.enum(["pro", "business"]),
    targetInterval: billingIntervalSchema,
    effectiveAt: z.enum(["immediately", "next_billing_date"]),
});

export const organizationBillingSchema = z.object({
    plan: billingPlanSchema,
    billingInterval: billingIntervalSchema.nullable(),
    paymentStatus: paymentStatusSchema,
    trialEndsAt: z.string().nullable(),
    currentPeriodEndsAt: z.string().nullable(),
    cancelAtPeriodEnd: z.boolean(),
    graceEndsAt: z.string().nullable(),
    canManageBilling: z.boolean(),
    entitlements: z.object({
        teamsLimit: z.number().int().positive().nullable(),
        subscribedContactsLimit: z.number().int().positive().nullable(),
        monthlySendsLimit: z.number().int().positive().nullable(),
        sharedOrganizationMailbox: z.boolean(),
        provisioning: z.boolean(),
        organizationApiKeys: z.boolean(),
        marketingBranding: z.boolean(),
    }),
    usage: organizationPlanUsageSchema,
    pendingPlanChange: billingPlanChangeSummarySchema.nullable(),
});

export const billingCheckoutBodySchema = z.object({
    plan: z.enum(["pro", "business"]),
    interval: billingIntervalSchema,
    catalogRevision: z.number().int().positive(),
});

export const billingCheckoutResponseSchema = z.object({
    checkoutUrl: z.string().url(),
    expiresAt: z.string(),
});

export const billingPortalResponseSchema = z.object({
    portalUrl: z.string().url(),
});

export const billingActionSchema = z.enum([
    "organization_checkout",
    "checkout",
    "portal",
    "plan_change",
    "organization_close",
    "pending_hide",
]);

export const billingActionTokenBodySchema = z.object({
    action: billingActionSchema,
    target: z.string().trim().min(1).max(300),
});

export const billingActionTokenResponseSchema = z.object({
    token: z.string().min(32),
    expiresAt: z.string().datetime(),
});

export const billingPlanChangeBodySchema = z.object({
    plan: z.enum(["pro", "business"]),
    interval: billingIntervalSchema,
    catalogRevision: z.number().int().positive(),
    idempotencyKey: z.string().trim().min(1).max(256).optional(),
});

export const billingPlanChangeResponseSchema = z.object({
    changeId: z.string(),
    status: z.enum(["pending", "succeeded", "failed", "conflicted"]),
    targetPlan: z.enum(["pro", "business"]),
    targetInterval: billingIntervalSchema,
    effectiveAt: z.enum(["immediately", "next_billing_date"]),
    paymentUrl: z.string().url().nullable(),
    completedAt: z.string().nullable(),
});

export const organizationCheckoutBodySchema = billingCheckoutBodySchema.extend({
    organizationName: z.string().trim().min(1).max(120),
    teamName: z.string().trim().min(1).max(120),
});

export const organizationCheckoutResponseSchema =
    billingCheckoutResponseSchema.extend({
        organizationId: z.string(),
    });

export const sendingDomainSchema = z.object({
    domainId: z.string(),
    domain: z.string(),
    status: z.enum(["pending", "verified", "revoked", "failed"]),
    verifiedAt: z.string().nullable(),
    lastCheckedAt: z.string().nullable(),
    nextCheckAt: z.string().nullable(),
    challengeToken: z.string().nullable(),
    challengeRecordName: z.string().nullable(),
    challengeRecordValue: z.string().nullable(),
});

export const createSendingDomainBodySchema = z.object({
    domain: z.string().trim().min(1).max(253),
});
