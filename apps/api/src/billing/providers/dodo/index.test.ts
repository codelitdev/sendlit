import { describe, expect, it } from "vitest";
import { dodoOptionsFromEnv } from "./index";

describe("SendLit Dodo env mapping", () => {
    it("maps current and unexpired previous webhook keys", () => {
        const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
        const options = dodoOptionsFromEnv({
            DODO_PAYMENTS_API_KEY: "test-token",
            DODO_PAYMENTS_ENVIRONMENT: "test_mode",
            DODO_PAYMENTS_WEBHOOK_KEY_CURRENT: "whsec_current",
            DODO_PAYMENTS_WEBHOOK_KEY_PREVIOUS: "whsec_previous",
            DODO_PAYMENTS_WEBHOOK_KEY_PREVIOUS_EXPIRES_AT:
                expiresAt.toISOString(),
        });
        expect(options.apiKey).toBe("test-token");
        expect(options.environment).toBe("test_mode");
        expect(options.webhookSecrets.map((row) => row.version)).toEqual([
            "current",
            "previous",
        ]);
        expect(options.webhookSecrets[1]?.expiresAt?.toISOString()).toBe(
            expiresAt.toISOString(),
        );
    });

    it("does not include an expired previous key", () => {
        const options = dodoOptionsFromEnv({
            DODO_PAYMENTS_API_KEY: "test-token",
            DODO_PAYMENTS_ENVIRONMENT: "live_mode",
            DODO_PAYMENTS_WEBHOOK_KEY_CURRENT: "whsec_current",
            DODO_PAYMENTS_WEBHOOK_KEY_PREVIOUS: "whsec_previous",
            DODO_PAYMENTS_WEBHOOK_KEY_PREVIOUS_EXPIRES_AT: new Date(
                Date.now() - 1000,
            ).toISOString(),
        });
        expect(options.environment).toBe("live_mode");
        expect(options.webhookSecrets).toHaveLength(1);
        expect(options.webhookSecrets[0]?.secret).toBe("whsec_current");
    });
});
