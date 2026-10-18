import { afterAll, beforeAll, describe, expect, it, mock } from "bun:test";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import {
  type McpDiscoveryAdapter,
  runMcpDiscoveryConformance,
} from "@codelitdev/platform-conformance";

/*
 * SendLit declares the auth and MCP capabilities in .codelit-platform.json.
 * Its domain is email, not the reference product's notes, so
 * `runPlatformConformance` does not apply. This file runs the product-neutral
 * MCP discovery suite against the real app, plus SendLit's checks of the
 * Platform kernel rules it adopts: health/readiness, request correlation,
 * and one credential per request. Billing, observability and lifecycle are
 * covered by their own tests.
 *
 * `bun run test:conformance` (the managed platform-conformance workflow) runs
 * the tests named "platform conformance".
 */

mock.module("./db/client", async () => {
  const { makeTestDb } = await import("./test/db");
  return {
    db: await makeTestDb(),
    pool: { query: async () => ({ rows: [] }), end: async () => {} },
    checkDatabaseConnection: async () => {},
  };
});
// Never open Redis connections from tests.
const queueStub = () => ({
  default: {
    add: async () => ({}),
    getJobCounts: async () => ({}),
    close: async () => {},
  },
});
mock.module("./mail/queue", () => ({
  ...queueStub(),
  addMailJob: async () => {},
  addTransactionalMailJob: async () => {},
}));
mock.module("./mail/sequence-queue", queueStub);
mock.module("./delivery-feedback/feedback-queue", () => ({
  ...queueStub(),
  enqueueReceiptForProcessing: async () => {},
}));
mock.module("./services/redis", () => ({ default: {} }));

let server: Server;
let origin: string;
let ready = false;

async function request(path: string, init: RequestInit = {}) {
  const response = await fetch(`${origin}${path}`, init);
  const text = await response.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: response.status, headers: response.headers, body };
}

beforeAll(async () => {
  server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  // The auth module derives its issuer and MCP resource from API_PUBLIC_URL
  // when it loads, so point it at this listener before importing the app.
  process.env.API_PUBLIC_URL = origin;
  process.env.BETTER_AUTH_SECRET ||= "conformance-secret-that-is-at-least-32-bytes";

  const { createApp } = await import("./app");
  const { checkReadiness } = await import("./lifecycle");
  const app = createApp({
    readiness: () =>
      checkReadiness(
        { started: ready, shuttingDown: false },
        { database: async () => {} },
      ),
  });
  server.on("request", app);
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("platform conformance", () => {
  it("passes the MCP OAuth discovery suite", async () => {
    const adapter: McpDiscoveryAdapter = {
      async request(input) {
        const response = await request(input.path, {
          method: input.method,
          headers: input.headers,
          ...(input.body === undefined ? {} : { body: JSON.stringify(input.body) }),
        });
        return {
          status: response.status,
          headers: Object.fromEntries(response.headers.entries()),
          body: response.body,
        };
      },
    };
    const result = await runMcpDiscoveryConformance(adapter, {
      resourceUrl: `${origin}/mcp`,
    });
    expect(result.failures).toEqual([]);
  });

  it("reports health, and readiness only once started", async () => {
    const health = await request("/health");
    expect(health.status).toBe(200);
    expect(health.body).toMatchObject({ status: "ok", service: "sendlit-api" });

    ready = false;
    expect((await request("/ready")).status).toBe(503);
    ready = true;
    const readiness = await request("/ready");
    expect(readiness.status).toBe(200);
    expect(readiness.body).toMatchObject({ status: "ready" });
  });

  it("echoes or assigns a request ID", async () => {
    const echoed = await request("/health", { headers: { "x-request-id": "req-123" } });
    expect(echoed.headers.get("x-request-id")).toBe("req-123");
    const assigned = await request("/health");
    expect(assigned.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("rejects more than one credential instead of picking one", async () => {
    const response = await request("/contacts", {
      headers: {
        authorization: "Bearer some-token",
        "x-sendlit-apikey": "sl_live_some-key",
      },
    });
    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ error: "credential_ambiguous" });
  });

  it("rejects an invalid or malformed credential without falling back", async () => {
    for (const authorization of ["Bearer totally-invalid", "Basic dXNlcjpwYXNz"]) {
      const response = await request("/contacts", { headers: { authorization } });
      expect(response.status).toBe(401);
    }
    const unknownKey = await request("/contacts", {
      headers: { "x-api-key": "sl_live_unknown" },
    });
    expect(unknownKey.status).toBe(401);
  });

  it("does not accept a browser session on MCP", async () => {
    const response = await request("/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        cookie: "sendlit.session_token=forged",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toContain("resource_metadata=");
  });
});
