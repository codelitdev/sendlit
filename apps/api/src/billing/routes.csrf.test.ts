import { beforeEach, describe, expect, it, mock, vi } from "bun:test";
import express from "express";

mock.module("../auth/better-auth", () => ({
  auth: { api: { getSession: vi.fn() } },
}));

mock.module("../auth/middleware", () => ({
  requireAuth: (req: any, _res: any, next: () => void) => {
    req.authKind = "session";
    req.userId = "user-1";
    next();
  },
}));

mock.module("../db/client", () => ({ db: {} }));

const { requestApp } = await import("../test/http");
const { default: billingRoutes } = await import("./routes");

function probeApp() {
  const app = express();
  app.use(billingRoutes);
  app.use((_req, res) => res.status(204).end());
  return app;
}

describe("billing origin CSRF boundary", () => {
  beforeEach(() => {
    process.env.WEB_CLIENT = "http://localhost:3000";
    process.env.API_PUBLIC_URL = "http://localhost:5000";
  });

  it("lets non-billing mutations fall through to later routers", async () => {
    const response = await requestApp(probeApp(), "/contacts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });

    expect(response.status).toBe(204);
  });

  it("lets organization mutations that are not billing writes fall through", async () => {
    const response = await requestApp(probeApp(), "/organizations/org_1/teams", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });

    expect(response.status).toBe(204);
  });

  it("rejects billing mutations without an Origin", async () => {
    const response = await requestApp(probeApp(), "/billing/organization-checkouts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });

    expect(response.status).toBe(403);
    expect(response.json<unknown>()).toEqual({ error: "csrf_origin_invalid" });
  });

  it("protects billing action-token issuance with the same origin boundary", async () => {
    const response = await requestApp(probeApp(), "/billing/action-token", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "checkout", target: "org_1" }),
    });

    expect(response.status).toBe(403);
    expect(response.json<unknown>()).toEqual({ error: "csrf_origin_invalid" });
  });

  it("rejects billing mutations from a foreign Origin", async () => {
    const response = await requestApp(
      probeApp(),
      "/organizations/org_1/billing/checkout",
      {
        method: "POST",
        headers: {
          origin: "https://evil.example",
          "content-type": "application/json",
        },
        body: "{}",
      },
    );

    expect(response.status).toBe(403);
    expect(response.json<unknown>()).toEqual({ error: "csrf_origin_invalid" });
  });

  it("does not origin-gate billing reads", async () => {
    const response = await requestApp(
      probeApp(),
      "/organizations/org_1/billing/plan-changes/chg_1",
      { method: "GET" },
    );

    expect(response.status).not.toBe(403);
    expect(response.body.includes("csrf_origin_invalid")).toBe(false);
  });
});
