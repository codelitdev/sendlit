import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

function request(fields: Record<string, string>, url?: string) {
    const body = new URLSearchParams(fields);
    return new NextRequest(url ?? "http://localhost:3000/api/team/switch", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body,
    });
}

describe("team switch", () => {
    beforeEach(() => {
        vi.unstubAllEnvs();
        vi.resetModules();
    });

    it("sets the selected team and redirects within the application", async () => {
        const { POST } = await import("./route");
        const response = await POST(
            request({ teamId: "team_123", redirectTo: "/contacts?from=team" }),
        );

        expect(response.status).toBe(303);
        expect(response.headers.get("location")).toBe(
            "http://localhost:3000/contacts?from=team",
        );
        expect(response.headers.get("set-cookie")).toContain(
            "sendlit_team_id=team_123",
        );
        expect(response.headers.get("set-cookie")).toContain("SameSite=lax");
        expect(response.headers.get("set-cookie")).not.toContain("HttpOnly");
    });

    it("redirects using WEB_CLIENT even when req.url is the container bind address", async () => {
        vi.stubEnv("WEB_CLIENT", "https://app.sendlit.clqa.site");
        vi.resetModules();
        const { POST } = await import("./route");
        const response = await POST(
            request(
                { teamId: "team_123", redirectTo: "/teams" },
                "http://0.0.0.0:3000/api/team/switch",
            ),
        );

        expect(response.headers.get("location")).toBe(
            "https://app.sendlit.clqa.site/teams",
        );
    });

    it.each(["https://attacker.example/steal", "//attacker.example/steal"])(
        "rejects an external redirect target: %s",
        async (redirectTo) => {
            const { POST } = await import("./route");
            const response = await POST(
                request({ teamId: "team_123", redirectTo }),
            );

            expect(response.headers.get("location")).toBe(
                "http://localhost:3000/",
            );
        },
    );

    it("does not set an empty team selection", async () => {
        const { POST } = await import("./route");
        const response = await POST(request({ teamId: "", redirectTo: "/" }));

        expect(response.headers.get("set-cookie")).toBeNull();
    });

    it("marks the selection cookie secure in production", async () => {
        vi.stubEnv("NODE_ENV", "production");
        const { POST } = await import("./route");
        const response = await POST(
            request({ teamId: "team_123", redirectTo: "/" }),
        );

        expect(response.headers.get("set-cookie")).toContain("Secure");
    });
});
