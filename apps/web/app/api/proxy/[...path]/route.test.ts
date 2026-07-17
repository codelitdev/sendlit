import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
    fetch: vi.fn(),
}));

vi.stubGlobal("fetch", mocks.fetch);

function request(
    cookie?: string,
    init?: { method?: string; headers?: HeadersInit; body?: BodyInit | null },
) {
    return new NextRequest("http://localhost/api/proxy/contacts?offset=10", {
        ...init,
        headers: {
            ...(cookie ? { cookie } : {}),
            ...Object.fromEntries(new Headers(init?.headers).entries()),
        },
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
            "http://localhost:5000/contacts?offset=10",
            expect.objectContaining({
                headers: expect.not.objectContaining({
                    Cookie: expect.any(String),
                }),
            }),
        );
    });

    it("forwards session cookies upstream without parsing them", async () => {
        mocks.fetch.mockImplementation(
            async () =>
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
            "http://localhost:5000/contacts?offset=10",
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
            "http://localhost:5000/contacts?offset=10",
            expect.objectContaining({
                headers: expect.objectContaining({
                    Cookie: "__Secure-opaque_session_cookie=signed-session",
                }),
            }),
        );
    });

    it("forwards the selected team to nested team-scoped routes", async () => {
        mocks.fetch.mockImplementation(
            async () =>
                new Response(JSON.stringify({ items: [] }), {
                    status: 200,
                    headers: { "Content-Type": "application/json" },
                }),
        );
        const { GET } = await import("./route");

        await GET(
            request("sendlit_team_id=team_123; session=opaque"),
            params(["contacts"]),
        );
        expect(mocks.fetch).toHaveBeenLastCalledWith(
            "http://localhost:5000/contacts?offset=10",
            expect.objectContaining({
                headers: expect.objectContaining({
                    "X-Sendlit-Team-Id": "team_123",
                }),
            }),
        );

        await GET(
            request("sendlit_team_id=team_123; session=opaque"),
            params(["teams"]),
        );
        expect(mocks.fetch).toHaveBeenLastCalledWith(
            "http://localhost:5000/teams?offset=10",
            expect.objectContaining({
                headers: expect.not.objectContaining({
                    "X-Sendlit-Team-Id": expect.any(String),
                }),
            }),
        );

        await GET(
            request("sendlit_team_id=team_123; session=opaque"),
            params(["teams", "team_456", "keys"]),
        );
        expect(mocks.fetch).toHaveBeenLastCalledWith(
            "http://localhost:5000/teams/team_456/keys?offset=10",
            expect.objectContaining({
                headers: expect.objectContaining({
                    "X-Sendlit-Team-Id": "team_123",
                }),
            }),
        );
    });

    it("preserves method, JSON body, and forwarded client address", async () => {
        mocks.fetch.mockResolvedValue(
            new Response(JSON.stringify({ contactId: "cnt_123" }), {
                status: 201,
                headers: { "Content-Type": "application/json" },
            }),
        );
        const { POST } = await import("./route");

        const response = await POST(
            request("sendlit_team_id=team_123", {
                method: "POST",
                headers: { "x-forwarded-for": "203.0.113.7" },
                body: JSON.stringify({ email: "reader@example.com" }),
            }),
            params(["contacts"]),
        );

        expect(response.status).toBe(201);
        expect(mocks.fetch).toHaveBeenCalledWith(
            "http://localhost:5000/contacts?offset=10",
            expect.objectContaining({
                method: "POST",
                body: JSON.stringify({ email: "reader@example.com" }),
                headers: expect.objectContaining({
                    "Content-Type": "application/json",
                    "X-Forwarded-For": "203.0.113.7",
                }),
            }),
        );
    });

    it("returns a null body for upstream no-content responses", async () => {
        mocks.fetch.mockResolvedValue(new Response(null, { status: 204 }));
        const { DELETE } = await import("./route");

        const response = await DELETE(
            request("sendlit_team_id=team_123", { method: "DELETE" }),
            params(["contacts", "cnt_123"]),
        );

        expect(response.status).toBe(204);
        expect(await response.text()).toBe("");
    });
});
