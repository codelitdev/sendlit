import { afterEach, describe, expect, it } from "vitest";
import { getPosthogBrowserConfig } from "./config";

describe("getPosthogBrowserConfig", () => {
    const originalKey = process.env.POSTHOG_API_KEY;
    const originalHost = process.env.POSTHOG_HOST;
    const originalDeployEnv = process.env.DEPLOY_ENV;

    afterEach(() => {
        if (originalKey === undefined) {
            delete process.env.POSTHOG_API_KEY;
        } else {
            process.env.POSTHOG_API_KEY = originalKey;
        }
        if (originalHost === undefined) {
            delete process.env.POSTHOG_HOST;
        } else {
            process.env.POSTHOG_HOST = originalHost;
        }
        if (originalDeployEnv === undefined) {
            delete process.env.DEPLOY_ENV;
        } else {
            process.env.DEPLOY_ENV = originalDeployEnv;
        }
    });

    it("is disabled when POSTHOG_API_KEY is missing", () => {
        delete process.env.POSTHOG_API_KEY;
        delete process.env.POSTHOG_HOST;

        expect(getPosthogBrowserConfig()).toBeNull();
    });

    it("trims a present key and host for runtime injection", () => {
        process.env.POSTHOG_API_KEY = "  phc_test_key  ";
        process.env.POSTHOG_HOST = " https://eu.i.posthog.com ";
        process.env.DEPLOY_ENV = "production";

        expect(getPosthogBrowserConfig()).toEqual({
            apiKey: "phc_test_key",
            host: "https://eu.i.posthog.com",
            environment: "production",
        });
    });
});
