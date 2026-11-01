import { describe, expect, it, mock } from "bun:test";
import express from "express";

mock.module("../db/client", () => ({ db: {}, pool: {} }));

const { apiTools, MCP_API_OPERATIONS } = await import("./api-tools");
const { MCP_SCOPES } = await import("./policy");

type Seen = {
  method: string;
  url: string;
  headers: Record<string, unknown>;
  ip?: string;
  body: unknown;
};

/** A stand-in for the SendLit app, serving a few real contract paths. */
function fakeApp(seen: Seen[] = []) {
  const app = express();
  app.set("trust proxy", 1);
  app.use(express.json());
  app.use((req, _res, next) => {
    seen.push({
      method: req.method,
      url: req.originalUrl,
      headers: req.headers,
      ip: req.ip,
      body: req.body,
    });
    next();
  });
  app.get("/settings/esps", (_req, res) => res.json([{ espId: "esp_1" }]));
  app.get("/settings/esps/:espId", (req, res) =>
    req.params.espId === "esp_missing"
      ? res.status(404).json({ error: "not_found", error_description: "ESP not found" })
      : res.json({ espId: req.params.espId, createdAt: "2026-01-01T00:00:00.000Z" }),
  );
  app.delete("/settings/esps/:espId", (_req, res) => res.status(204).end());
  app.post("/settings/esps/:espId/test", (_req, res) =>
    res.status(402).json({ error: "plan_limit_reached", limit: 3, nested: { x: 1 } }),
  );
  app.post("/settings/esps", (_req, res) =>
    res.status(400).json({
      name: "ZodError",
      issues: [
        { path: ["body", "name"], message: "Required" },
        { path: [], message: "Unrecognized key" },
      ],
    }),
  );
  app.get("/settings/general", (_req, res) => res.status(500).json({ error: "boom" }));
  app.get("/contacts/export", (_req, res) =>
    res.type("text/csv").send("email\na@b.co\n"),
  );
  return app;
}

const teamKey = {
  authKind: "team_key" as const,
  teamId: "team-1",
  user: null,
  scopes: [] as string[],
  requestId: "req-1",
  clientIp: "203.0.113.9",
  replayHeaders: { "x-sendlit-apikey": "tak_secret" },
};

const oauth = (scopes: string[]) => ({
  ...teamKey,
  authKind: "oauth" as const,
  scopes,
  replayHeaders: { authorization: "Bearer tok" },
});

function tools(seen: Seen[] = []) {
  const app = fakeApp(seen);
  return new Map(apiTools({ app: () => app }).map((tool) => [tool.name, tool]));
}

async function call(
  name: string,
  args: Record<string, unknown>,
  context: any = teamKey,
  seen: Seen[] = [],
) {
  return (await tools(seen).get(name)!.handler({
    context,
    args,
    signal: new AbortController().signal,
  })) as any;
}

describe("generic api.* MCP tools", () => {
  it("routes only manifest operations, each to the tool for its risk", () => {
    expect(MCP_API_OPERATIONS.get("settings.esps.list")).toMatchObject({
      method: "GET",
      path: "/settings/esps",
      tool: "api.read",
    });
    expect(MCP_API_OPERATIONS.get("settings.esps.remove")?.tool).toBe("api.delete");
    expect(MCP_API_OPERATIONS.get("settings.esps.test")?.tool).toBe("api.write");
    // Dedicated tools and REST-only operations are not generic operations.
    expect(MCP_API_OPERATIONS.has("contacts.list")).toBe(false);
    expect(MCP_API_OPERATIONS.has("billing.portal")).toBe(false);
    expect(MCP_API_OPERATIONS.has("organizations.list")).toBe(false);
    for (const operation of MCP_API_OPERATIONS.values()) {
      expect(operation.tool).toBe(
        { read: "api.read", write: "api.write", destructive: "api.delete" }[
          operation.risk
        ],
      );
    }
  });

  it("lists operations with their scope and whether the connection may run them", async () => {
    const { items } = await call(
      "api.list_operations",
      { search: "esps" },
      oauth([MCP_SCOPES.espRead]),
    );
    const list = items.find((item: any) => item.operationId === "settings.esps.list");
    const remove = items.find(
      (item: any) => item.operationId === "settings.esps.remove",
    );
    expect(list).toMatchObject({
      tool: "api.read",
      requiredScope: "esp:read",
      available: true,
    });
    expect(remove).toMatchObject({
      tool: "api.delete",
      requiredScope: "esp:write",
      available: false,
    });
    expect(items.every((item: any) => item.path.includes("esps"))).toBe(true);
  });

  it("describes an operation's parameters and response from the OpenAPI document", async () => {
    const described = await call("api.describe_operation", {
      operationId: "settings.esps.get",
    });
    expect(described).toMatchObject({ method: "GET", path: "/settings/esps/:espId" });
    expect(described.pathParams).toEqual([
      expect.objectContaining({ name: "espId", in: "path" }),
    ]);
    expect(described.response?.status).toBe(200);
    expect(await call("api.describe_operation", { operationId: "nope" })).toMatchObject(
      {
        error: {
          code: "validation_failed",
          safeDetails: { reason: "unknown_operation" },
        },
      },
    );
  });

  it("runs the REST route with the caller's credential, request id and IP", async () => {
    const seen: Seen[] = [];
    const result = await call(
      "api.read",
      { operationId: "settings.esps.get", pathParams: { espId: "esp 1" } },
      teamKey,
      seen,
    );
    expect(result).toEqual({ espId: "esp 1", createdAt: "2026-01-01T00:00:00.000Z" });
    expect(seen[0]).toMatchObject({
      method: "GET",
      url: "/settings/esps/esp%201",
      ip: "203.0.113.9",
    });
    expect(seen[0]?.headers).toMatchObject({
      "x-sendlit-apikey": "tak_secret",
      "x-request-id": "req-1",
    });
  });

  it("wraps arrays, empty responses and non-JSON bodies", async () => {
    expect(await call("api.read", { operationId: "settings.esps.list" })).toEqual({
      items: [{ espId: "esp_1" }],
    });
    expect(
      await call("api.delete", {
        operationId: "settings.esps.remove",
        pathParams: { espId: "esp_1" },
        confirm: true,
      }),
    ).toEqual({ ok: true });
    expect(await call("api.read", { operationId: "contacts.export" })).toEqual({
      contentType: expect.stringContaining("text/csv"),
      body: "email\na@b.co\n",
    });
  });

  it("maps REST errors to platform codes, keeping the REST reason and primitive details", async () => {
    expect(
      await call("api.read", {
        operationId: "settings.esps.get",
        pathParams: { espId: "esp_missing" },
      }),
    ).toMatchObject({
      error: {
        code: "not_found",
        safeDetails: { reason: "not_found", message: "ESP not found" },
      },
    });
    const limited = await call("api.write", {
      operationId: "settings.esps.test",
      pathParams: { espId: "esp_1" },
    });
    expect(limited.error.code).toBe("forbidden");
    expect(limited.error.safeDetails).toEqual({
      reason: "plan_limit_reached",
      limit: 3,
    });
    expect(
      await call("api.write", { operationId: "settings.esps.create", body: {} }),
    ).toMatchObject({
      error: {
        code: "validation_failed",
        safeDetails: {
          reason: "invalid_request",
          message: "body.name: Required; Unrecognized key",
        },
      },
    });
    // Server errors never leak their body.
    const failed = await call("api.read", { operationId: "settings.general.get" });
    expect(failed.error).toEqual({
      code: "internal_error",
      message: expect.any(String),
    });
  });

  it("refuses the wrong tool, missing or path-escaping parameters and unknown operations", async () => {
    expect(
      await call("api.read", {
        operationId: "settings.esps.remove",
        pathParams: { espId: "e" },
      }),
    ).toMatchObject({
      error: { safeDetails: { reason: "wrong_tool", useTool: "api.delete" } },
    });
    expect(await call("api.read", { operationId: "settings.esps.get" })).toMatchObject({
      error: { safeDetails: { reason: "missing_path_param", param: "espId" } },
    });
    for (const espId of [".", ".."]) {
      expect(
        await call("api.read", {
          operationId: "settings.esps.get",
          pathParams: { espId },
        }),
      ).toMatchObject({ error: { safeDetails: { reason: "invalid_path_param" } } });
    }
    expect(await call("api.read", { operationId: "contacts.list" })).toMatchObject({
      error: { safeDetails: { reason: "unknown_operation" } },
    });
    expect(await call("api.write", { operationId: "billing.portal" })).toMatchObject({
      error: { safeDetails: { reason: "unknown_operation" } },
    });
  });

  it("enforces the operation's OAuth scope and keeps API keys away from key management", async () => {
    const seen: Seen[] = [];
    expect(
      await call(
        "api.read",
        { operationId: "settings.esps.list" },
        oauth([MCP_SCOPES.contactsRead]),
        seen,
      ),
    ).toMatchObject({
      error: {
        code: "forbidden",
        safeDetails: { reason: "insufficient_scope", requiredScope: "esp:read" },
      },
    });
    expect(
      await call(
        "api.read",
        { operationId: "teams.listKeys", pathParams: { teamId: "team_1" } },
        teamKey,
        seen,
      ),
    ).toMatchObject({
      error: { code: "forbidden", safeDetails: { reason: "user_auth_required" } },
    });
    expect(seen).toHaveLength(0);

    const allowed: Seen[] = [];
    await call(
      "api.read",
      { operationId: "settings.esps.list" },
      oauth([MCP_SCOPES.espRead]),
      allowed,
    );
    expect(allowed[0]?.headers).toMatchObject({ authorization: "Bearer tok" });
  });
});
