import express from "express";
import { IncomingMessage, ServerResponse } from "http";
import { Socket } from "net";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    getProtectedResourceMetadata: vi.fn(),
    oauthProviderAuthServerMetadata: vi.fn(),
    oauthProviderOpenIdConfigMetadata: vi.fn(),
}));

vi.mock("../auth/better-auth", () => ({
    auth: {},
    mcpResourceUrl: "http://localhost:4000/mcp",
    oauthResourceClient: {
        getActions: vi.fn(() => ({
            getProtectedResourceMetadata: mocks.getProtectedResourceMetadata,
        })),
    },
}));

vi.mock("@better-auth/oauth-provider", () => ({
    oauthProviderAuthServerMetadata: mocks.oauthProviderAuthServerMetadata,
    oauthProviderOpenIdConfigMetadata: mocks.oauthProviderOpenIdConfigMetadata,
}));

vi.mock("../auth/middleware", () => ({
    mcpAuth: vi.fn((_req, _res, next) => next()),
}));
vi.mock("../auth/require-team", () => ({
    requireTeam: vi.fn((_req, _res, next) => next()),
}));
vi.mock("./server.js", () => ({
    createMCPSession: vi.fn(),
}));

describe("MCP OAuth metadata", () => {
    let app: express.Express;

    beforeEach(async () => {
        vi.resetModules();
        mocks.getProtectedResourceMetadata.mockReset();
        mocks.oauthProviderAuthServerMetadata.mockReset();
        mocks.oauthProviderOpenIdConfigMetadata.mockReset();

        const mcpRoutes = ((await import("./routes.js")) as any).default;
        app = express();
        app.use(mcpRoutes);
    });

    async function request(path: string) {
        const req = new IncomingMessage(new Socket());
        req.method = "GET";
        req.url = path;
        req.headers = { host: "localhost:4000" };

        const res = new ServerResponse(req);
        const chunks: Buffer[] = [];

        const done = new Promise<{
            status: number;
            headers: ReturnType<ServerResponse["getHeaders"]>;
            body: string;
        }>((resolve) => {
            res.write = ((chunk: any, ...args: any[]) => {
                if (chunk) chunks.push(Buffer.from(chunk));
                const cb = args.find((arg) => typeof arg === "function");
                cb?.();
                return true;
            }) as typeof res.write;
            res.end = ((chunk: any, ...args: any[]) => {
                if (chunk) chunks.push(Buffer.from(chunk));
                const cb = args.find((arg) => typeof arg === "function");
                cb?.();
                resolve({
                    status: res.statusCode,
                    headers: res.getHeaders(),
                    body: Buffer.concat(chunks).toString("utf8"),
                });
                return res;
            }) as typeof res.end;
        });

        (app as any).handle(req, res);
        return done;
    }

    it("serves OAuth protected-resource metadata for MCP clients", async () => {
        mocks.getProtectedResourceMetadata.mockResolvedValue({
            resource: "http://localhost:4000/mcp",
            authorization_servers: ["http://localhost:4000"],
            scopes_supported: ["contacts:read"],
            bearer_methods_supported: ["header"],
        });

        const res = await request("/.well-known/oauth-protected-resource");

        expect(res.status).toBe(200);
        expect(JSON.parse(res.body)).toMatchObject({
            resource: "http://localhost:4000/mcp",
            scopes_supported: ["contacts:read"],
        });
        expect(mocks.getProtectedResourceMetadata).toHaveBeenCalledWith(
            expect.objectContaining({
                resource: "http://localhost:4000/mcp",
                bearer_methods_supported: ["header"],
            }),
            { silenceWarnings: { oidcScopes: true } },
        );
    });

    it("also serves protected-resource metadata at the RFC 9728 path derived from the resource's own pathname", async () => {
        // Without this, spec-compliant MCP clients (confirmed: VS Code) never
        // discover the resource metadata, never learn to request a
        // resource-bound token, and Better Auth mints an unverifiable opaque
        // token instead of a JWT.
        mocks.getProtectedResourceMetadata.mockResolvedValue({
            resource: "http://localhost:4000/mcp",
            authorization_servers: ["http://localhost:4000"],
            scopes_supported: ["contacts:read"],
            bearer_methods_supported: ["header"],
        });

        const res = await request("/.well-known/oauth-protected-resource/mcp");

        expect(res.status).toBe(200);
        expect(JSON.parse(res.body)).toMatchObject({
            resource: "http://localhost:4000/mcp",
        });
    });

    it("serves Better Auth authorization-server and OIDC metadata", async () => {
        mocks.oauthProviderAuthServerMetadata.mockReturnValue(
            vi.fn(async () =>
                Response.json({ issuer: "http://localhost:4000" }),
            ),
        );
        mocks.oauthProviderOpenIdConfigMetadata.mockReturnValue(
            vi.fn(async () =>
                Response.json({
                    issuer: "http://localhost:4000",
                    userinfo_endpoint:
                        "http://localhost:4000/api/auth/oauth2/userinfo",
                }),
            ),
        );

        const [authServer, oidc] = await Promise.all([
            request("/.well-known/oauth-authorization-server"),
            request("/.well-known/openid-configuration"),
        ]);

        expect(authServer.status).toBe(200);
        expect(JSON.parse(authServer.body)).toEqual({
            issuer: "http://localhost:4000",
        });
        expect(oidc.status).toBe(200);
        expect(JSON.parse(oidc.body)).toMatchObject({
            userinfo_endpoint: "http://localhost:4000/api/auth/oauth2/userinfo",
        });
        expect(mocks.oauthProviderAuthServerMetadata).toHaveBeenCalled();
        expect(mocks.oauthProviderOpenIdConfigMetadata).toHaveBeenCalled();
    });
});
