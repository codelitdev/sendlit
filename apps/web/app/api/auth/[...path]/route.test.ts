import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
    fetch: vi.fn(),
}));

vi.stubGlobal("fetch", mocks.fetch);

describe("auth proxy sign-out", () => {
    beforeEach(() => {
        mocks.fetch.mockReset();
    });

    it("redirects successful sign-out requests to the web login page", async () => {
        mocks.fetch.mockResolvedValue(
            new Response(JSON.stringify({ success: true }), {
                status: 200,
                headers: {
                    "Content-Type": "application/json",
                    "Set-Cookie":
                        "better-auth.session_token=; Path=/; Max-Age=0",
                },
            }),
        );
        const { POST } = await import("./route");

        const response = await POST(
            new NextRequest("http://localhost:3000/api/auth/sign-out", {
                method: "POST",
                headers: {
                    cookie: "better-auth.session_token=opaque",
                    origin: "http://localhost:3000",
                },
            }),
            { params: Promise.resolve({ path: ["sign-out"] }) },
        );

        expect(response.status).toBe(303);
        expect(response.headers.get("location")).toBe(
            "http://localhost:3000/login",
        );
        expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
    });
});
