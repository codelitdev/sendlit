import { systemClock, type Clock } from "@codelitdev/billing/core";
import {
    createDodoBillingProvider,
    DodoBillingProvider,
} from "@codelitdev/billing/providers/dodo";
import type { DodoBillingProviderOptions } from "@codelitdev/billing/providers";

export { createDodoBillingProvider, DodoBillingProvider };

/** Parse SendLit process env into the package's explicit Dodo options.
 * The package never reads process.env itself. */
export function dodoOptionsFromEnv(
    env: NodeJS.ProcessEnv = process.env,
    clock: Clock = systemClock,
): DodoBillingProviderOptions {
    const apiKey = env.DODO_PAYMENTS_API_KEY?.trim() ?? "";
    const environment = env.DODO_PAYMENTS_ENVIRONMENT;
    const current = env.DODO_PAYMENTS_WEBHOOK_KEY_CURRENT?.trim() ?? "";
    const webhookSecrets: DodoBillingProviderOptions["webhookSecrets"] = [
        { version: "current", secret: current },
    ];
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
            webhookSecrets.push({
                version: "previous",
                secret: previous,
                expiresAt: expiry,
            });
        }
    }
    return {
        apiKey,
        environment:
            environment === "live_mode" || environment === "test_mode"
                ? environment
                : "test_mode",
        webhookSecrets,
        clock,
    };
}

export function createSendLitDodoProvider(
    env: NodeJS.ProcessEnv = process.env,
    clock: Clock = systemClock,
): DodoBillingProvider {
    return createDodoBillingProvider(dodoOptionsFromEnv(env, clock));
}
