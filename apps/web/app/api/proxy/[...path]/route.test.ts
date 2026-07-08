import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
    fetch: vi.fn(),
}));

vi.stubGlobal("fetch", mocks.fetch);

function request(cookie?: string) {
    return new NextRequest("http://localhost/api/proxy/contacts", {
        headers: cookie ? { cookie } : undefined,
    });
}

function params(path: string[]) {
    return { params: Promise.resolve({ path }) };
}

describe("BFF proxy auth failures", () => {
    beforeEach(() => {
        mocks.fetch.mockReset();
    });

    it("marks upstream 401 responses as session expired", async () => {
        mocks.fetch.mockResolvedValue(
            new Response(JSON.stringify({ error: "unauthorized" }), {
                status: 401,
                headers: { "Content-Type": "application/json" },
            }),
        );
        const { GET } = await import("./route");

        const res = await GET(request(), params(["contacts"]));

        expect(res.status).toBe(401);
        expect(res.headers.get("X-Auth-Error")).toBe("session_expired");
        await expect(res.json()).resolves.toEqual({ error: "unauthorized" });
        expect(mocks.fetch).toHaveBeenCalledWith(
            "http://localhost:4000/contacts",
            expect.objectContaining({
                headers: expect.not.objectContaining({
                    Cookie: expect.any(String),
                }),
            }),
        );
    });

    it("forwards session cookies upstream without parsing them", async () => {
        mocks.fetch.mockResolvedValue(
            new Response(JSON.stringify({ items: [] }), {
                status: 200,
                headers: { "Content-Type": "application/json" },
            }),
        );
        const { GET } = await import("./route");

        const res = await GET(
            request("opaque_session_cookie=signed-session"),
            params(["contacts"]),
        );

        expect(res.status).toBe(200);
        expect(mocks.fetch).toHaveBeenCalledWith(
            "http://localhost:4000/contacts",
            expect.objectContaining({
                headers: expect.objectContaining({
                    Cookie: "opaque_session_cookie=signed-session",
                }),
            }),
        );
    });

    it("forwards secure-prefixed cookies upstream without parsing them", async () => {
        mocks.fetch.mockResolvedValue(
            new Response(JSON.stringify({ items: [] }), {
                status: 200,
                headers: { "Content-Type": "application/json" },
            }),
        );
        const { GET } = await import("./route");

        const res = await GET(
            request("__Secure-opaque_session_cookie=signed-session"),
            params(["contacts"]),
        );

        expect(res.status).toBe(200);
        expect(mocks.fetch).toHaveBeenCalledWith(
            "http://localhost:4000/contacts",
            expect.objectContaining({
                headers: expect.objectContaining({
                    Cookie: "__Secure-opaque_session_cookie=signed-session",
                }),
            }),
        );
    });
});
