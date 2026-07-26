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

    it("resolves relative paths against WEB_CLIENT", async () => {
        const { safeAppRedirect } = await loadWithWebClient(
            "https://app.sendlit.clqa.site",
        );

        expect(safeAppRedirect("/teams").toString()).toBe(
            "https://app.sendlit.clqa.site/teams",
        );
        expect(safeAppRedirect("/contacts?from=team").toString()).toBe(
            "https://app.sendlit.clqa.site/contacts?from=team",
        );
    });

    it("allows absolute URLs on the same public origin", async () => {
        const { safeAppRedirect } = await loadWithWebClient(
            "https://app.sendlit.example",
        );

        expect(
            safeAppRedirect("https://app.sendlit.example/settings").toString(),
        ).toBe("https://app.sendlit.example/settings");
    });

    it.each([
        "https://attacker.example/steal",
        "//attacker.example/steal",
        "https://app.sendlit.evil/teams",
    ])("rejects external redirect target %s", async (redirectTo) => {
        const { safeAppRedirect } = await loadWithWebClient(
            "https://app.sendlit.example",
        );

        expect(safeAppRedirect(redirectTo).toString()).toBe(
            "https://app.sendlit.example/",
        );
    });

    it("falls back to home for empty or invalid targets", async () => {
        const { safeAppRedirect } = await loadWithWebClient(
            "http://localhost:3000",
        );

        expect(safeAppRedirect("").toString()).toBe("http://localhost:3000/");
        expect(safeAppRedirect("not a url").toString()).toBe(
            "http://localhost:3000/",
        );
    });
});
