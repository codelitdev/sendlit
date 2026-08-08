import { describe, expect, it } from "vitest";
import { getDashboardLoginUrl } from "./login-url";

describe("application login redirect", () => {
    it("uses the public API URL for browser redirects", () => {
        expect(
            getDashboardLoginUrl({
                apiPublicUrl: "https://api.sendlit.app",
                webClient: "https://app.sendlit.app",
            }),
        ).toBe(
            "https://api.sendlit.app/login?redirect=https%3A%2F%2Fapp.sendlit.app%2F",
        );
    });
});
