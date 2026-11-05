import { describe, expect, it, mock, vi } from "bun:test";

mock.module("./better-auth", () => ({
  SESSION_COOKIE_NAME: "sendlit.session_token",
  mcpResourceUrl: "https://sendlit.test/mcp",
  mcpProtectedResourceMetadataUrl:
    "https://sendlit.test/.well-known/oauth-protected-resource/mcp",
}));
mock.module("./resolve-auth", () => ({
  resolveAuth: vi.fn(),
  sendAuthError: vi.fn(() => false),
}));

const { createAuthMiddleware } = await import("./middleware");

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
    expect(res.headers["WWW-Authenticate"]).toContain("oauth-protected-resource/mcp");
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

    expect(next).toHaveBeenCalledTimes(1);
    expect(req).toMatchObject({
      authKind: "team_key",
      apiKeyId: "tak_public",
      teamId: "team-1",
    });
    const { headers: _headers, body: _body, ...authState } = req;
    expect(JSON.stringify(authState)).not.toContain("sl_live_secret");
  });
});

describe("REST auth middleware", () => {
  const oauth = (audiences: string[]) => ({
    status: "authenticated" as const,
    kind: "oauth" as const,
    identity: { method: "oauth" as const, audiences },
    user: { id: "user-1" },
    userId: "user-1",
    token: "t",
    clientId: "client",
    scopes: ["contacts:read"],
  });
  const session = {
    status: "authenticated" as const,
    kind: "session" as const,
    identity: { method: "session" as const },
    user: { id: "user-1" },
    userId: "user-1",
    scopes: ["web"] as ["web"],
  };

  async function run(auth: unknown, req: Record<string, unknown>) {
    const middleware = createAuthMiddleware("rest", vi.fn(async () => auth) as any);
    const request: any = { headers: {}, body: undefined, method: "GET", ...req };
    const res = responseDouble();
    const next = vi.fn();
    await middleware(request, res, next);
    return { res, next, request };
  }

  it("refuses an OAuth token that is only valid for the MCP resource", async () => {
    const { res, next } = await run(oauth(["https://sendlit.test/mcp"]), {});
    expect(res.statusCode).toBe(401);
    expect(res.body).toMatchObject({ error: "invalid_token" });
    expect(next).not.toHaveBeenCalled();
  });

  it("still accepts an OAuth token issued for the API itself", async () => {
    const { next } = await run(oauth(["https://sendlit.test"]), {});
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("refuses a cookie-session write that has no CSRF token", async () => {
    // The attacker page is same-origin, so its Origin is allowed: only the
    // token can stop it.
    process.env.API_PUBLIC_URL = "https://sendlit.test";
    const { res, next } = await run(session, {
      method: "POST",
      headers: { origin: "https://sendlit.test", cookie: "sendlit_csrf=abc" },
    });
    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual({ error: "csrf_token_invalid" });
    expect(next).not.toHaveBeenCalled();
  });

  it("refuses a cookie-session write from another origin", async () => {
    process.env.API_PUBLIC_URL = "https://sendlit.test";
    const { res } = await run(session, {
      method: "DELETE",
      headers: { origin: "https://evil.test" },
    });
    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual({ error: "csrf_origin_invalid" });
  });

  it("allows a cookie-session write with a trusted origin and matching token", async () => {
    process.env.API_PUBLIC_URL = "https://sendlit.test";
    const { next } = await run(session, {
      method: "POST",
      headers: {
        origin: "https://sendlit.test",
        cookie: "sendlit_csrf=abc",
        "x-sendlit-csrf": "abc",
      },
    });
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("does not require a token for reads or for API keys", async () => {
    expect((await run(session, { method: "GET" })).next).toHaveBeenCalledTimes(1);
    const key = {
      status: "authenticated",
      kind: "team_key",
      user: null,
      apiKeyId: "k",
      teamId: "t",
    };
    expect((await run(key, { method: "POST" })).next).toHaveBeenCalledTimes(1);
  });
});
