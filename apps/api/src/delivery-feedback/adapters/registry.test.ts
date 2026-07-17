import { describe, expect, it } from "vitest";
import { feedbackCapableProviders } from "../../config/constants";
import { getProviderAdapter } from "./registry";

describe("provider adapter registry", () => {
    it("registers an adapter for every feedback-capable provider", () => {
        for (const provider of feedbackCapableProviders) {
            expect(getProviderAdapter(provider)?.provider).toBe(provider);
        }
    });

    it("returns null for unsupported providers", () => {
        expect(getProviderAdapter("ses")).toBeNull();
        expect(getProviderAdapter("smtp")).toBeNull();
    });
});
