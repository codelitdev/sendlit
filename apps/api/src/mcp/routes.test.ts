import { afterEach, beforeAll, describe, expect, it, mock, vi } from "bun:test";
import type { AddressInfo } from "node:net";
import { createMcpServerKit } from "@codelitdev/mcp-server-kit";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import express, { Router } from "express";
import { z } from "zod";

const mocks = {
  createDiscoveryRoutes: vi.fn(),
  resolveAuth: vi.fn(),
  resolveUserTeam: vi.fn(),
};

mock.module("../db/client", () => ({ db: {}, pool: {} }));
mock.module("../auth/better-auth", () => ({
  SESSION_COOKIE_NAME: "sendlit.session_token",
  auth: { options: { baseURL: "http://localhost:5000", basePath: "/api/auth" } },
  mcpResourceUrl: "http://localhost:5000/mcp",
  mcpProtectedResourceMetadataUrl:
    "http://localhost:5000/.well-known/oauth-protected-resource/mcp",
  oauthResourceClient: {},
}));
mock.module("@codelitdev/oauth-server-kit/mcp", () => ({
  createMcpOAuthDiscoveryRoutes: mocks.createDiscoveryRoutes,
}));
mock.module("../auth/resolve-auth", () => ({ resolveAuth: mocks.resolveAuth }));
mock.module("../auth/require-team", () => ({ resolveUserTeam: mocks.resolveUserTeam }));

const contexts: unknown[] = [];
mock.module("./server", async () => {
  const { authenticateMcpRequest, resolveMcpContext } = await import("./context");
  return {
    createSendLitMcp: () =>
      createMcpServerKit({
        name: "SendLit Test",
        version: "0.0.0",
        authenticate: authenticateMcpRequest,
        resolveContext: resolveMcpContext,
        tools: [
          {
            name: "whoami",
            description: "Echo the context",
            risk: "read",
            inputSchema: z.object({}),
            async handler({ context }) {
              contexts.push(context);
              const { teamId, authKind } = context as {
                teamId: string;
                authKind: string;
              };
              return { teamId, authKind };
            },
          },
        ],
      }),
  };
});

const teamKeyAuth = {
  status: "authenticated",
  kind: "team_key",
  user: null,
  apiKeyId: "key_1",
  teamId: "team-1",
};

let routes: Router;
const servers: Array<{ close(): void }> = [];
const clients: Client[] = [];

beforeAll(async () => {
  mocks.createDiscoveryRoutes.mockImplementation(() => {
    const router = Router();
    router.get("/.well-known/oauth-protected-resource/mcp", (_req, res) =>
      res.json({ resource: "http://localhost:5000/mcp" }),
    );
    return router;
  });
  const { createMcpRoutes } = await import("./routes");
  routes = createMcpRoutes();
});

afterEach(async () => {
  mocks.resolveAuth.mockReset();
  mocks.resolveUserTeam.mockReset();
  contexts.length = 0;
  await Promise.allSettled(clients.splice(0).map((client) => client.close()));
  for (const server of servers.splice(0)) server.close();
});

async function origin() {
  const app = express();
  app.use((_req, res, next) => {
    res.locals.requestId = "req-1";
    next();
  });
  app.use(routes);
  const server = app.listen(0, "127.0.0.1");
  servers.push(server);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

async function connect(base: string, headers: Record<string, string>) {
  const client = new Client(
    { name: "route-test", version: "1.0.0" },
    { versionNegotiation: { mode: { pin: "2026-07-28" } } },
  );
  clients.push(client);
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
      requestInit: { headers },
    }),
  );
  return client;
}

const listTools = (base: string, headers: Record<string, string>) =>
  fetch(`${base}/mcp`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...headers,
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
  });

describe("MCP route", () => {
  it("publishes protected-resource metadata with every enforced scope", async () => {
    const base = await origin();
    const response = await fetch(`${base}/.well-known/oauth-protected-resource/mcp`);
    expect(response.status).toBe(200);
    expect(mocks.createDiscoveryRoutes).toHaveBeenCalledWith(
      expect.objectContaining({
        resourceUrl: "http://localhost:5000/mcp",
        allowedOrigins: "*",
        scopesSupported: expect.arrayContaining(["contacts:read", "esp:write"]),
      }),
    );
  });

  it("serves a team key sent as x-sendlit-apikey, with the caller's IP and request id", async () => {
    mocks.resolveAuth.mockResolvedValue(teamKeyAuth);
    const base = await origin();
    const client = await connect(base, { "x-sendlit-apikey": "sl_live_key" });
    const result = await client.callTool({ name: "whoami", arguments: {} });
    expect(result.structuredContent).toEqual({
      teamId: "team-1",
      authKind: "team_key",
    });
    // The kit reads X-API-Key; SendLit's own header is aliased to it, and the
    // key reaches resolveAuth once (in the headers), or it is ambiguous.
    const [authInput] = mocks.resolveAuth.mock.calls[0] as [any];
    expect(authInput).toMatchObject({ transport: "mcp" });
    expect(authInput.headers["x-api-key"]).toBe("sl_live_key");
    expect(authInput.headers["x-sendlit-apikey"]).toBeUndefined();
    expect(authInput.apiKeyHeader).toBeUndefined();
    expect(contexts[0]).toMatchObject({ requestId: "req-1", scopes: [], user: null });
  });

  it("challenges a request without credentials so OAuth clients can discover the server", async () => {
    mocks.resolveAuth.mockResolvedValue({ status: "missing" });
    const response = await listTools(await origin(), {});
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toBe(
      'Bearer resource_metadata="http://localhost:5000/.well-known/oauth-protected-resource/mcp"',
    );
    expect((await response.json()).code).toBe("unauthenticated");
  });

  it("rejects an invalid token and two API-key headers at once", async () => {
    mocks.resolveAuth.mockResolvedValue({ status: "invalid_token" });
    const base = await origin();
    const invalid = await listTools(base, { authorization: "Bearer bad" });
    expect(invalid.status).toBe(401);
    expect(invalid.headers.get("www-authenticate")).toContain("resource_metadata=");

    const both = await listTools(base, { "x-sendlit-apikey": "a", "x-api-key": "b" });
    expect(both.status).toBe(400);
    expect((await both.json()).code).toBe("credential_ambiguous");
  });

  it("resolves an OAuth caller's team like REST and refuses organization keys", async () => {
    mocks.resolveAuth.mockResolvedValue({
      status: "authenticated",
      kind: "oauth",
      user: { id: "user-1" },
      userId: "user-1",
      token: "tok",
      clientId: "client",
      scopes: ["contacts:read"],
    });
    mocks.resolveUserTeam.mockResolvedValue({ ok: true, teamId: "team-9" });
    const base = await origin();
    const client = await connect(base, {
      authorization: "Bearer tok",
      "x-sendlit-team-id": "team_public",
    });
    const result = await client.callTool({ name: "whoami", arguments: {} });
    expect(result.structuredContent).toEqual({ teamId: "team-9", authKind: "oauth" });
    expect(mocks.resolveUserTeam).toHaveBeenCalledWith("user-1", "team_public");
    expect(contexts[0]).toMatchObject({
      scopes: ["contacts:read"],
      user: { id: "user-1" },
    });

    mocks.resolveUserTeam.mockResolvedValue({
      ok: false,
      status: 409,
      error: "team_required",
      body: {},
    });
    const ambiguousTeam = await listTools(base, { authorization: "Bearer tok" });
    expect(ambiguousTeam.status).toBe(400);
    expect(await ambiguousTeam.json()).toMatchObject({
      code: "tenant_required",
      details: { reason: "team_required" },
    });

    mocks.resolveAuth.mockResolvedValue({
      status: "authenticated",
      kind: "organization_key",
      user: null,
      organizationId: "org-1",
      organizationApiKeyId: "ok_1",
      organizationScopes: [],
    });
    const organizationKey = await listTools(base, {
      "x-sendlit-apikey": "sl_org_live_x",
    });
    expect(organizationKey.status).toBe(401);
  });

  it("answers CORS preflights with SendLit's headers, and refuses non-JSON and GET", async () => {
    const base = await origin();
    const preflight = await fetch(`${base}/mcp`, {
      method: "OPTIONS",
      headers: { origin: "https://client.example" },
    });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-origin")).toBe(
      "https://client.example",
    );
    expect(preflight.headers.get("access-control-allow-headers")).toContain(
      "x-sendlit-apikey",
    );

    const text = await fetch(`${base}/mcp`, {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: "{}",
    });
    expect(text.status).toBe(415);

    const malformed = await fetch(`${base}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{",
    });
    expect(malformed.status).toBe(400);
    expect((await malformed.json()).error.code).toBe(-32700);

    const get = await fetch(`${base}/mcp`);
    expect(get.status).toBe(405);
  });
});
