import { FakeBillingProvider } from "@codelitdev/billing/providers";
import type { BillingProviderAdapter } from "@codelitdev/billing/providers";
import { readBillingConfig } from "./catalog";
import type { BillingProviderId } from "./provider";
import { createSendLitDodoProvider } from "./providers/dodo";

/** Lazily-created adapters keep provider credentials out of module import time. */
const instances = new Map<string, BillingProviderAdapter>();

export function getBillingProvider(
    provider?: BillingProviderId,
): BillingProviderAdapter {
    const config = readBillingConfig();
    const selected = provider ?? config.checkoutProvider;
    if (!selected) throw new Error("billing_provider_not_configured");
    if (!config.enabledProviders.includes(selected)) {
        throw new Error("billing_provider_not_enabled");
    }
    const existing = instances.get(selected);
    if (existing) return existing;
    let adapter: BillingProviderAdapter;
    switch (selected) {
        case "dodo":
            adapter = createSendLitDodoProvider();
            break;
        case "fake": {
            if (process.env.NODE_ENV === "production") {
                throw new Error(
                    "fake_billing_provider_not_allowed_in_production",
                );
            }
            const fake = new FakeBillingProvider();
            fake.seedDefaultCatalog();
            adapter = fake;
            break;
        }
        default:
            throw new Error(`unsupported_billing_provider:${selected}`);
    }
    instances.set(selected, adapter);
    return adapter;
}

export function resetBillingProviderInstances(): void {
    instances.clear();
}
