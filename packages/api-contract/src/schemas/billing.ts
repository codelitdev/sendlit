import { z } from "zod";

/** Hosted paid plans, cheapest first. Limits live in the API's plan
 * policies; prices live in the billing catalog. */
export const paidPlans = ["starter", "pro", "business"] as const;
export type PaidPlan = (typeof paidPlans)[number];
export const billingPlans = ["oss", "free", ...paidPlans] as const;
export type BillingPlan = (typeof billingPlans)[number];
export const billingCatalogKeys = paidPlans.flatMap(
  (plan) => [`${plan}_month`, `${plan}_year`] as const,
);
export type BillingCatalogKey = `${PaidPlan}_${"month" | "year"}`;

export const billingPlanSchema = z.enum(billingPlans);
export const paidPlanSchema = z.enum(paidPlans);
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
  catalogKey: z.enum(billingCatalogKeys as [BillingCatalogKey, ...BillingCatalogKey[]]),
  plan: paidPlanSchema,
  interval: billingIntervalSchema,
  currency: z.string().regex(/^[A-Z]{3}$/),
  amountMinor: z.number().int().positive(),
  trialDays: z.number().int().nonnegative(),
});

/** What each paid plan includes, from the API's plan policies, so clients
 * never hard-code limits. */
export const billingPlanFeaturesSchema = z.object({
  plan: paidPlanSchema,
  teamsLimit: z.number().int().positive().nullable(),
  monthlySendsLimit: z.number().int().positive().nullable(),
  marketingBranding: z.boolean(),
  sharedOrganizationMailbox: z.boolean(),
  provisioning: z.boolean(),
  organizationApiKeys: z.boolean(),
});

export const billingCatalogSchema = z.object({
  catalogRevision: z.number().int().positive().nullable(),
  currency: z
    .string()
    .regex(/^[A-Z]{3}$/)
    .nullable(),
  offers: z.array(billingOfferSchema),
  plans: z.array(billingPlanFeaturesSchema).optional(),
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
  targetPlan: paidPlanSchema,
  targetInterval: billingIntervalSchema,
  effectiveAt: z.enum(["immediately", "next_billing_date"]),
});

export const organizationBillingSchema = z.object({
  plan: billingPlanSchema,
  billingInterval: billingIntervalSchema.nullable(),
  paymentStatus: paymentStatusSchema,
  trialEndsAt: z.string().nullable(),
  currentPeriodEndsAt: z.string().nullable(),
  /** When paid access ends if the subscription is not renewed. With
   * `cancelAtPeriodEnd`, this is the "access until" date. */
  paidThroughAt: z.string().nullable(),
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
  plan: paidPlanSchema,
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
  "cancellation",
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

export const billingCancellationResponseSchema = z.object({
  accepted: z.literal(true),
  subscriptionId: z.string(),
});

export const billingPlanChangeBodySchema = z.object({
  plan: paidPlanSchema,
  interval: billingIntervalSchema,
  catalogRevision: z.number().int().positive(),
  idempotencyKey: z.string().trim().min(1).max(256).optional(),
});

export const billingPlanChangeResponseSchema = z.object({
  changeId: z.string(),
  status: z.enum(["pending", "succeeded", "failed", "conflicted"]),
  targetPlan: paidPlanSchema,
  targetInterval: billingIntervalSchema,
  effectiveAt: z.enum(["immediately", "next_billing_date"]),
  paymentUrl: z.string().url().nullable(),
  completedAt: z.string().nullable(),
});

export const organizationCheckoutBodySchema = billingCheckoutBodySchema.extend({
  organizationName: z.string().trim().min(1).max(120),
  teamName: z.string().trim().min(1).max(120),
});

export const organizationCheckoutResponseSchema = billingCheckoutResponseSchema.extend({
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
