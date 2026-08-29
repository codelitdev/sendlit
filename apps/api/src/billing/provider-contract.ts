import { expect } from "vitest";
import { BillingProviderError, type BillingProviderAdapter } from "./provider";
import {
    FakeBillingProvider,
    FAKE_BILLING_WEBHOOK_KEY,
} from "./providers/fake";

/** Shared adapter contract. Every billing provider, including the in-memory
 * fake, must satisfy these canonical behaviors. */
export async function runBillingProviderContract(
    adapter: BillingProviderAdapter,
    helpers: {
        signWebhook: FakeBillingProvider["signWebhook"];
        simulatePayment: FakeBillingProvider["simulatePayment"];
        productId: string;
        otherProductId: string;
    },
): Promise<void> {
    expect(adapter.capabilities.portalPlanChanges).toBe(false);
    expect(adapter.capabilities.portalIntervalChanges).toBe(false);

    const product = await adapter.retrieveProduct(helpers.productId);
    expect(product.provider).toBe(adapter.provider);
    expect(product.providerProductId).toBe(helpers.productId);
    expect(product.amountMinor).toBeGreaterThan(0);
    expect(product.interval === "month" || product.interval === "year").toBe(
        true,
    );

    await expect(adapter.retrieveProduct("pdt_unknown")).rejects.toBeInstanceOf(
        BillingProviderError,
    );

    const customer = await adapter.createCustomer({
        email: "payer@example.com",
        name: "Payer",
        idempotencyKey: "customer:fake:1",
    });
    const customerAgain = await adapter.createCustomer({
        email: "payer@example.com",
        name: "Payer",
        idempotencyKey: "customer:fake:1",
    });
    expect(customerAgain.providerCustomerId).toBe(customer.providerCustomerId);

    const checkout = await adapter.createCheckout({
        productId: helpers.productId,
        currency: product.currency,
        customerId: customer.providerCustomerId,
        payerEmail: "payer@example.com",
        returnUrl: "https://app.test/organizations?tab=plan",
        attemptId: "bca_attempt_1",
        catalogKey: "pro_month",
        trialDays: 14,
        idempotencyKey: "checkout:fake:1",
    });
    expect(checkout.checkoutUrl.startsWith("http")).toBe(true);
    const checkoutAgain = await adapter.createCheckout({
        productId: helpers.productId,
        currency: product.currency,
        customerId: customer.providerCustomerId,
        payerEmail: "payer@example.com",
        returnUrl: "https://app.test/organizations?tab=plan",
        attemptId: "bca_attempt_1",
        catalogKey: "pro_month",
        trialDays: 14,
        idempotencyKey: "checkout:fake:1",
    });
    expect(checkoutAgain.providerCheckoutSessionId).toBe(
        checkout.providerCheckoutSessionId,
    );

    const paid = await helpers.simulatePayment(
        checkout.providerCheckoutSessionId,
    );
    expect(paid.status === "trialing" || paid.status === "active").toBe(true);
    expect(paid.metadata.sendlitCheckoutAttemptId).toBe("bca_attempt_1");
    const retrieved = await adapter.retrieveSubscription(
        paid.providerSubscriptionId,
    );
    expect(retrieved.providerProductId).toBe(helpers.productId);
    expect(retrieved.providerCustomerId).toBe(customer.providerCustomerId);

    const changed = await adapter.changeSubscriptionPlan({
        providerSubscriptionId: paid.providerSubscriptionId,
        targetProviderProductId: helpers.otherProductId,
        effectiveAt: "immediately",
        prorationMode: "prorated_immediately",
        idempotencyKey: "plan-change:fake:1",
    });
    expect(changed.provider).toBe(adapter.provider);
    const afterChange = await adapter.retrieveSubscription(
        paid.providerSubscriptionId,
    );
    expect(afterChange.providerProductId).toBe(helpers.otherProductId);

    const portal = await adapter.createPortalSession({
        customerId: customer.providerCustomerId,
        returnUrl: "https://app.test/organizations?tab=plan",
    });
    expect(portal.portalUrl.startsWith("http")).toBe(true);

    await adapter.cancelSubscription(
        paid.providerSubscriptionId,
        "cancel:fake:1",
    );
    const cancelled = await adapter.retrieveSubscription(
        paid.providerSubscriptionId,
    );
    expect(cancelled.status).toBe("cancelled");

    const signed = helpers.signWebhook(
        JSON.stringify({
            type: "subscription.updated",
            data: {
                subscription_id: paid.providerSubscriptionId,
                customer_id: customer.providerCustomerId,
                product_id: helpers.otherProductId,
                status: "cancelled",
            },
        }),
    );
    const event = await adapter.parseWebhook(signed);
    expect(event.provider).toBe(adapter.provider);
    expect(event.subscriptionId).toBe(paid.providerSubscriptionId);
    expect(event.eventType).toBe("subscription.updated");

    await expect(
        adapter.parseWebhook({
            body: signed.body,
            headers: { ...signed.headers, "webhook-signature": "v1,deadbeef" },
        }),
    ).rejects.toThrow(/webhook_signature_invalid/);

    const stale = helpers.signWebhook(
        JSON.stringify({ type: "subscription.updated", data: {} }),
        "evt_stale",
        new Date(Date.now() - 10 * 60 * 1000),
    );
    await expect(adapter.parseWebhook(stale)).rejects.toThrow(
        /webhook_timestamp_stale/,
    );
}

export function createContractFake(): {
    adapter: FakeBillingProvider;
    helpers: Parameters<typeof runBillingProviderContract>[1];
} {
    const adapter = new FakeBillingProvider(FAKE_BILLING_WEBHOOK_KEY);
    adapter.seedDefaultCatalog();
    return {
        adapter,
        helpers: {
            signWebhook: adapter.signWebhook.bind(adapter),
            simulatePayment: adapter.simulatePayment.bind(adapter),
            productId: "pdt_pro_month",
            otherProductId: "pdt_business_month",
        },
    };
}
