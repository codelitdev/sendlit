import { afterEach, describe, expect, it } from "vitest";
import {
    assertBillingProviderConfig,
    BillingConfigurationError,
    readBillingConfig,
    trialHmacSecrets,
} from "./catalog";

const keys = [
    "SENDLIT_DEPLOYMENT_MODE",
    "BILLING_CHECKOUT_PROVIDER",
    "BILLING_ENABLED_PROVIDERS",
    "BILLING_CATALOG_REVISION",
    "BILLING_CURRENCY",
    "BILLING_PRO_MONTH_AMOUNT_MINOR",
    "BILLING_PRO_YEAR_AMOUNT_MINOR",
    "BILLING_BUSINESS_MONTH_AMOUNT_MINOR",
    "BILLING_BUSINESS_YEAR_AMOUNT_MINOR",
    "DODO_PRO_MONTH_PRODUCT_ID",
    "DODO_PRO_YEAR_PRODUCT_ID",
    "DODO_BUSINESS_MONTH_PRODUCT_ID",
    "DODO_BUSINESS_YEAR_PRODUCT_ID",
    "BILLING_TRIAL_EMAIL_HMAC_KEY",
] as const;
const original = Object.fromEntries(keys.map((key) => [key, process.env[key]]));

afterEach(() => {
    for (const key of keys) {
        const value = original[key];
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
    }
});

function cloudEnv(overrides: Record<string, string | undefined> = {}) {
    process.env = {
        ...process.env,
        SENDLIT_DEPLOYMENT_MODE: "cloud",
        BILLING_CHECKOUT_PROVIDER: "dodo",
        BILLING_ENABLED_PROVIDERS: "dodo",
        BILLING_CATALOG_REVISION: "1",
        BILLING_CURRENCY: "USD",
        BILLING_PRO_MONTH_AMOUNT_MINOR: "4900",
        BILLING_PRO_YEAR_AMOUNT_MINOR: "49000",
        BILLING_BUSINESS_MONTH_AMOUNT_MINOR: "19900",
        BILLING_BUSINESS_YEAR_AMOUNT_MINOR: "199000",
        DODO_PRO_MONTH_PRODUCT_ID: "pdt_pro_month",
        DODO_PRO_YEAR_PRODUCT_ID: "pdt_pro_year",
        DODO_BUSINESS_MONTH_PRODUCT_ID: "pdt_business_month",
        DODO_BUSINESS_YEAR_PRODUCT_ID: "pdt_business_year",
        BILLING_TRIAL_EMAIL_HMAC_KEY: "trial-hmac-secret",
        ...overrides,
    };
}

describe("readBillingConfig", () => {
    it("rejects missing deployment mode", () => {
        delete process.env.SENDLIT_DEPLOYMENT_MODE;
        expect(() => readBillingConfig()).toThrow(BillingConfigurationError);
    });

    it("rejects fractional amounts", () => {
        cloudEnv({ BILLING_PRO_MONTH_AMOUNT_MINOR: "49.00" });
        expect(() => readBillingConfig()).toThrow(/must_be_decimal_integer/);
    });

    it("rejects negative and zero amounts", () => {
        cloudEnv({ BILLING_PRO_MONTH_AMOUNT_MINOR: "0" });
        expect(() => readBillingConfig()).toThrow(/out_of_range/);
    });

    it("rejects whitespace-padded amounts", () => {
        cloudEnv({ BILLING_PRO_MONTH_AMOUNT_MINOR: " 4900" });
        expect(() => readBillingConfig()).toThrow(/whitespace|decimal/);
    });

    it("rejects duplicate provider products", () => {
        cloudEnv({ DODO_PRO_YEAR_PRODUCT_ID: "pdt_pro_month" });
        expect(() => readBillingConfig()).toThrow(/unique/);
    });

    it("parses a valid cloud catalog without exposing floats", () => {
        cloudEnv();
        const config = readBillingConfig();
        expect(config.offers).toHaveLength(4);
        expect(
            config.offers.every((offer) => Number.isInteger(offer.amountMinor)),
        ).toBe(true);
    });
});

describe("trialHmacSecrets", () => {
    it("requires a dedicated HMAC key", () => {
        delete process.env.BILLING_TRIAL_EMAIL_HMAC_KEY;
        expect(() => trialHmacSecrets()).toThrow(
            /BILLING_TRIAL_EMAIL_HMAC_KEY_missing/,
        );
    });
});

const fakeProductIds = {
    FAKE_PRO_MONTH_PRODUCT_ID: "pdt_pro_month",
    FAKE_PRO_YEAR_PRODUCT_ID: "pdt_pro_year",
    FAKE_BUSINESS_MONTH_PRODUCT_ID: "pdt_business_month",
    FAKE_BUSINESS_YEAR_PRODUCT_ID: "pdt_business_year",
};

describe("fake checkout provider", () => {
    it("allows cloud tests without Dodo credentials", () => {
        cloudEnv({
            BILLING_CHECKOUT_PROVIDER: "fake",
            BILLING_ENABLED_PROVIDERS: "fake",
            ...fakeProductIds,
        });
        expect(() =>
            assertBillingProviderConfig(readBillingConfig()),
        ).not.toThrow();
    });

    it("refuses the fake adapter in production", () => {
        const previous = process.env.NODE_ENV;
        cloudEnv({
            BILLING_CHECKOUT_PROVIDER: "fake",
            BILLING_ENABLED_PROVIDERS: "fake",
            ...fakeProductIds,
        });
        process.env.NODE_ENV = "production";
        try {
            expect(() =>
                assertBillingProviderConfig(readBillingConfig()),
            ).toThrow(/fake_billing_provider_not_allowed_in_production/);
        } finally {
            process.env.NODE_ENV = previous;
        }
    });
});
