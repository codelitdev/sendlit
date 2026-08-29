import { and, desc, eq, inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { db } from "../db/client";
import {
    billingCatalogRevisionItems,
    billingCatalogRevisions,
    billingPlanChangeAttempts,
    organizationPlanStates,
    organizationSubscriptions,
    organizations,
} from "../db/schema";
import { encryptBillingValue, decryptBillingValue } from "./crypto";
import { readBillingConfig, getBillingOffer } from "./catalog";
import { requireActiveCatalog, verifyCheckoutOffer } from "./catalog-store";
import { getBillingProvider } from "./provider-registry";
import type { BillingProviderError } from "./provider";

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

function providerErrorCode(error: unknown): string {
    return error && typeof error === "object" && "code" in error
        ? String((error as BillingProviderError).code)
        : "provider_error";
}

async function currentCatalogRevision(
    priceEntryId: string,
    fallback: number,
): Promise<number> {
    const [row] = await db
        .select({ revision: billingCatalogRevisions.revision })
        .from(billingCatalogRevisionItems)
        .innerJoin(
            billingCatalogRevisions,
            eq(
                billingCatalogRevisions.id,
                billingCatalogRevisionItems.catalogRevisionId,
            ),
        )
        .where(
            eq(billingCatalogRevisionItems.billingPriceEntryId, priceEntryId),
        )
        .orderBy(desc(billingCatalogRevisions.revision))
        .limit(1);
    return row?.revision ?? fallback;
}

export async function createOrganizationPlanChange(input: {
    organizationId: string;
    actorUserId: string;
    plan: "pro" | "business";
    interval: "month" | "year";
    catalogRevision: number;
    idempotencyKey?: string;
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
        (row) => row.catalogKey === offer.catalogKey,
    )?.price;
    if (!targetPrice)
        throw new BillingPlanChangeError("billing_catalog_unavailable", 503);

    const idempotencyKey = `plan-change:${input.organizationId}:${input.idempotencyKey?.trim() || randomUUID()}`;
    const now = new Date();
    const pending = await db.transaction(async (tx) => {
        const [observedState] = await tx
            .select()
            .from(organizationPlanStates)
            .where(
                eq(organizationPlanStates.organizationId, input.organizationId),
            )
            .limit(1);
        if (!observedState?.activeSubscriptionId) {
            throw new BillingPlanChangeError(
                "billing_subscription_required",
                402,
            );
        }
        const [subscription] = await tx
            .select()
            .from(organizationSubscriptions)
            .where(
                and(
                    eq(
                        organizationSubscriptions.id,
                        observedState.activeSubscriptionId,
                    ),
                    eq(
                        organizationSubscriptions.organizationId,
                        input.organizationId,
                    ),
                ),
            )
            .limit(1)
            .for("update");
        if (!subscription)
            throw new BillingPlanChangeError(
                "billing_subscription_required",
                402,
            );
        const [organization] = await tx
            .select({ status: organizations.status })
            .from(organizations)
            .where(eq(organizations.id, input.organizationId))
            .limit(1)
            .for("update");
        if (!organization || organization.status !== "active") {
            throw new BillingPlanChangeError(
                "billing_subscription_not_changeable",
                409,
            );
        }
        const [state] = await tx
            .select()
            .from(organizationPlanStates)
            .where(
                eq(organizationPlanStates.organizationId, input.organizationId),
            )
            .limit(1)
            .for("update");
        if (state?.activeSubscriptionId !== subscription.id) {
            throw new BillingPlanChangeError(
                "billing_subscription_not_changeable",
                409,
            );
        }
        if (subscription.billingManagerUserId !== input.actorUserId) {
            throw new BillingPlanChangeError("billing_owner_required", 403);
        }

        // Idempotency is checked before validating the current projection: a
        // successful request may already have moved the subscription to the
        // target product by the time the client retries.
        const [existingByKey] = await tx
            .select()
            .from(billingPlanChangeAttempts)
            .where(eq(billingPlanChangeAttempts.idempotencyKey, idempotencyKey))
            .limit(1)
            .for("update");
        if (existingByKey) {
            if (
                existingByKey.organizationId !== input.organizationId ||
                existingByKey.targetPlan !== input.plan ||
                existingByKey.targetInterval !== input.interval
            ) {
                throw new BillingPlanChangeError(
                    "billing_plan_change_pending",
                    409,
                );
            }
            return { row: existingByKey, subscription };
        }

        if (!["trialing", "active"].includes(subscription.status)) {
            throw new BillingPlanChangeError(
                "billing_subscription_not_changeable",
                409,
            );
        }
        const currentPlan = subscription.plan as "pro" | "business";
        const currentInterval = subscription.billingInterval as
            "month" | "year";

        if (currentPlan === input.plan && currentInterval === input.interval) {
            throw new BillingPlanChangeError(
                "billing_plan_change_same_plan",
                409,
            );
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

        const [existing] = await tx
            .select()
            .from(billingPlanChangeAttempts)
            .where(
                and(
                    eq(
                        billingPlanChangeAttempts.organizationId,
                        input.organizationId,
                    ),
                    inArray(billingPlanChangeAttempts.status, [
                        "creating",
                        "pending",
                    ]),
                ),
            )
            .limit(1)
            .for("update");
        if (existing)
            throw new BillingPlanChangeError(
                "billing_plan_change_pending",
                409,
                { changeId: existing.changeId },
            );

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
        const [row] = await tx
            .insert(billingPlanChangeAttempts)
            .values({
                organizationId: input.organizationId,
                subscriptionId: subscription.id,
                actorUserId: input.actorUserId,
                provider: subscription.provider,
                idempotencyKey,
                currentCatalogRevision: await currentCatalogRevision(
                    subscription.billingPriceEntryId,
                    config.catalogRevision!,
                ),
                currentBillingPriceEntryId: subscription.billingPriceEntryId,
                currentPlan,
                currentInterval,
                targetCatalogRevision: config.catalogRevision!,
                targetBillingPriceEntryId: targetPrice.id,
                targetPlan: input.plan,
                targetInterval: input.interval,
                effectiveAt: policy.effectiveAt,
                prorationMode: policy.prorationMode,
                status: "creating",
                requestedAt: now,
            })
            .returning();
        if (!row)
            throw new BillingPlanChangeError(
                "billing_provider_unavailable",
                503,
            );
        return { row, subscription };
    });

    if (pending.row.status !== "creating") {
        return responseFor(
            pending.row,
            pending.row.actorUserId === input.actorUserId,
        );
    }

    let result;
    try {
        result = await provider.changeSubscriptionPlan({
            providerSubscriptionId: pending.subscription.providerSubscriptionId,
            targetProviderProductId: offer.providerProductId,
            effectiveAt: pending.row.effectiveAt as
                "immediately" | "next_billing_date",
            prorationMode: pending.row.prorationMode as
                "prorated_immediately" | "do_not_bill",
            idempotencyKey: pending.row.idempotencyKey,
        });
    } catch (error) {
        const code = providerErrorCode(error);
        const ambiguous = code === "unavailable" || code === "rate_limited";
        const [updated] = await db
            .update(billingPlanChangeAttempts)
            .set({
                status: ambiguous ? "pending" : "failed",
                lastError: code.slice(0, 120),
                completedAt: ambiguous ? null : new Date(),
                updatedAt: new Date(),
            })
            .where(eq(billingPlanChangeAttempts.id, pending.row.id))
            .returning();
        if (ambiguous) {
            // The request may have reached the provider even though the HTTP
            // response was lost. Return the durable pending attempt and let
            // reconciliation retry with the same idempotency key.
            return responseFor(updated ?? pending.row, true);
        }
        throw new BillingPlanChangeError(
            "billing_plan_change_not_supported",
            409,
            {
                reason: code,
            },
        );
    }

    try {
        const [updated] = await db
            .update(billingPlanChangeAttempts)
            .set({
                status: "pending",
                providerPaymentId: result.providerPaymentId,
                paymentUrlEncrypted: result.paymentUrl
                    ? encryptBillingValue(result.paymentUrl)
                    : null,
                lastError: null,
                updatedAt: new Date(),
            })
            .where(eq(billingPlanChangeAttempts.id, pending.row.id))
            .returning();
        if (!updated) throw new Error("billing_plan_change_update_failed");
        return responseFor(updated, true);
    } catch {
        // The provider mutation may already have succeeded. Leave the local
        // row non-terminal so reconciliation can persist the result and the
        // signed webhook can still project entitlements.
        throw new BillingPlanChangeError("billing_provider_unavailable", 503, {
            changeId: pending.row.changeId,
            pending: true,
        });
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
                    billingPlanChangeAttempts.organizationId,
                    input.organizationId,
                ),
                eq(billingPlanChangeAttempts.changeId, input.changeId),
            ),
        )
        .limit(1);
    if (!row) return null;
    return responseFor(row, row.actorUserId === input.userId);
}
