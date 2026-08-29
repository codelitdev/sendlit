import { describe, expect, it } from "vitest";
import { BillingProviderError } from "../../provider";
import {
    createContractFake,
    runBillingProviderContract,
} from "../../provider-contract";
import { FakeBillingProvider } from "./index";

describe("fake billing provider", () => {
    it("satisfies the shared billing-provider contract", async () => {
        const { adapter, helpers } = createContractFake();
        await runBillingProviderContract(adapter, helpers);
    });

    it("fails closed on injected provider outages without creating a second checkout", async () => {
        const adapter = new FakeBillingProvider();
        adapter.seedDefaultCatalog();
        const customer = await adapter.createCustomer({
            email: "payer@example.com",
            idempotencyKey: "customer:outage",
        });
        adapter.nextFailure = new BillingProviderError("unavailable", "down");
        await expect(
            adapter.createCheckout({
                productId: "pdt_pro_month",
                currency: "USD",
                customerId: customer.providerCustomerId,
                payerEmail: "payer@example.com",
                returnUrl: "https://app.test/",
                attemptId: "bca_1",
                catalogKey: "pro_month",
                trialDays: 0,
                idempotencyKey: "checkout:outage",
            }),
        ).rejects.toMatchObject({ code: "unavailable" });
        const checkout = await adapter.createCheckout({
            productId: "pdt_pro_month",
            currency: "USD",
            customerId: customer.providerCustomerId,
            payerEmail: "payer@example.com",
            returnUrl: "https://app.test/",
            attemptId: "bca_1",
            catalogKey: "pro_month",
            trialDays: 0,
            idempotencyKey: "checkout:outage",
        });
        expect(checkout.providerCheckoutSessionId).toMatch(/^cs_/);
    });
});
