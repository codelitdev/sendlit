import { and, eq } from "drizzle-orm";
import { db } from "../db/client";
import {
    billingCatalogRevisionItems,
    billingCatalogRevisions,
    billingPriceEntries,
} from "../db/schema";
import type { BillingConfig, BillingOffer } from "./catalog";
import { billingCatalogKeys } from "./catalog";
import { recordBillingMetric } from "./metrics";
import { pageBillingAlert } from "./alerts";
import type { BillingProviderAdapter } from "./provider";
import { providerErrorSummary } from "./provider";
import logger from "../services/log";

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
    const [existing] = await db
        .select({
            id: billingCatalogRevisions.id,
            status: billingCatalogRevisions.status,
        })
        .from(billingCatalogRevisions)
        .where(eq(billingCatalogRevisions.revision, config.catalogRevision))
        .limit(1);
    if (existing) return;
    await db
        .insert(billingCatalogRevisions)
        .values({
            revision: config.catalogRevision,
            checkoutProvider: config.checkoutProvider!,
            status: "pending_verification",
        })
        .onConflictDoNothing({ target: billingCatalogRevisions.revision });
    recordBillingMetric("billing.catalog.revision_recorded", {
        revision: config.catalogRevision,
        status: "pending_verification",
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
            catalogKey: billingCatalogRevisionItems.catalogKey,
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
        activeRevision !== null &&
        activeRevision === config.catalogRevision
    );
}

async function verifyOffer(
    provider: BillingProviderAdapter,
    offer: BillingOffer,
) {
    const snapshot = await provider.retrieveProduct(offer.providerProductId);
    if (
        snapshot.provider !== offer.provider ||
        snapshot.providerProductId !== offer.providerProductId ||
        snapshot.currency !== offer.currency ||
        snapshot.amountMinor !== offer.amountMinor ||
        snapshot.interval !== offer.interval
    ) {
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
    provider: BillingProviderAdapter,
): Promise<void> {
    if (config.deploymentMode !== "cloud" || !config.catalogRevision) return;
    await recordRequestedCatalogRevision(config);
    const [requested] = await db
        .select()
        .from(billingCatalogRevisions)
        .where(eq(billingCatalogRevisions.revision, config.catalogRevision))
        .limit(1);
    if (!requested) throw new BillingCatalogUnavailableError();
    if (requested.status === "abandoned") return;

    try {
        for (const offer of config.offers) await verifyOffer(provider, offer);
    } catch (error) {
        logger.error(
            {
                error: providerErrorSummary(error),
                revision: requested.revision,
            },
            "billing catalog verification failed",
        );
        recordBillingMetric("billing.catalog.invalid", {
            revision: requested.revision,
        });
        await pageBillingAlert({
            code: "catalog_invalid",
            message:
                "The billing catalog revision is invalid; checkout is frozen.",
            details: { count: 1 },
        }).catch(() => undefined);
        if (requested.status !== "active") {
            await markRevision(requested.id, "invalid");
        } else {
            await markRevision(requested.id, "invalid");
        }
        throw new BillingCatalogUnavailableError("billing_catalog_unavailable");
    }

    await db.transaction(async (tx) => {
        const [existingRevision] = await tx
            .select()
            .from(billingCatalogRevisions)
            .where(eq(billingCatalogRevisions.id, requested.id))
            .limit(1)
            .for("update");
        if (!existingRevision) throw new BillingCatalogUnavailableError();
        const [activeRevision] = await tx
            .select()
            .from(billingCatalogRevisions)
            .where(
                and(
                    eq(
                        billingCatalogRevisions.checkoutProvider,
                        provider.provider,
                    ),
                    eq(billingCatalogRevisions.status, "active"),
                ),
            )
            .limit(1)
            .for("update");
        if (activeRevision && activeRevision.revision > requested.revision) {
            throw new Error("billing_catalog_revision_rollback");
        }
        const priceRows = [];
        for (const offer of config.offers) {
            const [existingPrice] = await tx
                .select()
                .from(billingPriceEntries)
                .where(
                    and(
                        eq(billingPriceEntries.provider, offer.provider),
                        eq(
                            billingPriceEntries.providerProductId,
                            offer.providerProductId,
                        ),
                    ),
                )
                .limit(1)
                .for("update");
            if (existingPrice) {
                if (
                    existingPrice.amountMinor !== offer.amountMinor ||
                    existingPrice.currency !== offer.currency ||
                    existingPrice.billingInterval !== offer.interval ||
                    existingPrice.plan !== offer.plan ||
                    existingPrice.catalogKey !== offer.catalogKey
                ) {
                    throw new Error("billing_provider_product_changed");
                }
                await tx
                    .update(billingPriceEntries)
                    .set({ verifiedAt: new Date(), updatedAt: new Date() })
                    .where(eq(billingPriceEntries.id, existingPrice.id));
                priceRows.push(existingPrice);
            } else {
                const [created] = await tx
                    .insert(billingPriceEntries)
                    .values({
                        catalogKey: offer.catalogKey,
                        plan: offer.plan,
                        billingInterval: offer.interval,
                        currency: offer.currency,
                        amountMinor: offer.amountMinor,
                        provider: offer.provider,
                        providerProductId: offer.providerProductId,
                        verifiedAt: new Date(),
                    })
                    .returning();
                if (!created)
                    throw new Error("billing_price_entry_unavailable");
                priceRows.push(created);
            }
            await tx
                .insert(billingCatalogRevisionItems)
                .values({
                    catalogRevisionId: existingRevision.id,
                    catalogKey: offer.catalogKey,
                    billingPriceEntryId: priceRows[priceRows.length - 1].id,
                })
                .onConflictDoNothing();
        }
        if (activeRevision && activeRevision.id !== existingRevision.id) {
            await tx
                .update(billingCatalogRevisions)
                .set({
                    status: "retired",
                    retiredAt: new Date(),
                    updatedAt: new Date(),
                })
                .where(eq(billingCatalogRevisions.id, activeRevision.id));
        }
        await tx
            .update(billingCatalogRevisions)
            .set({
                status: "active",
                verifiedAt: new Date(),
                activatedAt: existingRevision.activatedAt ?? new Date(),
                updatedAt: new Date(),
            })
            .where(eq(billingCatalogRevisions.id, existingRevision.id));
    });
    recordBillingMetric("billing.catalog.activated", {
        revision: requested.revision,
    });
}

/** Checkout-time check of the selected product. A mismatch freezes the catalog. */
export async function verifyCheckoutOffer(
    config: BillingConfig,
    provider: BillingProviderAdapter,
    offer: BillingOffer,
): Promise<void> {
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
        const [active] = await db
            .select({ id: billingCatalogRevisions.id })
            .from(billingCatalogRevisions)
            .where(
                and(
                    eq(
                        billingCatalogRevisions.checkoutProvider,
                        provider.provider,
                    ),
                    eq(billingCatalogRevisions.status, "active"),
                ),
            )
            .limit(1);
        if (active) await markRevision(active.id, "invalid");
        recordBillingMetric("billing.catalog.invalid", {
            reason: "checkout_mismatch",
            catalog_key: offer.catalogKey,
        });
        throw new BillingCatalogUnavailableError();
    }
}

export async function requireActiveCatalog(
    config: BillingConfig,
    provider: BillingProviderAdapter,
) {
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
