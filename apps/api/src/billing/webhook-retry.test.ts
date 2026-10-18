import { describe, expect, it } from "vitest";
import {
    BILLING_WEBHOOK_MAX_ATTEMPTS,
    billingWebhookRetry,
} from "./webhook-retry";

describe("billing webhook retry schedule", () => {
    it("uses the documented delays before quarantining on the eighth attempt", () => {
        expect(billingWebhookRetry(1)).toEqual({
            status: "failed",
            delayMs: 60 * 1000,
        });
        expect(billingWebhookRetry(2)).toEqual({
            status: "failed",
            delayMs: 5 * 60 * 1000,
        });
        expect(billingWebhookRetry(3)).toEqual({
            status: "failed",
            delayMs: 30 * 60 * 1000,
        });
        expect(billingWebhookRetry(4)).toEqual({
            status: "failed",
            delayMs: 2 * 60 * 60 * 1000,
        });
        expect(billingWebhookRetry(5, 0)).toEqual({
            status: "failed",
            delayMs: 8 * 60 * 60 * 1000,
        });
        expect(billingWebhookRetry(7, 12_000)).toEqual({
            status: "failed",
            delayMs: 8 * 60 * 60 * 1000 + 12_000,
        });
        expect(billingWebhookRetry(BILLING_WEBHOOK_MAX_ATTEMPTS)).toEqual({
            status: "quarantined",
        });
        expect(billingWebhookRetry(BILLING_WEBHOOK_MAX_ATTEMPTS + 1)).toEqual({
            status: "quarantined",
        });
    });
});
