/**
 * Provider-neutral billing contract.  Nothing outside `providers/*` should
 * import a payment provider SDK or inspect its payloads/status names.
 */
export type BillingProviderId = "dodo" | (string & {});

export type BillingProductSnapshot = {
    provider: BillingProviderId;
    providerProductId: string;
    currency: string;
    amountMinor: number;
    interval: "month" | "year";
};

export type BillingCustomer = {
    provider: BillingProviderId;
    providerCustomerId: string;
};

export type Checkout = {
    provider: BillingProviderId;
    providerCheckoutSessionId: string;
    checkoutUrl: string;
};

export type PortalSession = {
    provider: BillingProviderId;
    portalUrl: string;
};

export type SubscriptionPlanChangeInput = {
    providerSubscriptionId: string;
    targetProviderProductId: string;
    effectiveAt: "immediately" | "next_billing_date";
    prorationMode: "prorated_immediately" | "do_not_bill";
    idempotencyKey: string;
};

export type SubscriptionPlanChangeResult = {
    provider: BillingProviderId;
    providerPaymentId: string | null;
    paymentUrl: string | null;
};

export type SubscriptionSnapshot = {
    provider: BillingProviderId;
    providerCustomerId: string;
    providerSubscriptionId: string;
    providerProductId: string;
    status:
        | "pending"
        | "trialing"
        | "active"
        | "past_due"
        | "cancelled"
        | "expired";
    currentPeriodStartsAt: Date | null;
    currentPeriodEndsAt: Date | null;
    paidThroughAt: Date | null;
    trialEndsAt: Date | null;
    cancelAtPeriodEnd: boolean;
    occurredAt: Date;
    metadata: {
        sendlitCheckoutAttemptId?: string;
        catalogKey?: string;
    };
};

export type RawWebhookRequest = {
    body: string;
    headers: Record<string, string>;
};

export type CanonicalBillingEvent = {
    provider: BillingProviderId;
    providerEventId: string;
    eventType: string;
    occurredAt: Date;
    subscriptionId?: string;
    snapshot?: SubscriptionSnapshot;
    rawPayload: unknown;
};

export type BillingProviderErrorCode =
    | "invalid"
    | "unauthorized"
    | "conflict"
    | "rate_limited"
    | "unavailable"
    | "misconfigured";

export class BillingProviderError extends Error {
    constructor(
        public readonly code: BillingProviderErrorCode,
        message: string,
        public readonly cause?: unknown,
    ) {
        super(message);
        this.name = "BillingProviderError";
    }
}

/** Provider SDK messages can contain request IDs, URLs, or response bodies.
 * Persist only a stable category in billing rows/logs. */
export function providerErrorSummary(error: unknown): string {
    if (error instanceof BillingProviderError) return `provider_${error.code}`;
    return "provider_error";
}

export interface BillingProviderAdapter {
    readonly provider: BillingProviderId;
    readonly capabilities: {
        planChanges: boolean;
        intervalChanges: boolean;
        portalPlanChanges: boolean;
        portalIntervalChanges: boolean;
        proratedPlanChanges: boolean;
    };
    createCustomer(input: {
        email: string;
        name?: string | null;
        idempotencyKey: string;
    }): Promise<BillingCustomer>;
    createCheckout(input: {
        productId: string;
        currency: string;
        customerId: string;
        payerEmail: string;
        returnUrl: string;
        cancelUrl?: string;
        attemptId: string;
        catalogKey: string;
        trialDays: number;
        idempotencyKey: string;
    }): Promise<Checkout>;
    createPortalSession(input: {
        customerId: string;
        returnUrl: string;
    }): Promise<PortalSession>;
    changeSubscriptionPlan(
        input: SubscriptionPlanChangeInput,
    ): Promise<SubscriptionPlanChangeResult>;
    retrieveProduct(id: string): Promise<BillingProductSnapshot>;
    retrieveSubscription(id: string): Promise<SubscriptionSnapshot>;
    cancelSubscription(id: string, idempotencyKey: string): Promise<void>;
    parseWebhook(input: RawWebhookRequest): Promise<CanonicalBillingEvent>;
}
