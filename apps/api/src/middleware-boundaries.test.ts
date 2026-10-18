import { beforeEach, describe, expect, it, mock, vi } from "bun:test";
import express, { type Router } from "express";

const middlewareCalls = {
  auth: vi.fn(),
  team: vi.fn(),
};

mock.module("./auth/middleware", () => ({
  requireAuth: (req: any, _res: any, next: () => void) => {
    middlewareCalls.auth(req.path);
    req.authKind = "session";
    req.userId = "user-1";
    next();
  },
}));

mock.module("./auth/require-team", () => ({
  requireTeam: (req: any, _res: any, next: () => void) => {
    middlewareCalls.team(req.path);
    next();
  },
}));

// Route modules import their query layers, but these boundary tests never
// execute a handler. Keep infrastructure clients inert so this suite tests
// Express middleware composition without requiring Postgres or Redis.
mock.module("./db/client", () => ({ db: {} }));
mock.module("./mail/queue", () => ({
  default: {},
  addMailJob: vi.fn(),
  addTransactionalMailJob: vi.fn(),
}));
mock.module("./services/redis", () => ({ default: {} }));

const { requestApp } = await import("./test/http");

const { default: contactsRoutes } = await import("./contacts/routes");
const { default: segmentsRoutes } = await import("./contacts/segments-routes");
const { default: deliveryEventsRoutes } = await import(
  "./delivery-feedback/delivery-events-routes"
);
const { default: feedbackRoutes } = await import("./delivery-feedback/feedback-routes");
const { default: suppressionsRoutes } = await import(
  "./delivery-feedback/suppressions-routes"
);
const { default: mediaRoutes } = await import("./media/routes");
const { default: overviewRoutes } = await import("./overview/routes");
const { default: provisioningRoutes } = await import("./provisioning/routes");
const { default: sequencesRoutes } = await import("./sequences/routes");
const { default: espRoutes } = await import("./settings/esp/routes");
const { default: generalSettingsRoutes } = await import("./settings/general/routes");
const { default: teamRoutes } = await import("./team/routes");
const { default: templatesRoutes } = await import("./templates/routes");
const { default: transactionalRoutes } = await import("./transactional/routes");

type BoundaryCase = {
  name: string;
  router: Router;
  ownPath: string;
  expectedAuth: number;
  expectedTeam: number;
};

const cases: BoundaryCase[] = [
  {
    name: "contacts",
    router: contactsRoutes,
    ownPath: "/contacts",
    expectedAuth: 1,
    expectedTeam: 1,
  },
  {
    name: "segments",
    router: segmentsRoutes,
    ownPath: "/segments",
    expectedAuth: 1,
    expectedTeam: 1,
  },
  {
    name: "media",
    router: mediaRoutes,
    ownPath: "/media",
    expectedAuth: 1,
    expectedTeam: 1,
  },
  {
    name: "templates",
    router: templatesRoutes,
    ownPath: "/templates",
    expectedAuth: 1,
    expectedTeam: 1,
  },
  {
    name: "system templates",
    router: templatesRoutes,
    ownPath: "/system-templates",
    expectedAuth: 1,
    expectedTeam: 0,
  },
  {
    name: "sequences",
    router: sequencesRoutes,
    ownPath: "/sequences",
    expectedAuth: 1,
    expectedTeam: 1,
  },
  {
    name: "transactional email",
    router: transactionalRoutes,
    ownPath: "/emails",
    expectedAuth: 1,
    expectedTeam: 1,
  },
  {
    name: "legacy ESP settings",
    router: espRoutes,
    ownPath: "/settings/esp",
    expectedAuth: 1,
    expectedTeam: 1,
  },
  {
    name: "ESP collection",
    router: espRoutes,
    ownPath: "/settings/esps",
    expectedAuth: 1,
    expectedTeam: 1,
  },
  {
    name: "general settings",
    router: generalSettingsRoutes,
    ownPath: "/settings/general",
    expectedAuth: 1,
    expectedTeam: 1,
  },
  {
    name: "overview",
    router: overviewRoutes,
    ownPath: "/overview",
    expectedAuth: 1,
    expectedTeam: 1,
  },
  {
    name: "feedback settings",
    router: feedbackRoutes,
    ownPath: "/settings/esps/esp_1/feedback",
    expectedAuth: 1,
    expectedTeam: 1,
  },
  {
    name: "delivery events",
    router: deliveryEventsRoutes,
    ownPath: "/delivery-events",
    expectedAuth: 1,
    expectedTeam: 1,
  },
  {
    name: "suppressions",
    router: suppressionsRoutes,
    ownPath: "/suppressions",
    expectedAuth: 1,
    expectedTeam: 1,
  },
  {
    name: "team management",
    router: teamRoutes,
    ownPath: "/teams",
    expectedAuth: 1,
    expectedTeam: 0,
  },
  {
    name: "provisioning",
    router: provisioningRoutes,
    ownPath: "/provisioning/teams",
    expectedAuth: 1,
    expectedTeam: 0,
  },
];

function probeApp(router: Router) {
  const app = express();
  app.use(router);
  app.use((_req, res) => res.status(204).end());
  return app;
}

beforeEach(() => {
  middlewareCalls.auth.mockClear();
  middlewareCalls.team.mockClear();
});

describe("domain router middleware boundaries", () => {
  it.each(cases)("$name ignores paths owned by other routers", async ({ router }) => {
    const response = await requestApp(
      probeApp(router),
      "/__middleware_boundary_probe__",
      { method: "OPTIONS" },
    );

    expect(response.status).toBe(204);
    expect(response.headers["ratelimit-policy"]).toBeUndefined();
    expect(middlewareCalls.auth).not.toHaveBeenCalled();
    expect(middlewareCalls.team).not.toHaveBeenCalled();
  });

  it.each(cases)(
    "$name applies only its intended auth layers",
    async ({ router, ownPath, expectedAuth, expectedTeam }) => {
      const response = await requestApp(probeApp(router), ownPath, {
        method: "OPTIONS",
      });

      expect(response.status).toBeLessThan(400);
      expect(middlewareCalls.auth).toHaveBeenCalledTimes(expectedAuth);
      expect(middlewareCalls.team).toHaveBeenCalledTimes(expectedTeam);
    },
  );
});
