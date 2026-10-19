import { assertBillingProviderConfig, readBillingConfig } from "./catalog";
import { recordRequestedCatalogRevision } from "./catalog-store";
import { configuredBillingProviders, getBillingSensitiveValues } from "./engine";

export { type BillingMaintenance, startBillingMaintenance } from "./maintenance";

/**
 * Validates billing configuration without touching the database. Billing
 * mode is explicit and fail-closed: OSS must opt in; cloud needs a complete
 * catalog, provider secrets and the data encryption key. Throws on any
 * problem. Safe to call before the database is reachable.
 */
export function validateBillingConfig(): void {
  const config = readBillingConfig();
  if (config.deploymentMode !== "cloud") return;
  assertBillingProviderConfig(config);
  // Builds the AES-GCM port; throws when the key is missing or malformed.
  getBillingSensitiveValues();
  // Builds the provider adapters; throws when the checkout provider cannot.
  configuredBillingProviders(config);
}

/**
 * Startup step for the API process, after the database is reachable:
 * validates configuration (as `validateBillingConfig`) and, in cloud mode,
 * records the requested catalog revision as pending. Never calls the
 * provider; the billing workers verify the catalog on their first tick.
 */
export async function prepareBilling(): Promise<void> {
  validateBillingConfig();
  await recordRequestedCatalogRevision(readBillingConfig());
}
