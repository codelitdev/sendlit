import { beforeEach, describe, expect, it, vi } from "vitest";

const catalogMocks = vi.hoisted(() => ({
    requireActiveCatalog: vi.fn(),
    verifyCheckoutOffer: vi.fn(),
    getBillingProvider: vi.fn(),
}));

vi.mock("../db/client", async () => {
    const { makeTestDb } = await import("../test/db.js");
    return { db: await makeTestDb() };
});

vi.mock("./catalog-store", () => ({
    requireActiveCatalog: catalogMocks.requireActiveCatalog,
    verifyCheckoutOffer: catalogMocks.verifyCheckoutOffer,
}));

vi.mock("./provider-registry", () => ({
    getBillingProvider: catalogMocks.getBillingProvider,
}));

import { eq } from "drizzle-orm";
import { db } from "../db/client";
import {
    billingPriceEntries,
    billingProviderCustomers,
    organizationPlanStates,
    organizationSubscriptions,
} from "../db/schema";
import { seedTeamAndContact, truncateAll, type TestDb } from "../test/db";
import { createOrganizationPlanChange } from "./plan-change";

const tdb = db as unknown as TestDb;

function cloudBillingEnv() {
    process.env.SENDLIT_DEPLOYMENT_MODE = "cloud";
    process.env.BILLING_CHECKOUT_PROVIDER = "dodo";
    process.env.BILLING_ENABLED_PROVIDERS = "dodo";
    process.env.BILLING_CATALOG_REVISION = "1";
    process.env.BILLING_CURRENCY = "USD";
    process.env.BILLING_PRO_MONTH_AMOUNT_MINOR = "4900";
    process.env.BILLING_PRO_YEAR_AMOUNT_MINOR = "49000";
    process.env.BILLING_BUSINESS_MONTH_AMOUNT_MINOR = "19900";
    process.env.BILLING_BUSINESS_YEAR_AMOUNT_MINOR = "199000";
    process.env.DODO_PRO_MONTH_PRODUCT_ID = "pdt_pro_month";
    process.env.DODO_PRO_YEAR_PRODUCT_ID = "pdt_pro_year";
    process.env.DODO_BUSINESS_MONTH_PRODUCT_ID = "pdt_business_month";
    process.env.DODO_BUSINESS_YEAR_PRODUCT_ID = "pdt_business_year";
}

beforeEach(async () => {
    cloudBillingEnv();
    catalogMocks.requireActiveCatalog.mockReset();
    catalogMocks.verifyCheckoutOffer.mockReset();
    catalogMocks.getBillingProvider.mockReset();
    catalogMocks.getBillingProvider.mockReturnValue({
        provider: "dodo",
        capabilities: {
            planChanges: true,
            intervalChanges: true,
            portalPlanChanges: false,
            portalIntervalChanges: false,
            proratedPlanChanges: true,
        },
        changeSubscriptionPlan: vi.fn().mockResolvedValue({
            provider: "dodo",
            providerPaymentId: null,
            paymentUrl: null,
        }),
    });
    await truncateAll(tdb);
});

async function seedActiveSubscription() {
    const { account, organization } = await seedTeamAndContact(tdb);
    const [currentPrice] = await tdb
        .insert(billingPriceEntries)
        .values({
            catalogKey: "pro_month",
            plan: "pro",
            billingInterval: "month",
            currency: "USD",
            amountMinor: 4900,
            provider: "dodo",
            providerProductId: "pdt_pro_month",
        })
        .returning();
    const [targetPrice] = await tdb
        .insert(billingPriceEntries)
        .values({
            catalogKey: "business_month",
            plan: "business",
            billingInterval: "month",
            currency: "USD",
            amountMinor: 19900,
            provider: "dodo",
            providerProductId: "pdt_business_month",
        })
        .returning();
    const [customer] = await tdb
        .insert(billingProviderCustomers)
        .values({
            provider: "dodo",
            userId: account.id,
            providerCustomerId: `cus_${crypto.randomUUID()}`,
            idempotencyKey: `customer:dodo:${account.id}`,
            status: "active",
        })
        .returning();
    const [subscription] = await tdb
        .insert(organizationSubscriptions)
        .values({
            organizationId: organization.id,
            billingCustomerId: customer.id,
            billingManagerUserId: account.id,
            provider: "dodo",
            providerSubscriptionId: `sub_${crypto.randomUUID()}`,
            providerProductId: currentPrice.providerProductId,
            billingPriceEntryId: currentPrice.id,
            catalogKey: "pro_month",
            plan: "pro",
            billingInterval: "month",
            status: "active",
            isEntitlementSource: true,
        })
        .returning();
    await tdb
        .update(organizationPlanStates)
        .set({
            plan: "pro",
            activeSubscriptionId: subscription.id,
        })
        .where(eq(organizationPlanStates.organizationId, organization.id));
    catalogMocks.requireActiveCatalog.mockResolvedValue({
        revision: { revision: 1, status: "active" },
        items: [
            { catalogKey: "pro_month", price: currentPrice },
            { catalogKey: "business_month", price: targetPrice },
        ],
    });
    catalogMocks.verifyCheckoutOffer.mockResolvedValue(undefined);
    return { account, organization, subscription, targetPrice };
}

describe("plan-change pointer revalidation", () => {
    it("rejects a plan change when the active subscription pointer has been cleared", async () => {
        const { account, organization } = await seedActiveSubscription();
        await tdb
            .update(organizationPlanStates)
            .set({ plan: "free", activeSubscriptionId: null })
            .where(eq(organizationPlanStates.organizationId, organization.id));

        await expect(
            createOrganizationPlanChange({
                organizationId: organization.id,
                actorUserId: account.id,
                plan: "business",
                interval: "month",
                catalogRevision: 1,
            }),
        ).rejects.toMatchObject({
            code: "billing_subscription_required",
            status: 402,
        });
    });

    it("rejects a plan change when the locked active subscription is no longer changeable", async () => {
        const { account, organization, subscription } =
            await seedActiveSubscription();
        await tdb
            .update(organizationSubscriptions)
            .set({ status: "cancelled", cancelAtPeriodEnd: true })
            .where(eq(organizationSubscriptions.id, subscription.id));

        await expect(
            createOrganizationPlanChange({
                organizationId: organization.id,
                actorUserId: account.id,
                plan: "business",
                interval: "month",
                catalogRevision: 1,
            }),
        ).rejects.toMatchObject({
            code: "billing_subscription_not_changeable",
            status: 409,
        });
    });
});
