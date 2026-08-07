import type { AddressInfo } from "node:net";
import express, { Router } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    createDiscoveryRoutes: vi.fn(),
}));

vi.mock("../auth/better-auth", () => ({
    auth: {
        options: { baseURL: "http://localhost:5000", basePath: "/api/auth" },
    },
    mcpResourceUrl: "http://localhost:5000/mcp",
    oauthResourceClient: {},
}));
vi.mock("@codelitdev/oauth-server-kit/mcp", () => ({
    createMcpOAuthDiscoveryRoutes: mocks.createDiscoveryRoutes,
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

describe("MCP OAuth discovery integration", () => {
    beforeEach(() => {
        vi.resetModules();
        mocks.createDiscoveryRoutes.mockReset();
        mocks.createDiscoveryRoutes.mockImplementation(() => {
            const router = Router();
            router.get(
                "/.well-known/oauth-protected-resource/mcp",
                (_req, res) =>
                    res.json({ resource: "http://localhost:5000/mcp" }),
            );
            return router;
        });
    });

    async function request(app: express.Express, path: string) {
        const server = app.listen(0, "127.0.0.1");
        try {
            await new Promise<void>((resolve) =>
                server.once("listening", resolve),
            );
            const { port } = server.address() as AddressInfo;
            const response = await fetch(`http://127.0.0.1:${port}${path}`);
            return { status: response.status, json: () => response.json() };
        } finally {
            await new Promise<void>((resolve, reject) =>
                server.close((error) => (error ? reject(error) : resolve())),
            );
        }
    }

    it("mounts the shared discovery router with SendLit MCP scopes", async () => {
        const routes = ((await import("./routes.js")) as any).default;
        const app = express();
        app.use(routes);

        const response = await request(
            app,
            "/.well-known/oauth-protected-resource/mcp",
        );

        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toEqual({
            resource: "http://localhost:5000/mcp",
        });
        expect(mocks.createDiscoveryRoutes).toHaveBeenCalledWith(
            expect.objectContaining({
                resourceUrl: "http://localhost:5000/mcp",
                allowedOrigins: "*",
                scopesSupported: expect.arrayContaining([
                    "contacts:read",
                    "templates:write",
                    "sequences:write",
                ]),
            }),
        );
    });
});
