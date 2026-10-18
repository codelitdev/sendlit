import { and, eq } from "drizzle-orm";
import { db } from "../db/client";
import {
    billingPlanChangeAttempts,
    billingPlanStates,
    billingSubscriptions,
    organizations,
} from "../db/schema";
import { decryptBillingValue } from "./crypto";
import { readBillingConfig, getBillingOffer } from "./catalog";
import { requireActiveCatalog, verifyCheckoutOffer } from "./catalog-store";
import { getBillingProvider } from "./provider-registry";
import { getBillingEngine, preconsumedGrant } from "./engine";
import { BillingWorkflowError } from "@codelitdev/billing/core";
import type { BillingActionGrant } from "@codelitdev/billing/workflows";

type PlanChangeCode =
    | "billing_catalog_changed"
    | "billing_catalog_unavailable"
    | "billing_provider_unavailable"
    | "billing_owner_required"
    | "billing_plan_change_pending"
    | "billing_plan_change_not_supported"
    | "billing_plan_change_same_plan"
    | "billing_subscription_required"
    | "billing_subscription_not_changeable";

export class BillingPlanChangeError extends Error {
    constructor(
        public readonly code: PlanChangeCode,
        public readonly status: 402 | 403 | 409 | 503,
        public readonly details: Record<string, unknown> = {},
    ) {
        super(code);
        this.name = "BillingPlanChangeError";
    }
}

type PlanChangeRow = typeof billingPlanChangeAttempts.$inferSelect;

function responseFor(row: PlanChangeRow, includePaymentUrl: boolean) {
    let paymentUrl: string | null = null;
    if (includePaymentUrl && row.paymentUrlEncrypted) {
        try {
            paymentUrl = decryptBillingValue(row.paymentUrlEncrypted);
        } catch {
            // A corrupted/expired payment link is never surfaced. The
            // provider webhook or a fresh request remains authoritative.
        }
    }
    return {
        changeId: row.changeId,
        status: (row.status === "creating" ? "pending" : row.status) as
            "pending" | "succeeded" | "failed" | "conflicted",
        targetPlan: row.targetPlan as "pro" | "business",
        targetInterval: row.targetInterval as "month" | "year",
        effectiveAt: row.effectiveAt as "immediately" | "next_billing_date",
        paymentUrl,
        completedAt: row.completedAt?.toISOString() ?? null,
    };
}

function planRank(plan: "pro" | "business"): number {
    return plan === "business" ? 2 : 1;
}

function defaultPolicy(
    currentPlan: "pro" | "business",
    currentInterval: "month" | "year",
    targetPlan: "pro" | "business",
    targetInterval: "month" | "year",
) {
    const upgrade =
        planRank(targetPlan) > planRank(currentPlan) ||
        (targetPlan === currentPlan &&
            currentInterval === "month" &&
            targetInterval === "year");
    return {
        effectiveAt: upgrade
            ? ("immediately" as const)
            : ("next_billing_date" as const),
        prorationMode: upgrade
            ? ("prorated_immediately" as const)
            : ("do_not_bill" as const),
    };
}

function mapPlanChangeWorkflowError(
    error: unknown,
    details: Record<string, unknown> = {},
): BillingPlanChangeError {
    if (error instanceof BillingPlanChangeError) return error;
    const code =
        error instanceof BillingWorkflowError
            ? error.code
            : "provider_unavailable";
    switch (code) {
        case "catalog_changed":
            return new BillingPlanChangeError(
                "billing_catalog_changed",
                409,
                details,
            );
        case "catalog_unavailable":
            return new BillingPlanChangeError(
                "billing_catalog_unavailable",
                503,
            );
        case "subscription_required":
            return new BillingPlanChangeError(
                "billing_subscription_required",
                402,
            );
        case "payer_mismatch":
        case "grant_invalid":
        case "grant_consumed":
            return new BillingPlanChangeError("billing_owner_required", 403);
        case "plan_change_pending":
            return new BillingPlanChangeError(
                "billing_plan_change_pending",
                409,
                details,
            );
        case "same_offer":
            return new BillingPlanChangeError(
                "billing_plan_change_same_plan",
                409,
            );
        case "plan_change_not_supported":
            return new BillingPlanChangeError(
                "billing_plan_change_not_supported",
                409,
            );
        case "subscription_not_changeable":
            return new BillingPlanChangeError(
                "billing_subscription_not_changeable",
                409,
            );
        default:
            return new BillingPlanChangeError(
                "billing_provider_unavailable",
                503,
                details,
            );
    }
}

export async function createOrganizationPlanChange(input: {
    organizationId: string;
    actorId: string;
    plan: "pro" | "business";
    interval: "month" | "year";
    catalogRevision: number;
    idempotencyKey?: string;
    grant?: BillingActionGrant;
}) {
    let config: ReturnType<typeof readBillingConfig>;
    try {
        config = readBillingConfig();
    } catch {
        throw new BillingPlanChangeError("billing_catalog_unavailable", 503);
    }
    if (config.deploymentMode !== "cloud" || !config.catalogRevision) {
        throw new BillingPlanChangeError("billing_provider_unavailable", 503);
    }
    if (input.catalogRevision !== config.catalogRevision) {
        throw new BillingPlanChangeError("billing_catalog_changed", 409, {
            catalogRevision: config.catalogRevision,
            currency: config.currency,
            offers: config.offers.map(
                ({ providerProductId: _providerProductId, ...offer }) => offer,
            ),
            checkoutAvailable: true,
        });
    }
    const offer = getBillingOffer(config, input.plan, input.interval);
    if (!offer)
        throw new BillingPlanChangeError("billing_catalog_unavailable", 503);

    let provider;
    let catalog;
    try {
        provider = getBillingProvider(config.checkoutProvider ?? undefined);
        catalog = await requireActiveCatalog(config, provider);
        await verifyCheckoutOffer(config, provider, offer);
    } catch (error) {
        if (
            error instanceof Error &&
            error.message === "billing_catalog_changed"
        ) {
            throw new BillingPlanChangeError("billing_catalog_changed", 409, {
                catalogRevision: config.catalogRevision,
                currency: config.currency,
                offers: config.offers.map(
                    ({ providerProductId: _providerProductId, ...offer }) =>
                        offer,
                ),
                checkoutAvailable: false,
            });
        }
        throw new BillingPlanChangeError("billing_catalog_unavailable", 503);
    }
    const targetPrice = catalog.items.find(
        (row) => row.offerKey === offer.catalogKey,
    )?.price;
    if (!targetPrice)
        throw new BillingPlanChangeError("billing_catalog_unavailable", 503);

    const [observedState] = await db
        .select()
        .from(billingPlanStates)
        .where(eq(billingPlanStates.billableEntityId, input.organizationId))
        .limit(1);
    if (!observedState?.activeSubscriptionId) {
        throw new BillingPlanChangeError("billing_subscription_required", 402);
    }
    const [subscription] = await db
        .select()
        .from(billingSubscriptions)
        .where(
            and(
                eq(billingSubscriptions.id, observedState.activeSubscriptionId),
                eq(billingSubscriptions.billableEntityId, input.organizationId),
            ),
        )
        .limit(1);
    if (!subscription)
        throw new BillingPlanChangeError("billing_subscription_required", 402);
    const [organization] = await db
        .select({ status: organizations.status })
        .from(organizations)
        .where(eq(organizations.id, input.organizationId))
        .limit(1);
    if (!organization || organization.status !== "active") {
        throw new BillingPlanChangeError(
            "billing_subscription_not_changeable",
            409,
        );
    }
    if (subscription.payerId !== input.actorId) {
        throw new BillingPlanChangeError("billing_owner_required", 403);
    }
    if (!["trialing", "active"].includes(subscription.status)) {
        throw new BillingPlanChangeError(
            "billing_subscription_not_changeable",
            409,
        );
    }
    const currentPlan = subscription.plan as "pro" | "business";
    const currentInterval = subscription.billingInterval as "month" | "year";
    if (currentPlan === input.plan && currentInterval === input.interval) {
        throw new BillingPlanChangeError("billing_plan_change_same_plan", 409);
    }
    if (
        !provider.capabilities.planChanges ||
        (currentInterval !== input.interval &&
            !provider.capabilities.intervalChanges)
    ) {
        throw new BillingPlanChangeError(
            "billing_plan_change_not_supported",
            409,
        );
    }
    const policy = defaultPolicy(
        currentPlan,
        currentInterval,
        input.plan,
        input.interval,
    );
    if (
        policy.prorationMode === "prorated_immediately" &&
        !provider.capabilities.proratedPlanChanges
    ) {
        throw new BillingPlanChangeError(
            "billing_plan_change_not_supported",
            409,
        );
    }
    const billing = getBillingEngine();
    try {
        const attempt = await billing.startPlanChange({
            grant:
                input.grant ??
                preconsumedGrant(
                    "plan_change",
                    input.organizationId,
                    input.actorId,
                ),
            entity: { kind: "organization", id: input.organizationId },
            payer: {
                id: input.actorId,
                email: input.actorId,
                name: input.actorId,
            },
            offerKey: offer.catalogKey,
            catalogRevision: input.catalogRevision,
            effectiveAt: policy.effectiveAt,
            prorationMode: policy.prorationMode,
        });
        const [row] = await db
            .select()
            .from(billingPlanChangeAttempts)
            .where(eq(billingPlanChangeAttempts.changeId, attempt.changeId))
            .limit(1);
        if (!row)
            throw new BillingPlanChangeError(
                "billing_provider_unavailable",
                503,
            );
        return responseFor(row, true);
    } catch (error) {
        throw mapPlanChangeWorkflowError(error);
    }
}

export async function getOrganizationPlanChange(input: {
    organizationId: string;
    changeId: string;
    userId: string;
}) {
    const [row] = await db
        .select()
        .from(billingPlanChangeAttempts)
        .where(
            and(
                eq(
                    billingPlanChangeAttempts.billableEntityId,
                    input.organizationId,
                ),
                eq(billingPlanChangeAttempts.changeId, input.changeId),
            ),
        )
        .limit(1);
    if (!row) return null;
    return responseFor(row, row.actorId === input.userId);
}
