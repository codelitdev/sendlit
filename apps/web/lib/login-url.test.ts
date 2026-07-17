import { describe, expect, it } from "vitest";
import { getDashboardLoginUrl } from "./login-url";

describe("application login redirect", () => {
    it("uses the public API URL for browser redirects", () => {
        expect(
            getDashboardLoginUrl({
                apiPublicUrl: "https://api.sendlit.com",
                webClient: "https://app.sendlit.com",
            }),
        ).toBe(
            "https://api.sendlit.com/login?redirect=https%3A%2F%2Fapp.sendlit.com%2F",
        );
    });
});
