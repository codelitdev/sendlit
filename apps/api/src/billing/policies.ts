import { type BillingPlan, type PaidPlan, paidPlans } from "@sendlit/api-contract";

export type PlanId = BillingPlan;

export type BillingInterval = "month" | "year";

export type PaymentStatus =
  | "free"
  | "checkout_pending"
  | "trialing"
  | "active"
  | "past_due"
  | "cancel_at_period_end"
  | "cancelled"
  | "expired";

export type PlanPolicy = {
  teamsLimit: number | null;
  subscribedContactsLimit: number | null;
  monthlySendsLimit: number | null;
  sharedOrganizationMailbox: boolean;
  provisioning: boolean;
  organizationApiKeys: boolean;
  marketingBranding: boolean;
  fairUse: boolean;
};

/** Product capabilities live here; paid amounts live in catalog configuration.
 * Hosted plans are priced on sends and teams, never contacts (#60): every plan
 * has unlimited contacts and a hard org-wide monthly send cap. */
export const planPolicies: Record<PlanId, PlanPolicy> = {
  oss: {
    teamsLimit: null,
    subscribedContactsLimit: null,
    monthlySendsLimit: null,
    sharedOrganizationMailbox: true,
    provisioning: true,
    organizationApiKeys: true,
    marketingBranding: false,
    fairUse: false,
  },
  free: {
    teamsLimit: 1,
    subscribedContactsLimit: null,
    monthlySendsLimit: 3_000,
    sharedOrganizationMailbox: false,
    provisioning: false,
    organizationApiKeys: false,
    marketingBranding: true,
    fairUse: false,
  },
  starter: {
    teamsLimit: 1,
    subscribedContactsLimit: null,
    monthlySendsLimit: 25_000,
    sharedOrganizationMailbox: false,
    provisioning: false,
    organizationApiKeys: false,
    marketingBranding: true,
    fairUse: false,
  },
  pro: {
    teamsLimit: 3,
    subscribedContactsLimit: null,
    monthlySendsLimit: 125_000,
    sharedOrganizationMailbox: true,
    provisioning: false,
    organizationApiKeys: false,
    marketingBranding: false,
    fairUse: false,
  },
  business: {
    teamsLimit: 15,
    subscribedContactsLimit: null,
    monthlySendsLimit: 600_000,
    sharedOrganizationMailbox: true,
    provisioning: true,
    organizationApiKeys: true,
    marketingBranding: false,
    fairUse: false,
  },
};

/** The cheapest paid plan above `plan`, for "upgrade to" hints on limit
 * errors; Business for anything at or above it. */
export function nextPlanUp(plan: PlanId): PaidPlan {
  const index = paidPlans.indexOf(plan as PaidPlan);
  return paidPlans[Math.min(index + 1, paidPlans.length - 1)];
}

/** The cheapest paid plan that grants `capability`. */
export function cheapestPlanWith(
  capability: "sharedOrganizationMailbox" | "provisioning" | "organizationApiKeys",
): PaidPlan {
  return paidPlans.find((plan) => planPolicies[plan][capability]) ?? "business";
}

/** Paid marketing ramp defaults are operational policy knobs, not code-level
 * price constants. They are read when a reservation is made so a deployment
 * can tune ramp stages without rebuilding the API. */
function positiveRampInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  if (!/^\d+$/.test(raw)) throw new Error(`${name}_invalid`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0 || value > 2_147_483_647) {
    throw new Error(`${name}_invalid`);
  }
  return value;
}

export function marketingRampDailyLimit(stage: number): number | null {
  if (stage <= 0) return positiveRampInt("BILLING_RAMP_DAYS_0_2_LIMIT", 200);
  if (stage === 1) return positiveRampInt("BILLING_RAMP_DAYS_3_6_LIMIT", 1_000);
  if (stage === 2) return positiveRampInt("BILLING_RAMP_DAYS_7_13_LIMIT", 10_000);
  return null;
}

/** How long a past-due organization keeps sending before it is paused. */
export const PAST_DUE_GRACE_MS = 7 * 24 * 60 * 60 * 1000;

/** The past-due sending deadline, from when the subscription went past due. */
export function pastDueGraceEndsAt(pastDueSince: Date | null): Date | null {
  return pastDueSince ? new Date(pastDueSince.getTime() + PAST_DUE_GRACE_MS) : null;
}

/** Operator limit overrides from `organization_plan_policies`. */
export type PlanOverrides = {
  teamsLimitOverride: number | null;
  contactsLimitOverride: number | null;
};

/** The subset of the engine's `CommercialBillingState` SendLit policy uses. */
export type CommercialStateLike = {
  activePaidPlan: string | null;
  billingInterval: BillingInterval | null;
  subscriptionStatus: string | null;
  providerTrialEndsAt: Date | null;
  currentPeriodEndsAt: Date | null;
  paidThroughAt: Date | null;
  cancelAtPeriodEnd: boolean;
  pendingCheckout: boolean;
  pendingPlanChange: boolean;
};

export type OrganizationEntitlements = {
  organizationId: string;
  plan: PlanId;
  interval: BillingInterval | null;
  paymentStatus: PaymentStatus;
  teamsLimit: number | null;
  subscribedContactsLimit: number | null;
  monthlySendsLimit: number | null;
  sharedOrganizationMailbox: boolean;
  provisioning: boolean;
  organizationApiKeys: boolean;
  marketingBranding: boolean;
  fairUse: boolean;
  canSend: boolean;
  graceEndsAt: Date | null;
  trialEndsAt: Date | null;
  currentPeriodEndsAt: Date | null;
  paidThroughAt: Date | null;
  cancelAtPeriodEnd: boolean;
};

function paidPlan(plan: string | null | undefined): PaidPlan | null {
  return paidPlans.includes(plan as PaidPlan) ? (plan as PaidPlan) : null;
}

/**
 * SendLit plan policy on top of the engine's paid state. Whether a
 * subscription still grants paid access (including a scheduled cancellation
 * whose period has passed) is decided only by the engine; SendLit adds its
 * plan limits, operator overrides and the 7-day past-due sending grace.
 * `expired` and `cancelled` payment statuses are no longer produced; they
 * stay in the public enum for compatibility.
 */
export function resolveEntitlements({
  organizationId,
  deploymentMode,
  overrides,
  commercial,
  graceEndsAt = null,
  now = new Date(),
}: {
  organizationId: string;
  deploymentMode: "oss" | "cloud";
  overrides: PlanOverrides | null;
  commercial?: CommercialStateLike | null;
  /** The past-due grace deadline of the entitlement subscription. */
  graceEndsAt?: Date | null;
  now?: Date;
}): OrganizationEntitlements {
  const none: Pick<
    OrganizationEntitlements,
    "trialEndsAt" | "currentPeriodEndsAt" | "paidThroughAt" | "cancelAtPeriodEnd"
  > = {
    trialEndsAt: null,
    currentPeriodEndsAt: null,
    paidThroughAt: null,
    cancelAtPeriodEnd: false,
  };
  if (deploymentMode === "oss") {
    return {
      organizationId,
      plan: "oss",
      interval: null,
      paymentStatus: "free",
      ...planPolicies.oss,
      canSend: true,
      graceEndsAt: null,
      ...none,
    };
  }

  const plan = paidPlan(commercial?.activePaidPlan);
  let effectivePlan: PlanId = "free";
  let paymentStatus: PaymentStatus = commercial?.pendingCheckout
    ? "checkout_pending"
    : "free";
  let interval: BillingInterval | null = null;
  let grace: Date | null = null;
  let canSend = true;
  let dates = none;

  if (commercial && plan) {
    effectivePlan = plan;
    interval = commercial.billingInterval;
    const status = commercial.subscriptionStatus;
    paymentStatus =
      status === "trialing"
        ? "trialing"
        : status === "past_due"
          ? "past_due"
          : commercial.cancelAtPeriodEnd || status === "cancelled"
            ? "cancel_at_period_end"
            : "active";
    if (status === "past_due") {
      grace = graceEndsAt;
      if (grace && grace.getTime() <= now.getTime()) canSend = false;
    }
    dates = {
      trialEndsAt: commercial.providerTrialEndsAt,
      currentPeriodEndsAt: commercial.currentPeriodEndsAt,
      paidThroughAt: commercial.paidThroughAt,
      cancelAtPeriodEnd: commercial.cancelAtPeriodEnd,
    };
  }

  const effectiveBase = planPolicies[effectivePlan];
  return {
    organizationId,
    plan: effectivePlan,
    interval,
    paymentStatus,
    teamsLimit: overrides?.teamsLimitOverride ?? effectiveBase.teamsLimit,
    subscribedContactsLimit:
      overrides?.contactsLimitOverride ?? effectiveBase.subscribedContactsLimit,
    monthlySendsLimit: effectiveBase.monthlySendsLimit,
    sharedOrganizationMailbox: effectiveBase.sharedOrganizationMailbox,
    provisioning: effectiveBase.provisioning,
    organizationApiKeys: effectiveBase.organizationApiKeys,
    marketingBranding: effectiveBase.marketingBranding,
    fairUse: effectiveBase.fairUse,
    canSend,
    graceEndsAt: grace,
    ...dates,
  };
}
