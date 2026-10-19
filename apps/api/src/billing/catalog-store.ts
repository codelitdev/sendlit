import type { PublicBillingCatalog } from "@codelitdev/billing/catalog";
import { type BillingConfig, billingCatalogKeys } from "./catalog";
import { getBillingEngine } from "./engine";
import { recordBillingMetric } from "./metrics";

export class BillingCatalogUnavailableError extends Error {
  constructor(message = "billing_catalog_unavailable") {
    super(message);
    this.name = "BillingCatalogUnavailableError";
  }
}

/** Record a higher requested revision as pending without calling the provider.
 * Ordinary API startup must not wait on provider availability; the billing
 * workers verify it against the provider on their next tick. */
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

/** The active, complete public catalog (engine read model). */
export async function getPublicCatalog(
  config: BillingConfig,
): Promise<PublicBillingCatalog> {
  if (config.deploymentMode !== "cloud" || !config.checkoutProvider) {
    throw new BillingCatalogUnavailableError();
  }
  const catalog = await getBillingEngine().publicCatalog();
  if (!catalog || catalog.offers.length !== billingCatalogKeys.length) {
    throw new BillingCatalogUnavailableError();
  }
  return catalog;
}

/** Checks, before a checkout or plan change, that the configured revision is
 * the active one and offers `offerKey`. Throws `billing_catalog_changed` when
 * a different revision is active. The engine re-checks everything (including
 * the provider product) itself; this only lets SendLit answer with its own
 * error codes before a grant is consumed. */
export async function requirePublicCatalog(
  config: BillingConfig,
  offerKey: string,
): Promise<PublicBillingCatalog> {
  const catalog = await getPublicCatalog(config);
  if (catalog.revision !== config.catalogRevision) {
    throw new Error("billing_catalog_changed");
  }
  if (!catalog.offers.some((offer) => offer.key === offerKey)) {
    throw new BillingCatalogUnavailableError();
  }
  return catalog;
}
