import { afterEach, describe, expect, it } from "bun:test";
import { stubEnv, unstubAllEnvs } from "@sendlit/test-utils";
import { resetAppModules } from "./test/reset-modules";

describe("safeAppRedirect", () => {
  afterEach(() => {
    unstubAllEnvs();
    resetAppModules();
  });

  async function loadWithWebClient(webClient: string) {
    stubEnv("WEB_CLIENT", webClient);
    resetAppModules();
    return import("./safe-app-redirect");
  }

  it("keeps relative paths relative so the browser stays on its origin", async () => {
    const { safeAppRedirect } = await loadWithWebClient(
      "https://app.sendlit.clqa.site",
    );

    expect(safeAppRedirect("/team-selection")).toBe("/team-selection");
    expect(safeAppRedirect("/contacts?from=team")).toBe("/contacts?from=team");
  });

  it("collapses same-origin absolute URLs to a path", async () => {
    const { safeAppRedirect } = await loadWithWebClient("https://app.sendlit.example");

    expect(safeAppRedirect("https://app.sendlit.example/settings")).toBe("/settings");
  });

  it.each([
    "https://attacker.example/steal",
    "//attacker.example/steal",
    "https://app.sendlit.evil/teams",
  ])("rejects external redirect target %s", async (redirectTo) => {
    const { safeAppRedirect } = await loadWithWebClient("https://app.sendlit.example");

    expect(safeAppRedirect(redirectTo)).toBe("/");
  });

  it("falls back to home for empty or invalid targets", async () => {
    const { safeAppRedirect } = await loadWithWebClient("http://localhost:3000");

    expect(safeAppRedirect("")).toBe("/");
    expect(safeAppRedirect("not a url")).toBe("/");
  });
});
