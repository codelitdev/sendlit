/**
 * Provider-neutral billing contract. Adapter implementations live in
 * `@codelitdev/billing`; SendLit only composes them with env, org policy,
 * and persistence.
 */
export {
    BillingProviderError,
    providerErrorSummary,
    type SubscriptionSnapshot,
    type VerifiedWebhookEnvelope,
} from "@codelitdev/billing/core";
export {
    type BillingProviderAdapter,
    type BillingProductSnapshot,
    type BillingCustomer,
    type Checkout,
    type PortalSession,
    type RawWebhookRequest,
    type SubscriptionPlanChangeInput,
    type SubscriptionPlanChangeResult,
} from "@codelitdev/billing/providers";

export type BillingProviderId = "dodo" | "fake" | (string & {});

/** Durable webhook evidence plus an optional retrieved snapshot used by
 * SendLit projection. The snapshot is never treated as part of the envelope. */
export type CanonicalBillingEvent =
    import("@codelitdev/billing/core").VerifiedWebhookEnvelope & {
        snapshot?:
            import("@codelitdev/billing/core").SubscriptionSnapshot | null;
        rawPayload?: unknown;
    };
