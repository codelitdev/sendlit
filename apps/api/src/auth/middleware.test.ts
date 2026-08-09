import { describe, expect, it, vi } from "vitest";

vi.mock("./better-auth", () => ({
    mcpProtectedResourceMetadataUrl:
        "https://sendlit.test/.well-known/oauth-protected-resource/mcp",
}));
vi.mock("./resolve-auth", () => ({
    resolveAuth: vi.fn(),
    sendAuthError: vi.fn(() => false),
}));

import { createAuthMiddleware } from "./middleware";

function responseDouble() {
    const response: any = {
        statusCode: 200,
        headers: {} as Record<string, string>,
        body: undefined as unknown,
        setHeader(name: string, value: string) {
            this.headers[name] = value;
        },
        status(code: number) {
            this.statusCode = code;
            return this;
        },
        json(body: unknown) {
            this.body = body;
            return this;
        },
    };
    return response;
}

describe("MCP auth middleware", () => {
    it("rejects browser sessions", async () => {
        const resolver = vi.fn(async () => ({
            status: "authenticated" as const,
            kind: "session" as const,
            identity: { method: "session" as const },
            user: { id: "user-1" },
            userId: "user-1",
            scopes: ["web"] as ["web"],
        }));
        const middleware = createAuthMiddleware(
            "mcp",
            resolver as any,
            "https://sendlit.test/.well-known/oauth-protected-resource/mcp",
        );
        const req: any = { headers: {}, body: undefined };
        const res = responseDouble();
        const next = vi.fn();

        await middleware(req, res, next);

        expect(res.statusCode).toBe(401);
        expect(res.headers["WWW-Authenticate"]).toContain(
            "oauth-protected-resource/mcp",
        );
        expect(next).not.toHaveBeenCalled();
        expect(req.auth).toBeUndefined();
    });

    it("retains stable non-secret identity for team API keys", async () => {
        const resolver = vi.fn(async () => ({
            status: "authenticated" as const,
            kind: "team_key" as const,
            user: null,
            apiKeyId: "tak_public",
            teamId: "team-1",
        }));
        const middleware = createAuthMiddleware("mcp", resolver as any);
        const req: any = {
            headers: { "x-sendlit-apikey": "sl_live_secret" },
            body: undefined,
        };
        const res = responseDouble();
        const next = vi.fn();

        await middleware(req, res, next);

        expect(next).toHaveBeenCalledOnce();
        expect(req).toMatchObject({
            authKind: "team_key",
            apiKeyId: "tak_public",
            teamId: "team-1",
        });
        const { headers: _headers, body: _body, ...authState } = req;
        expect(JSON.stringify(authState)).not.toContain("sl_live_secret");
    });
});
