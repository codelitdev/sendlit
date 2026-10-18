export type PlanId = "oss" | "free" | "pro" | "business";

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

/** Product capabilities live here; paid amounts live in catalog configuration. */
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
        subscribedContactsLimit: 1_000,
        monthlySendsLimit: 3_000,
        sharedOrganizationMailbox: false,
        provisioning: false,
        organizationApiKeys: false,
        marketingBranding: true,
        fairUse: false,
    },
    pro: {
        teamsLimit: 5,
        subscribedContactsLimit: 10_000,
        monthlySendsLimit: null,
        sharedOrganizationMailbox: true,
        provisioning: false,
        organizationApiKeys: false,
        marketingBranding: false,
        fairUse: true,
    },
    business: {
        teamsLimit: 25,
        subscribedContactsLimit: null,
        monthlySendsLimit: null,
        sharedOrganizationMailbox: true,
        provisioning: true,
        organizationApiKeys: true,
        marketingBranding: false,
        fairUse: true,
    },
};

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
    if (stage === 1)
        return positiveRampInt("BILLING_RAMP_DAYS_3_6_LIMIT", 1_000);
    if (stage === 2)
        return positiveRampInt("BILLING_RAMP_DAYS_7_13_LIMIT", 10_000);
    return null;
}

export type SubscriptionLike = {
    plan: "pro" | "business";
    billingInterval: BillingInterval;
    status:
        | "pending"
        | "trialing"
        | "active"
        | "past_due"
        | "cancelled"
        | "expired";
    currentPeriodEndsAt: Date | null;
    paidThroughAt: Date | null;
    trialEndsAt: Date | null;
    graceEndsAt: Date | null;
    cancelAtPeriodEnd: boolean;
};

export type PlanStateLike = {
    plan: "free" | "pro" | "business";
    teamsLimitOverride: number | null;
    contactsLimitOverride: number | null;
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
};

export function resolveEntitlements({
    organizationId,
    deploymentMode,
    planState,
    subscription,
    checkoutPending = false,
    now = new Date(),
}: {
    organizationId: string;
    deploymentMode: "oss" | "cloud";
    planState: PlanStateLike | null;
    subscription?: SubscriptionLike | null;
    checkoutPending?: boolean;
    now?: Date;
}): OrganizationEntitlements {
    if (deploymentMode === "oss") {
        return {
            organizationId,
            plan: "oss",
            interval: null,
            paymentStatus: "free",
            ...planPolicies.oss,
            canSend: true,
            graceEndsAt: null,
        };
    }

    const plan = planState?.plan ?? "free";
    let effectivePlan: PlanId = plan;
    let paymentStatus: PaymentStatus = checkoutPending
        ? "checkout_pending"
        : "free";
    let interval: BillingInterval | null = null;
    let graceEndsAt: Date | null = null;
    let canSend = true;

    if (subscription) {
        interval = subscription.billingInterval;
        const paidThrough = subscription.paidThroughAt;
        const hasFuturePaidThrough = Boolean(
            paidThrough && paidThrough.getTime() > now.getTime(),
        );
        if (
            subscription.status === "cancelled" &&
            (!subscription.cancelAtPeriodEnd || !hasFuturePaidThrough)
        ) {
            effectivePlan = "free";
            interval = null;
            paymentStatus = "expired";
        } else if (subscription.status === "expired") {
            effectivePlan = "free";
            interval = null;
            paymentStatus = "expired";
        } else if (subscription.status === "pending") {
            effectivePlan = "free";
            interval = null;
            paymentStatus = "checkout_pending";
        } else {
            effectivePlan = subscription.plan;
            paymentStatus =
                subscription.status === "trialing"
                    ? "trialing"
                    : subscription.status === "past_due"
                      ? "past_due"
                      : subscription.cancelAtPeriodEnd
                        ? "cancel_at_period_end"
                        : subscription.status === "cancelled"
                          ? "cancelled"
                          : "active";
            graceEndsAt = subscription.graceEndsAt;
            if (
                subscription.status === "past_due" &&
                graceEndsAt &&
                graceEndsAt.getTime() <= now.getTime()
            ) {
                canSend = false;
            }
        }
    } else {
        effectivePlan = "free";
        interval = null;
    }

    const effectiveBase = planPolicies[effectivePlan];
    return {
        organizationId,
        plan: effectivePlan,
        interval,
        paymentStatus,
        teamsLimit: planState?.teamsLimitOverride ?? effectiveBase.teamsLimit,
        subscribedContactsLimit:
            planState?.contactsLimitOverride ??
            effectiveBase.subscribedContactsLimit,
        monthlySendsLimit: effectiveBase.monthlySendsLimit,
        sharedOrganizationMailbox: effectiveBase.sharedOrganizationMailbox,
        provisioning: effectiveBase.provisioning,
        organizationApiKeys: effectiveBase.organizationApiKeys,
        marketingBranding: effectiveBase.marketingBranding,
        fairUse: effectiveBase.fairUse,
        canSend,
        graceEndsAt,
    };
}
