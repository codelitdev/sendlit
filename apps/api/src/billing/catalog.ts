import { createHmac } from "node:crypto";

export const billingCatalogKeys = [
    "pro_month",
    "pro_year",
    "business_month",
    "business_year",
] as const;
export type BillingCatalogKey = (typeof billingCatalogKeys)[number];

export type BillingPlan = "oss" | "free" | "pro" | "business";
export type BillingInterval = "month" | "year";
export type BillingProvider = "dodo" | (string & {});
export type BillingDeploymentMode = "oss" | "cloud";

export type BillingOffer = {
    catalogKey: BillingCatalogKey;
    catalogRevision: number;
    plan: "pro" | "business";
    interval: BillingInterval;
    currency: string;
    amountMinor: number;
    provider: BillingProvider;
    providerProductId: string;
    trialDays: number;
};

export type BillingConfig = {
    deploymentMode: BillingDeploymentMode;
    checkoutProvider: BillingProvider | null;
    enabledProviders: BillingProvider[];
    catalogRevision: number | null;
    currency: string | null;
    offers: BillingOffer[];
};

export class BillingConfigurationError extends Error {
    constructor(message: string) {
        super(`billing_configuration_invalid:${message}`);
        this.name = "BillingConfigurationError";
    }
}

const offerEnv: Record<
    BillingCatalogKey,
    {
        amount: string;
        productSuffix: string;
        plan: "pro" | "business";
        interval: BillingInterval;
        trialDays: number;
    }
> = {
    pro_month: {
        amount: "BILLING_PRO_MONTH_AMOUNT_MINOR",
        productSuffix: "PRO_MONTH_PRODUCT_ID",
        plan: "pro",
        interval: "month",
        trialDays: 14,
    },
    pro_year: {
        amount: "BILLING_PRO_YEAR_AMOUNT_MINOR",
        productSuffix: "PRO_YEAR_PRODUCT_ID",
        plan: "pro",
        interval: "year",
        trialDays: 0,
    },
    business_month: {
        amount: "BILLING_BUSINESS_MONTH_AMOUNT_MINOR",
        productSuffix: "BUSINESS_MONTH_PRODUCT_ID",
        plan: "business",
        interval: "month",
        trialDays: 0,
    },
    business_year: {
        amount: "BILLING_BUSINESS_YEAR_AMOUNT_MINOR",
        productSuffix: "BUSINESS_YEAR_PRODUCT_ID",
        plan: "business",
        interval: "year",
        trialDays: 0,
    },
};

function required(env: NodeJS.ProcessEnv, name: string): string {
    const value = env[name];
    if (value === undefined || value.length === 0) {
        throw new BillingConfigurationError(`${name}_missing`);
    }
    if (value !== value.trim()) {
        throw new BillingConfigurationError(`${name}_whitespace`);
    }
    return value;
}

function positiveSafeInteger(value: string, name: string): number {
    if (!/^(0|[1-9][0-9]*)$/.test(value)) {
        throw new BillingConfigurationError(`${name}_must_be_decimal_integer`);
    }
    const parsed = Number(value);
    if (
        !Number.isSafeInteger(parsed) ||
        parsed <= 0 ||
        parsed > 2_147_483_647
    ) {
        throw new BillingConfigurationError(`${name}_out_of_range`);
    }
    return parsed;
}

function providerList(raw: string | undefined): BillingProvider[] {
    if (!raw || raw.length === 0) return [];
    if (raw !== raw.trim()) {
        throw new BillingConfigurationError(
            "BILLING_ENABLED_PROVIDERS_whitespace",
        );
    }
    const providers = raw.split(",").map((provider) => provider.trim());
    if (
        providers.some(
            (provider) => !/^[a-z][a-z0-9_-]{1,31}$/.test(provider),
        ) ||
        new Set(providers).size !== providers.length
    ) {
        throw new BillingConfigurationError(
            "BILLING_ENABLED_PROVIDERS_invalid",
        );
    }
    return providers;
}

/**
 * Parse the complete billing deployment configuration. This function is
 * intentionally pure so startup checks and tests use exactly the same rules.
 * Amounts are minor units and are never represented as floating point money.
 */
export function readBillingConfig(
    env: NodeJS.ProcessEnv = process.env,
): BillingConfig {
    const mode = required(env, "SENDLIT_DEPLOYMENT_MODE");
    if (mode !== "oss" && mode !== "cloud") {
        throw new BillingConfigurationError(
            "SENDLIT_DEPLOYMENT_MODE_must_be_oss_or_cloud",
        );
    }

    const checkoutRaw = env.BILLING_CHECKOUT_PROVIDER;
    const checkoutProvider = checkoutRaw
        ? required(env, "BILLING_CHECKOUT_PROVIDER")
        : null;
    const enabledProviders = providerList(env.BILLING_ENABLED_PROVIDERS);

    if (mode === "oss") {
        if (checkoutProvider || enabledProviders.length > 0) {
            throw new BillingConfigurationError(
                "oss_must_not_configure_billing_provider",
            );
        }
        return {
            deploymentMode: "oss",
            checkoutProvider: null,
            enabledProviders: [],
            catalogRevision: null,
            currency: null,
            offers: [],
        };
    }

    if (!checkoutProvider) {
        throw new BillingConfigurationError(
            "BILLING_CHECKOUT_PROVIDER_missing",
        );
    }
    if (!enabledProviders.includes(checkoutProvider)) {
        throw new BillingConfigurationError(
            "checkout_provider_must_be_enabled",
        );
    }
    const revision = positiveSafeInteger(
        required(env, "BILLING_CATALOG_REVISION"),
        "BILLING_CATALOG_REVISION",
    );
    const currency = required(env, "BILLING_CURRENCY").toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) {
        throw new BillingConfigurationError("BILLING_CURRENCY_invalid");
    }

    const offers = billingCatalogKeys.map((catalogKey) => {
        const definition = offerEnv[catalogKey];
        const productEnvName =
            checkoutProvider === "dodo"
                ? `DODO_${definition.productSuffix}`
                : `${checkoutProvider.toUpperCase().replace(/[^A-Z0-9]/g, "_")}_${definition.productSuffix}`;
        const productId = required(env, productEnvName);
        if (!/^[^\s]{2,256}$/.test(productId)) {
            throw new BillingConfigurationError(`${productEnvName}_invalid`);
        }
        return {
            catalogKey,
            catalogRevision: revision,
            plan: definition.plan,
            interval: definition.interval,
            currency,
            amountMinor: positiveSafeInteger(
                required(env, definition.amount),
                definition.amount,
            ),
            provider: checkoutProvider,
            providerProductId: productId,
            trialDays: definition.trialDays,
        } satisfies BillingOffer;
    });

    const productIds = new Set(offers.map((offer) => offer.providerProductId));
    if (productIds.size !== offers.length) {
        throw new BillingConfigurationError("provider_products_must_be_unique");
    }

    return {
        deploymentMode: "cloud",
        checkoutProvider,
        enabledProviders,
        catalogRevision: revision,
        currency,
        offers,
    };
}

export function getBillingOffer(
    config: BillingConfig,
    plan: "pro" | "business",
    interval: BillingInterval,
): BillingOffer | null {
    return (
        config.offers.find(
            (offer) => offer.plan === plan && offer.interval === interval,
        ) ?? null
    );
}

export type TrialHmacSecret = { version: string; secret: string };

export function trialHmacSecrets(
    env: NodeJS.ProcessEnv = process.env,
): TrialHmacSecret[] {
    const current = env.BILLING_TRIAL_EMAIL_HMAC_KEY?.trim();
    if (!current) {
        throw new BillingConfigurationError(
            "BILLING_TRIAL_EMAIL_HMAC_KEY_missing",
        );
    }
    const version = env.BILLING_TRIAL_EMAIL_HMAC_KEY_VERSION?.trim() || "v1";
    const secrets: TrialHmacSecret[] = [{ version, secret: current }];
    const previous = env.BILLING_TRIAL_EMAIL_HMAC_KEY_PREVIOUS?.trim();
    if (previous) {
        secrets.push({
            version:
                env.BILLING_TRIAL_EMAIL_HMAC_KEY_PREVIOUS_VERSION?.trim() ||
                "previous",
            secret: previous,
        });
    }
    return secrets;
}

/** Secrets are checked separately from the public catalog parser so tests and
 * pricing pages can inspect a catalog without requiring provider credentials. */
export function assertBillingProviderConfig(
    config: BillingConfig,
    env: NodeJS.ProcessEnv = process.env,
): void {
    if (config.deploymentMode !== "cloud") return;
    trialHmacSecrets(env);
    if (config.checkoutProvider === "fake") {
        if (env.NODE_ENV === "production") {
            throw new BillingConfigurationError(
                "fake_billing_provider_not_allowed_in_production",
            );
        }
        return;
    }
    if (config.checkoutProvider === "dodo") {
        if (!env.DODO_PAYMENTS_API_KEY?.trim()) {
            throw new BillingConfigurationError(
                "DODO_PAYMENTS_API_KEY_missing",
            );
        }
        if (!env.DODO_PAYMENTS_WEBHOOK_KEY_CURRENT?.trim()) {
            throw new BillingConfigurationError(
                "DODO_PAYMENTS_WEBHOOK_KEY_CURRENT_missing",
            );
        }
        const environment = env.DODO_PAYMENTS_ENVIRONMENT;
        if (environment !== "test_mode" && environment !== "live_mode") {
            throw new BillingConfigurationError(
                "DODO_PAYMENTS_ENVIRONMENT_invalid",
            );
        }
        const previous = env.DODO_PAYMENTS_WEBHOOK_KEY_PREVIOUS?.trim();
        const expires = env.DODO_PAYMENTS_WEBHOOK_KEY_PREVIOUS_EXPIRES_AT;
        if (previous) {
            if (!expires) {
                throw new BillingConfigurationError(
                    "DODO_PAYMENTS_WEBHOOK_KEY_PREVIOUS_EXPIRES_AT_missing",
                );
            }
            const expiry = new Date(expires);
            const max = Date.now() + 48 * 60 * 60 * 1000;
            if (Number.isNaN(expiry.getTime()) || expiry.getTime() > max) {
                throw new BillingConfigurationError(
                    "DODO_PAYMENTS_WEBHOOK_KEY_PREVIOUS_must_expire_within_48_hours",
                );
            }
        }
    }
}

/** Stable email fingerprint helper; callers persist the active key version. */
export function fingerprintVerifiedEmail(
    email: string,
    secret: string,
): string {
    const normalized = email.trim().toLowerCase();
    return createHmac("sha256", secret)
        .update(normalized, "utf8")
        .digest("hex");
}
