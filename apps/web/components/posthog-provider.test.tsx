// @vitest-environment jsdom

import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";

const mocks = vi.hoisted(() => ({
    initPosthogBrowser: vi.fn().mockResolvedValue(null),
    identifyPosthogUserFromSession: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/posthog-browser", () => ({
    initPosthogBrowser: mocks.initPosthogBrowser,
    identifyPosthogUserFromSession: mocks.identifyPosthogUserFromSession,
}));

import { PostHogProvider } from "./posthog-provider";

describe("PostHogProvider", () => {
    afterEach(() => {
        cleanup();
        mocks.initPosthogBrowser.mockReset();
        mocks.identifyPosthogUserFromSession.mockReset();
        mocks.initPosthogBrowser.mockResolvedValue(null);
        mocks.identifyPosthogUserFromSession.mockResolvedValue(undefined);
    });

    it("initializes and identifies when a key is provided", async () => {
        render(
            <PostHogProvider
                apiKey="phc_test"
                host="https://eu.i.posthog.com"
                environment="production"
            >
                <div>child</div>
            </PostHogProvider>,
        );

        await waitFor(() => {
            expect(mocks.initPosthogBrowser).toHaveBeenCalledWith({
                apiKey: "phc_test",
                host: "https://eu.i.posthog.com",
                environment: "production",
            });
            expect(mocks.identifyPosthogUserFromSession).toHaveBeenCalled();
        });
    });
});
