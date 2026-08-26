import { afterEach, describe, expect, it, vi } from "vitest";

describe("safeAppRedirect", () => {
    afterEach(() => {
        vi.unstubAllEnvs();
        vi.resetModules();
    });

    async function loadWithWebClient(webClient: string) {
        vi.stubEnv("WEB_CLIENT", webClient);
        vi.resetModules();
        return import("./safe-app-redirect");
    }

    it("keeps relative paths relative so the browser stays on its origin", async () => {
        const { safeAppRedirect } = await loadWithWebClient(
            "https://app.sendlit.clqa.site",
        );

        expect(safeAppRedirect("/team-selection")).toBe("/team-selection");
        expect(safeAppRedirect("/contacts?from=team")).toBe(
            "/contacts?from=team",
        );
    });

    it("collapses same-origin absolute URLs to a path", async () => {
        const { safeAppRedirect } = await loadWithWebClient(
            "https://app.sendlit.example",
        );

        expect(safeAppRedirect("https://app.sendlit.example/settings")).toBe(
            "/settings",
        );
    });

    it.each([
        "https://attacker.example/steal",
        "//attacker.example/steal",
        "https://app.sendlit.evil/teams",
    ])("rejects external redirect target %s", async (redirectTo) => {
        const { safeAppRedirect } = await loadWithWebClient(
            "https://app.sendlit.example",
        );

        expect(safeAppRedirect(redirectTo)).toBe("/");
    });

    it("falls back to home for empty or invalid targets", async () => {
        const { safeAppRedirect } = await loadWithWebClient(
            "http://localhost:3000",
        );

        expect(safeAppRedirect("")).toBe("/");
        expect(safeAppRedirect("not a url")).toBe("/");
    });
});
