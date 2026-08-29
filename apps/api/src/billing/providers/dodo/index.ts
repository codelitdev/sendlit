import DodoPayments from "dodopayments";
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

function providerError(error: unknown): BillingProviderError {
    const status = Number((error as { status?: number })?.status ?? 0);
    const message =
        error instanceof Error ? error.message : "provider request failed";
    const code =
        status === 401 || status === 403
            ? "unauthorized"
            : status === 409
              ? "conflict"
              : status === 429
                ? "rate_limited"
                : status >= 400 && status < 500
                  ? "invalid"
                  : status >= 500 || status === 0
                    ? "unavailable"
                    : "unavailable";
    return new BillingProviderError(code, message, error);
}

function dateOrNull(value: unknown): Date | null {
    if (typeof value !== "string" || !value) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
}

function metadataValue(metadata: unknown, key: string): string | undefined {
    if (!metadata || typeof metadata !== "object") return undefined;
    const value = (metadata as Record<string, unknown>)[key];
    return typeof value === "string" ? value : undefined;
}

function normalizeSubscription(
    data: any,
    eventType: string,
    occurredAt: Date,
): SubscriptionSnapshot {
    const sourceStatus = String(data?.status ?? "pending").toLowerCase();
    const status: SubscriptionSnapshot["status"] =
        sourceStatus === "active"
            ? "active"
            : sourceStatus === "on_hold" || sourceStatus === "paused"
              ? "past_due"
              : sourceStatus === "cancelled"
                ? "cancelled"
                : sourceStatus === "expired" || sourceStatus === "failed"
                  ? "expired"
                  : sourceStatus === "pending"
                    ? "pending"
                    : eventType === "subscription.on_hold"
                      ? "past_due"
                      : "pending";
    const trialEndsAt = dateOrNull(data?.trial_end ?? data?.trial_ends_at);
    if (status === "active" && trialEndsAt && trialEndsAt > occurredAt) {
        return {
            provider: "dodo",
            providerCustomerId: String(
                data?.customer?.customer_id ?? data?.customer_id ?? "",
            ),
            providerSubscriptionId: String(
                data?.subscription_id ?? data?.id ?? "",
            ),
            providerProductId: String(data?.product_id ?? ""),
            status: "trialing",
            currentPeriodStartsAt: dateOrNull(
                data?.previous_billing_date ?? data?.current_period_start,
            ),
            currentPeriodEndsAt: dateOrNull(
                data?.next_billing_date ?? data?.current_period_end,
            ),
            paidThroughAt: dateOrNull(
                data?.next_billing_date ?? data?.current_period_end,
            ),
            trialEndsAt,
            cancelAtPeriodEnd: Boolean(data?.cancel_at_next_billing_date),
            occurredAt,
            metadata: {
                sendlitCheckoutAttemptId: metadataValue(
                    data?.metadata,
                    "sendlitCheckoutAttemptId",
                ),
                catalogKey: metadataValue(data?.metadata, "catalogKey"),
            },
        };
    }
    return {
        provider: "dodo",
        providerCustomerId: String(
            data?.customer?.customer_id ?? data?.customer_id ?? "",
        ),
        providerSubscriptionId: String(data?.subscription_id ?? data?.id ?? ""),
        providerProductId: String(data?.product_id ?? ""),
        status,
        currentPeriodStartsAt: dateOrNull(
            data?.previous_billing_date ?? data?.current_period_start,
        ),
        currentPeriodEndsAt: dateOrNull(
            data?.next_billing_date ?? data?.current_period_end,
        ),
        paidThroughAt: dateOrNull(
            data?.next_billing_date ??
                data?.current_period_end ??
                data?.expires_at,
        ),
        trialEndsAt,
        cancelAtPeriodEnd: Boolean(data?.cancel_at_next_billing_date),
        occurredAt,
        metadata: {
            sendlitCheckoutAttemptId: metadataValue(
                data?.metadata,
                "sendlitCheckoutAttemptId",
            ),
            catalogKey: metadataValue(data?.metadata, "catalogKey"),
        },
    };
}

export class DodoBillingProvider implements BillingProviderAdapter {
    readonly provider = "dodo" as const;
    readonly capabilities = {
        planChanges: true,
        intervalChanges: true,
        // Plan changes are intentionally initiated by SendLit. Keep these
        // false even if a Dodo portal configuration later exposes them.
        portalPlanChanges: false,
        portalIntervalChanges: false,
        proratedPlanChanges: true,
    } as const;
    private readonly client: DodoPayments;
    private readonly webhookKeys: Array<{ version: string; key: string }>;

    constructor(env: NodeJS.ProcessEnv = process.env) {
        const token = env.DODO_PAYMENTS_API_KEY?.trim();
        if (!token) throw new Error("DODO_PAYMENTS_API_KEY_missing");
        const environment = env.DODO_PAYMENTS_ENVIRONMENT;
        if (environment !== "test_mode" && environment !== "live_mode") {
            throw new Error("DODO_PAYMENTS_ENVIRONMENT_invalid");
        }
        this.client = new DodoPayments({
            bearerToken: token,
            environment,
            timeout: 10_000,
            maxRetries: 0,
            webhookKey: env.DODO_PAYMENTS_WEBHOOK_KEY_CURRENT ?? null,
        });
        const current = env.DODO_PAYMENTS_WEBHOOK_KEY_CURRENT?.trim();
        if (!current)
            throw new Error("DODO_PAYMENTS_WEBHOOK_KEY_CURRENT_missing");
        this.webhookKeys = [{ version: "current", key: current }];
        const previous = env.DODO_PAYMENTS_WEBHOOK_KEY_PREVIOUS?.trim();
        const expires = env.DODO_PAYMENTS_WEBHOOK_KEY_PREVIOUS_EXPIRES_AT;
        if (previous && expires) {
            const expiry = new Date(expires);
            const max = Date.now() + 48 * 60 * 60 * 1000;
            if (
                !Number.isNaN(expiry.getTime()) &&
                expiry.getTime() > Date.now() &&
                expiry.getTime() <= max
            ) {
                this.webhookKeys.push({ version: "previous", key: previous });
            }
        }
    }

    async createCustomer(input: {
        email: string;
        name?: string | null;
        idempotencyKey: string;
    }): Promise<BillingCustomer> {
        try {
            const customer = await this.client.customers.create(
                { email: input.email, name: input.name || input.email },
                { idempotencyKey: input.idempotencyKey },
            );
            return {
                provider: this.provider,
                providerCustomerId: customer.customer_id,
            };
        } catch (error) {
            throw providerError(error);
        }
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
        try {
            const response = await this.client.checkoutSessions.create(
                {
                    product_cart: [
                        { product_id: input.productId, quantity: 1 },
                    ],
                    customer: { customer_id: input.customerId },
                    billing_currency: input.currency as any,
                    return_url: input.returnUrl,
                    cancel_url: input.cancelUrl,
                    metadata: {
                        sendlitCheckoutAttemptId: input.attemptId,
                        catalogKey: input.catalogKey,
                    },
                    subscription_data:
                        input.trialDays > 0
                            ? { trial_period_days: input.trialDays }
                            : undefined,
                },
                { idempotencyKey: input.idempotencyKey },
            );
            if (!response.checkout_url)
                throw new Error("provider_checkout_url_missing");
            return {
                provider: this.provider,
                providerCheckoutSessionId: response.session_id,
                checkoutUrl: response.checkout_url,
            };
        } catch (error) {
            throw providerError(error);
        }
    }

    async createPortalSession(input: {
        customerId: string;
        returnUrl: string;
    }): Promise<PortalSession> {
        try {
            const response = await this.client.customers.customerPortal.create(
                input.customerId,
                {
                    return_url: input.returnUrl,
                    send_email: false,
                },
            );
            return { provider: this.provider, portalUrl: response.link };
        } catch (error) {
            throw providerError(error);
        }
    }

    async changeSubscriptionPlan(
        input: SubscriptionPlanChangeInput,
    ): Promise<SubscriptionPlanChangeResult> {
        try {
            const response = await this.client.subscriptions.changePlan(
                input.providerSubscriptionId,
                {
                    product_id: input.targetProviderProductId,
                    quantity: 1,
                    effective_at: input.effectiveAt,
                    proration_billing_mode: input.prorationMode,
                    // A failed immediate charge must leave the current plan in
                    // place; entitlements are only changed by the webhook.
                    on_payment_failure: "prevent_change",
                },
                { idempotencyKey: input.idempotencyKey },
            );
            return {
                provider: this.provider,
                providerPaymentId: response.payment_id ?? null,
                paymentUrl: response.payment_link ?? null,
            };
        } catch (error) {
            throw providerError(error);
        }
    }

    private async withReadRetry<T>(fn: () => Promise<T>): Promise<T> {
        let lastError: unknown;
        for (let attempt = 0; attempt < 3; attempt += 1) {
            try {
                return await fn();
            } catch (error) {
                lastError = error;
                const mapped = providerError(error);
                if (
                    mapped.code !== "unavailable" &&
                    mapped.code !== "rate_limited"
                ) {
                    throw mapped;
                }
                await new Promise((resolve) =>
                    setTimeout(
                        resolve,
                        100 * 2 ** attempt + Math.random() * 50,
                    ),
                );
            }
        }
        throw providerError(lastError);
    }

    async retrieveProduct(id: string): Promise<BillingProductSnapshot> {
        try {
            const product: any = await this.withReadRetry(() =>
                this.client.products.retrieve(id),
            );
            const price: any = product.price;
            if (!price || price.type !== "recurring_price")
                throw new Error("provider_product_not_recurring");
            // Dodo exposes both the recurring payment cadence and the overall
            // subscription term. The plan interval is the cadence customers
            // are charged on; a product may bill monthly while its term is
            // configured as a longer period.
            const interval = String(
                price.payment_frequency_interval ??
                    price.subscription_period_interval,
            ).toLowerCase();
            if (interval !== "month" && interval !== "year")
                throw new Error("provider_product_interval_invalid");
            const amountMinor = Number(price.price);
            if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0)
                throw new Error("provider_product_amount_invalid");
            return {
                provider: this.provider,
                providerProductId: product.product_id,
                currency: String(price.currency).toUpperCase(),
                amountMinor,
                interval,
            };
        } catch (error) {
            if (error instanceof BillingProviderError) throw error;
            if (
                error instanceof Error &&
                error.message.startsWith("provider_product_")
            ) {
                throw new BillingProviderError("invalid", error.message, error);
            }
            throw providerError(error);
        }
    }

    async retrieveSubscription(id: string): Promise<SubscriptionSnapshot> {
        try {
            const subscription: any = await this.withReadRetry(() =>
                this.client.subscriptions.retrieve(id),
            );
            return normalizeSubscription(
                subscription,
                "subscription.updated",
                new Date(),
            );
        } catch (error) {
            throw providerError(error);
        }
    }

    async cancelSubscription(
        id: string,
        idempotencyKey: string,
    ): Promise<void> {
        try {
            await this.client.subscriptions.update(
                id,
                {
                    status: "cancelled",
                    cancel_at_next_billing_date: false,
                    cancel_reason: "cancelled_by_merchant",
                },
                { idempotencyKey },
            );
        } catch (error) {
            throw providerError(error);
        }
    }

    async parseWebhook(
        input: RawWebhookRequest,
    ): Promise<CanonicalBillingEvent> {
        const eventId =
            input.headers["webhook-id"] ?? input.headers["Webhook-Id"];
        if (!eventId) throw new Error("webhook_id_missing");
        let event: any;
        let verifiedVersion: string | undefined;
        for (const candidate of this.webhookKeys) {
            try {
                event = this.client.webhooks.unwrap(input.body, {
                    headers: input.headers,
                    key: candidate.key,
                });
                verifiedVersion = candidate.version;
                break;
            } catch {
                // Try the rotation key, if it is still within its bounded window.
            }
        }
        if (!event || !verifiedVersion)
            throw new Error("webhook_signature_invalid");
        const occurredAt = dateOrNull(event.timestamp);
        if (!occurredAt) throw new Error("webhook_timestamp_missing");
        // `client.webhooks.unwrap` verifies the Standard Webhooks delivery
        // timestamp against Dodo's replay window. The provider event's own
        // timestamp describes when the subscription changed and can be much
        // older on delayed/retried deliveries, so it must not be used as a
        // second freshness gate.
        const isSubscription = String(event.type).startsWith("subscription.");
        const snapshot = isSubscription
            ? normalizeSubscription(event.data, event.type, occurredAt)
            : undefined;
        return {
            provider: this.provider,
            providerEventId: eventId,
            eventType: String(event.type),
            occurredAt,
            subscriptionId: snapshot?.providerSubscriptionId,
            snapshot,
            rawPayload: { ...event, _verifiedKeyVersion: verifiedVersion },
        };
    }
}
