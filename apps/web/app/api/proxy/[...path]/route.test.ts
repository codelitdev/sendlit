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

    it("marks missing-session requests as session expired", async () => {
        const { GET } = await import("./route");

        const res = await GET(request(), params(["contacts"]));

        expect(res.status).toBe(401);
        expect(res.headers.get("X-Auth-Error")).toBe("session_expired");
        await expect(res.json()).resolves.toEqual({ error: "unauthorized" });
        expect(mocks.fetch).not.toHaveBeenCalled();
    });

    it("forwards Better Auth session cookies upstream", async () => {
        mocks.fetch.mockResolvedValue(
            new Response(JSON.stringify({ items: [] }), {
                status: 200,
                headers: { "Content-Type": "application/json" },
            }),
        );
        const { GET } = await import("./route");

        const res = await GET(
            request("better-auth.session_token=signed-session"),
            params(["contacts"]),
        );

        expect(res.status).toBe(200);
        expect(mocks.fetch).toHaveBeenCalledWith(
            "http://localhost:4000/contacts",
            expect.objectContaining({
                headers: expect.objectContaining({
                    Cookie: "better-auth.session_token=signed-session",
                }),
            }),
        );
    });
});
