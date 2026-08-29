import { describe, expect, it, vi } from "vitest";

vi.mock("dodopayments", () => ({
    default: class FakeDodoClient {
        webhooks = {
            unwrap(body: string) {
                return JSON.parse(body);
            },
        };
    },
}));

import { DodoBillingProvider } from "./index";

describe("Dodo webhook parsing", () => {
    it("accepts a valid delivery whose provider event timestamp is delayed", async () => {
        const provider = new DodoBillingProvider({
            DODO_PAYMENTS_API_KEY: "test-token",
            DODO_PAYMENTS_WEBHOOK_KEY_CURRENT: "whsec_test",
            DODO_PAYMENTS_ENVIRONMENT: "test_mode",
        });
        const event = await provider.parseWebhook({
            body: JSON.stringify({
                type: "subscription.updated",
                // Provider event timestamps can be delayed on retry. The
                // Standard Webhooks delivery timestamp is verified by unwrap.
                timestamp: "2026-08-28T00:00:00.000Z",
                data: {
                    subscription_id: "sub_test",
                    status: "active",
                    product_id: "pdt_test",
                },
            }),
            headers: {
                "webhook-id": "msg_test",
                "webhook-timestamp": String(Math.floor(Date.now() / 1000)),
                "webhook-signature": "v1,verified",
            },
        });
        expect(event.subscriptionId).toBe("sub_test");
        expect(event.occurredAt.toISOString()).toBe("2026-08-28T00:00:00.000Z");
    });
});
