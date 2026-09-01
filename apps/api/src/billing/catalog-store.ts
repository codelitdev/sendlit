import { and, eq } from "drizzle-orm";
import { db } from "../db/client";
import {
    billingCatalogRevisionItems,
    billingCatalogRevisions,
    billingPriceEntries,
} from "../db/schema";
import {
    catalogMatchesProviderSnapshot,
    checkoutIsAvailable as packageCheckoutIsAvailable,
} from "@codelitdev/billing/catalog";
import type { BillingOffer } from "./catalog";
import {
    billingCatalogKeys,
    readBillingConfig,
    toPackageOffer,
    type BillingConfig,
} from "./catalog";
import { recordBillingMetric } from "./metrics";
import { pageBillingAlert } from "./alerts";
import type { BillingProviderAdapter } from "./provider";
import { providerErrorSummary } from "./provider";
import logger from "../services/log";
import { getBillingEngine } from "./engine";

export class BillingCatalogUnavailableError extends Error {
    constructor(message = "billing_catalog_unavailable") {
        super(message);
        this.name = "BillingCatalogUnavailableError";
    }
}

/** Record a higher requested revision as pending without calling the provider.
 * Ordinary API startup must not wait on provider availability. */
export async function recordRequestedCatalogRevision(
    config: BillingConfig,
): Promise<void> {
    if (config.deploymentMode !== "cloud" || !config.catalogRevision) return;
    const recorded = await getBillingEngine().recordRequestedCatalog();
    recordBillingMetric("billing.catalog.revision_recorded", {
        revision: config.catalogRevision,
        status: recorded?.status ?? "pending_verification",
    });
}

export async function getActiveCatalog(config: BillingConfig) {
    if (config.deploymentMode !== "cloud" || !config.checkoutProvider) {
        throw new BillingCatalogUnavailableError();
    }
    const [active] = await db
        .select()
        .from(billingCatalogRevisions)
        .where(
            and(
                eq(
                    billingCatalogRevisions.checkoutProvider,
                    config.checkoutProvider,
                ),
                eq(billingCatalogRevisions.status, "active"),
            ),
        )
        .limit(1);
    if (!active) throw new BillingCatalogUnavailableError();
    const items = await db
        .select({
            offerKey: billingCatalogRevisionItems.offerKey,
            price: billingPriceEntries,
        })
        .from(billingCatalogRevisionItems)
        .innerJoin(
            billingPriceEntries,
            eq(
                billingPriceEntries.id,
                billingCatalogRevisionItems.billingPriceEntryId,
            ),
        )
        .where(eq(billingCatalogRevisionItems.catalogRevisionId, active.id));
    if (items.length !== billingCatalogKeys.length) {
        throw new BillingCatalogUnavailableError();
    }
    return { revision: active, items };
}

export function checkoutIsAvailable(
    config: BillingConfig,
    activeRevision: number | null,
): boolean {
    return (
        config.deploymentMode === "cloud" &&
        packageCheckoutIsAvailable({
            requestedRevision: config.catalogRevision,
            activeRevision,
        })
    );
}

async function verifyOffer(
    provider: BillingProviderAdapter,
    offer: BillingOffer,
) {
    const snapshot = await provider.retrieveProduct(offer.providerProductId);
    if (!catalogMatchesProviderSnapshot(toPackageOffer(offer), snapshot)) {
        throw new Error(`billing_catalog_product_mismatch:${offer.catalogKey}`);
    }
    return snapshot;
}

async function markRevision(
    revisionId: string,
    status: "invalid" | "abandoned" | "pending_verification",
    extra: Record<string, Date | null> = {},
) {
    await db
        .update(billingCatalogRevisions)
        .set({
            status,
            updatedAt: new Date(),
            ...extra,
        })
        .where(eq(billingCatalogRevisions.id, revisionId));
}

/** Verify the requested env revision (or re-verify the active one). A mismatch
 * disables checkout without changing entitlements. */
export async function verifyCatalogAgainstProvider(
    config: BillingConfig,
    _provider?: BillingProviderAdapter,
): Promise<void> {
    if (config.deploymentMode !== "cloud" || !config.catalogRevision) return;
    const result = await getBillingEngine().verifyRequestedCatalog();
    if (result.mismatches.includes("revision_abandoned")) return;
    if (!result.verified) {
        logger.error(
            {
                mismatches: result.mismatches,
                revision: result.revision,
            },
            "billing catalog verification failed",
        );
        recordBillingMetric("billing.catalog.invalid", {
            revision: result.revision,
        });
        await pageBillingAlert({
            code: "catalog_invalid",
            message:
                "The billing catalog revision is invalid; checkout is frozen.",
            details: {
                count: result.mismatches.length,
                mismatches: result.mismatches.join(","),
            },
        }).catch(() => undefined);
        throw new BillingCatalogUnavailableError("billing_catalog_unavailable");
    }
    recordBillingMetric("billing.catalog.activated", {
        revision: result.revision,
    });
    void _provider;
}

/** Checkout-time check of the selected product. A mismatch must not take down
 * the last verified catalog; package checkout re-checks before charging. */
export async function verifyCheckoutOffer(
    config: BillingConfig,
    provider: BillingProviderAdapter,
    offer: BillingOffer,
): Promise<void> {
    void config;
    try {
        await verifyOffer(provider, offer);
    } catch (error) {
        logger.error(
            {
                error: providerErrorSummary(error),
                catalog_key: offer.catalogKey,
            },
            "billing checkout catalog mismatch",
        );
        recordBillingMetric("billing.catalog.checkout_mismatch", {
            catalog_key: offer.catalogKey,
        });
        throw new BillingCatalogUnavailableError();
    }
}

export async function requireActiveCatalog(
    config: BillingConfig,
    _provider: BillingProviderAdapter,
) {
    void _provider;
    const active = await getActiveCatalog(config);
    if (active.revision.revision !== config.catalogRevision) {
        throw new Error("billing_catalog_changed");
    }
    return active;
}

export async function abandonCatalogRevision(
    revision: number,
    reason: string,
): Promise<boolean> {
    const trimmed = reason.trim();
    if (!trimmed || trimmed.length > 500)
        throw new Error("operator_reason_invalid");
    const config = readBillingConfig();
    if (
        config.deploymentMode === "cloud" &&
        config.catalogRevision === revision
    ) {
        const abandoned = await getBillingEngine().abandonRequestedCatalog({
            actorId: "operator",
            reason: trimmed,
        });
        recordBillingMetric("billing.catalog.abandoned", {
            revision,
            reason: trimmed,
            status: abandoned.status,
        });
        return true;
    }
    const [row] = await db
        .select()
        .from(billingCatalogRevisions)
        .where(eq(billingCatalogRevisions.revision, revision))
        .limit(1);
    if (!row) return false;
    if (row.status !== "pending_verification" && row.status !== "invalid") {
        throw new Error("billing_catalog_revision_not_abandonable");
    }
    await markRevision(row.id, "abandoned");
    recordBillingMetric("billing.catalog.abandoned", {
        revision,
        reason: trimmed,
    });
    return true;
}

/** @deprecated Prefer recordRequestedCatalogRevision + verifyCatalogAgainstProvider. */
export async function ensureActiveCatalog(
    config: BillingConfig,
    provider: BillingProviderAdapter,
) {
    await verifyCatalogAgainstProvider(config, provider);
    return getActiveCatalog(config);
}
