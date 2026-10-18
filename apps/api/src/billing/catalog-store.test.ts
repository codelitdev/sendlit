import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db/client", async () => {
    const { makeTestDb } = await import("../test/db.js");
    return { db: await makeTestDb() };
});

import { db } from "../db/client";
import { truncateAll, type TestDb } from "../test/db";
import { readBillingConfig } from "./catalog";
import {
    getActiveCatalog,
    verifyCatalogAgainstProvider,
} from "./catalog-store";
import { FakeBillingProvider } from "./providers/fake";
import {
    getBillingProvider,
    resetBillingProviderInstances,
} from "./provider-registry";

const tdb = db as unknown as TestDb;

function cloudFakeEnv() {
    process.env.SENDLIT_DEPLOYMENT_MODE = "cloud";
    process.env.BILLING_CHECKOUT_PROVIDER = "fake";
    process.env.BILLING_ENABLED_PROVIDERS = "fake";
    process.env.BILLING_CATALOG_REVISION = "1";
    process.env.BILLING_CURRENCY = "USD";
    process.env.BILLING_PRO_MONTH_AMOUNT_MINOR = "4900";
    process.env.BILLING_PRO_YEAR_AMOUNT_MINOR = "49000";
    process.env.BILLING_BUSINESS_MONTH_AMOUNT_MINOR = "19900";
    process.env.BILLING_BUSINESS_YEAR_AMOUNT_MINOR = "199000";
    process.env.FAKE_PRO_MONTH_PRODUCT_ID = "pdt_pro_month";
    process.env.FAKE_PRO_YEAR_PRODUCT_ID = "pdt_pro_year";
    process.env.FAKE_BUSINESS_MONTH_PRODUCT_ID = "pdt_business_month";
    process.env.FAKE_BUSINESS_YEAR_PRODUCT_ID = "pdt_business_year";
    process.env.BILLING_TRIAL_EMAIL_HMAC_KEY = "trial-hmac-secret";
}

beforeEach(async () => {
    cloudFakeEnv();
    resetBillingProviderInstances();
    await truncateAll(tdb);
});

describe("catalog verification against the fake adapter", () => {
    it("activates a four-offer revision when products match", async () => {
        getBillingProvider("fake");
        await verifyCatalogAgainstProvider(readBillingConfig());
        const active = await getActiveCatalog(readBillingConfig());
        expect(active.revision.revision).toBe(1);
        expect(active.items).toHaveLength(4);
    });

    it("rejects a provider amount mismatch without activating", async () => {
        const provider = getBillingProvider("fake") as FakeBillingProvider;
        provider.seedProduct({
            provider: "fake",
            providerProductId: "pdt_pro_month",
            currency: "USD",
            amountMinor: 9900,
            interval: "month",
        });
        await expect(
            verifyCatalogAgainstProvider(readBillingConfig()),
        ).rejects.toThrow(/billing_catalog_unavailable/);
    });
});
