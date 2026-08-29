import { createHmac, timingSafeEqual } from "node:crypto";
import type {
    BillingCustomer,
    BillingProductSnapshot,
    BillingProviderAdapter,
    CanonicalBillingEvent,
    Checkout,
    PortalSession,
    RawWebhookRequest,
    SubscriptionPlanChangeInput,
    SubscriptionPlanChangeResult,
    SubscriptionSnapshot,
} from "../../provider";
import { BillingProviderError } from "../../provider";

export const FAKE_BILLING_WEBHOOK_KEY = "whsec_fake_test_key";

type StoredCheckout = Checkout & {
    productId: string;
    customerId: string;
    attemptId: string;
    catalogKey: string;
    trialDays: number;
    idempotencyKey: string;
};

const WEBHOOK_MAX_AGE_SECONDS = 5 * 60;

function hmac(key: string, payload: string): string {
    return createHmac("sha256", key).update(payload, "utf8").digest("hex");
}

function equalHex(left: string, right: string): boolean {
    const a = Buffer.from(left);
    const b = Buffer.from(right);
    return a.length === b.length && timingSafeEqual(a, b);
}

/** In-memory billing provider for domain tests. It speaks SendLit canonical
 * types only — no Dodo SDK, product IDs as opaque strings. */
export class FakeBillingProvider implements BillingProviderAdapter {
    readonly provider = "fake" as const;
    readonly capabilities = {
        planChanges: true,
        intervalChanges: true,
        portalPlanChanges: false,
        portalIntervalChanges: false,
        proratedPlanChanges: true,
    } as const;

    private readonly webhookKey: string;
    private products = new Map<string, BillingProductSnapshot>();
    private customersByKey = new Map<string, BillingCustomer>();
    private customersById = new Map<string, BillingCustomer>();
    private checkoutsByKey = new Map<string, StoredCheckout>();
    private checkoutsById = new Map<string, StoredCheckout>();
    private subscriptions = new Map<string, SubscriptionSnapshot>();
    private nextId = 1;
    nextFailure: BillingProviderError | null = null;

    constructor(webhookKey = FAKE_BILLING_WEBHOOK_KEY) {
        this.webhookKey = webhookKey;
    }

    seedProduct(product: BillingProductSnapshot): void {
        this.products.set(product.providerProductId, {
            ...product,
            provider: this.provider,
        });
    }

    seedDefaultCatalog(): void {
        const rows: Array<
            Pick<
                BillingProductSnapshot,
                "providerProductId" | "amountMinor" | "interval"
            >
        > = [
            {
                providerProductId: "pdt_pro_month",
                amountMinor: 4900,
                interval: "month",
            },
            {
                providerProductId: "pdt_pro_year",
                amountMinor: 49000,
                interval: "year",
            },
            {
                providerProductId: "pdt_business_month",
                amountMinor: 19900,
                interval: "month",
            },
            {
                providerProductId: "pdt_business_year",
                amountMinor: 199000,
                interval: "year",
            },
        ];
        for (const row of rows) {
            this.seedProduct({
                provider: this.provider,
                currency: "USD",
                ...row,
            });
        }
    }

    signWebhook(
        body: string,
        eventId = `evt_${this.nextId++}`,
        occurredAt = new Date(),
    ) {
        const timestamp = String(Math.floor(occurredAt.getTime() / 1000));
        return {
            body,
            headers: {
                "webhook-id": eventId,
                "webhook-timestamp": timestamp,
                "webhook-signature": `v1,${hmac(this.webhookKey, `${eventId}.${timestamp}.${body}`)}`,
            },
        };
    }

    async simulatePayment(
        sessionId: string,
        occurredAt = new Date(),
    ): Promise<SubscriptionSnapshot> {
        const checkout = this.checkoutsById.get(sessionId);
        if (!checkout)
            throw new BillingProviderError("invalid", "checkout_not_found");
        const existing = [...this.subscriptions.values()].find(
            (row) =>
                row.metadata.sendlitCheckoutAttemptId === checkout.attemptId,
        );
        if (existing) return existing;
        const periodEnd = new Date(
            occurredAt.getTime() + 30 * 24 * 60 * 60 * 1000,
        );
        const trialEndsAt =
            checkout.trialDays > 0
                ? new Date(
                      occurredAt.getTime() +
                          checkout.trialDays * 24 * 60 * 60 * 1000,
                  )
                : null;
        const snapshot: SubscriptionSnapshot = {
            provider: this.provider,
            providerCustomerId: checkout.customerId,
            providerSubscriptionId: `sub_${this.nextId++}`,
            providerProductId: checkout.productId,
            status:
                trialEndsAt && trialEndsAt > occurredAt ? "trialing" : "active",
            currentPeriodStartsAt: occurredAt,
            currentPeriodEndsAt: periodEnd,
            paidThroughAt: periodEnd,
            trialEndsAt,
            cancelAtPeriodEnd: false,
            occurredAt,
            metadata: {
                sendlitCheckoutAttemptId: checkout.attemptId,
                catalogKey: checkout.catalogKey,
            },
        };
        this.subscriptions.set(snapshot.providerSubscriptionId, snapshot);
        return snapshot;
    }

    private failIfInjected(): void {
        if (!this.nextFailure) return;
        const error = this.nextFailure;
        this.nextFailure = null;
        throw error;
    }

    async createCustomer(input: {
        email: string;
        name?: string | null;
        idempotencyKey: string;
    }): Promise<BillingCustomer> {
        this.failIfInjected();
        const existing = this.customersByKey.get(input.idempotencyKey);
        if (existing) return existing;
        const customer: BillingCustomer = {
            provider: this.provider,
            providerCustomerId: `cus_${this.nextId++}`,
        };
        this.customersByKey.set(input.idempotencyKey, customer);
        this.customersById.set(customer.providerCustomerId, customer);
        return customer;
    }

    async createCheckout(input: {
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
    }): Promise<Checkout> {
        this.failIfInjected();
        if (!this.customersById.has(input.customerId)) {
            throw new BillingProviderError("invalid", "customer_not_found");
        }
        if (!this.products.has(input.productId)) {
            throw new BillingProviderError("invalid", "product_not_found");
        }
        const existing = this.checkoutsByKey.get(input.idempotencyKey);
        if (existing) {
            return {
                provider: existing.provider,
                providerCheckoutSessionId: existing.providerCheckoutSessionId,
                checkoutUrl: existing.checkoutUrl,
            };
        }
        const sessionId = `cs_${this.nextId++}`;
        const stored: StoredCheckout = {
            provider: this.provider,
            providerCheckoutSessionId: sessionId,
            checkoutUrl: `https://billing.test/checkout/${sessionId}`,
            productId: input.productId,
            customerId: input.customerId,
            attemptId: input.attemptId,
            catalogKey: input.catalogKey,
            trialDays: input.trialDays,
            idempotencyKey: input.idempotencyKey,
        };
        this.checkoutsByKey.set(input.idempotencyKey, stored);
        this.checkoutsById.set(sessionId, stored);
        return {
            provider: stored.provider,
            providerCheckoutSessionId: stored.providerCheckoutSessionId,
            checkoutUrl: stored.checkoutUrl,
        };
    }

    async createPortalSession(input: {
        customerId: string;
        returnUrl: string;
    }): Promise<PortalSession> {
        this.failIfInjected();
        if (!this.customersById.has(input.customerId)) {
            throw new BillingProviderError("invalid", "customer_not_found");
        }
        return {
            provider: this.provider,
            portalUrl: `https://billing.test/portal/${input.customerId}?return=${encodeURIComponent(input.returnUrl)}`,
        };
    }

    async changeSubscriptionPlan(
        input: SubscriptionPlanChangeInput,
    ): Promise<SubscriptionPlanChangeResult> {
        this.failIfInjected();
        const current = this.subscriptions.get(input.providerSubscriptionId);
        if (!current)
            throw new BillingProviderError("invalid", "subscription_not_found");
        if (!this.products.has(input.targetProviderProductId)) {
            throw new BillingProviderError("invalid", "product_not_found");
        }
        if (input.effectiveAt === "immediately") {
            this.subscriptions.set(input.providerSubscriptionId, {
                ...current,
                providerProductId: input.targetProviderProductId,
                occurredAt: new Date(),
            });
        }
        return {
            provider: this.provider,
            providerPaymentId:
                input.prorationMode === "prorated_immediately"
                    ? `pay_${this.nextId++}`
                    : null,
            paymentUrl: null,
        };
    }

    async retrieveProduct(id: string): Promise<BillingProductSnapshot> {
        this.failIfInjected();
        const product = this.products.get(id);
        if (!product)
            throw new BillingProviderError("invalid", "product_not_found");
        return { ...product };
    }

    async retrieveSubscription(id: string): Promise<SubscriptionSnapshot> {
        this.failIfInjected();
        const subscription = this.subscriptions.get(id);
        if (!subscription) {
            throw new BillingProviderError("invalid", "subscription_not_found");
        }
        return { ...subscription, occurredAt: new Date() };
    }

    async cancelSubscription(
        id: string,
        _idempotencyKey: string,
    ): Promise<void> {
        this.failIfInjected();
        const current = this.subscriptions.get(id);
        if (!current)
            throw new BillingProviderError("invalid", "subscription_not_found");
        this.subscriptions.set(id, {
            ...current,
            status: "cancelled",
            cancelAtPeriodEnd: false,
            occurredAt: new Date(),
        });
    }

    async parseWebhook(
        input: RawWebhookRequest,
    ): Promise<CanonicalBillingEvent> {
        const eventId =
            input.headers["webhook-id"] ?? input.headers["Webhook-Id"];
        const timestamp =
            input.headers["webhook-timestamp"] ??
            input.headers["Webhook-Timestamp"];
        const signature =
            input.headers["webhook-signature"] ??
            input.headers["Webhook-Signature"];
        if (!eventId || !timestamp || !signature) {
            throw new Error("webhook_signature_invalid");
        }
        const age = Math.abs(Date.now() / 1000 - Number(timestamp));
        if (!Number.isFinite(age) || age > WEBHOOK_MAX_AGE_SECONDS) {
            throw new Error("webhook_timestamp_stale");
        }
        const expected = `v1,${hmac(this.webhookKey, `${eventId}.${timestamp}.${input.body}`)}`;
        if (!equalHex(signature, expected)) {
            throw new Error("webhook_signature_invalid");
        }
        const event = JSON.parse(input.body) as {
            type?: string;
            data?: {
                subscription_id?: string;
                customer_id?: string;
                product_id?: string;
                status?: string;
                metadata?: {
                    sendlitCheckoutAttemptId?: string;
                    catalogKey?: string;
                };
            };
        };
        const occurredAt = new Date(Number(timestamp) * 1000);
        const subscriptionId = event.data?.subscription_id;
        const stored = subscriptionId
            ? this.subscriptions.get(subscriptionId)
            : undefined;
        const snapshot = stored
            ? { ...stored, occurredAt }
            : event.data?.subscription_id
              ? {
                    provider: this.provider,
                    providerCustomerId: event.data.customer_id ?? "",
                    providerSubscriptionId: event.data.subscription_id,
                    providerProductId: event.data.product_id ?? "",
                    status:
                        (event.data.status as SubscriptionSnapshot["status"]) ??
                        "pending",
                    currentPeriodStartsAt: null,
                    currentPeriodEndsAt: null,
                    paidThroughAt: null,
                    trialEndsAt: null,
                    cancelAtPeriodEnd: false,
                    occurredAt,
                    metadata: {
                        sendlitCheckoutAttemptId:
                            event.data.metadata?.sendlitCheckoutAttemptId,
                        catalogKey: event.data.metadata?.catalogKey,
                    },
                }
              : undefined;
        return {
            provider: this.provider,
            providerEventId: eventId,
            eventType: String(event.type ?? "unknown"),
            occurredAt,
            subscriptionId,
            snapshot,
            rawPayload: event,
        };
    }
}
