import express, { type Router } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { requestApp } from "./test/http";

const middlewareCalls = vi.hoisted(() => ({
    auth: vi.fn(),
    team: vi.fn(),
}));

vi.mock("./auth/middleware", () => ({
    requireAuth: (req: any, _res: any, next: () => void) => {
        middlewareCalls.auth(req.path);
        req.authKind = "session";
        req.userId = "user-1";
        next();
    },
}));

vi.mock("./auth/require-team", () => ({
    requireTeam: (req: any, _res: any, next: () => void) => {
        middlewareCalls.team(req.path);
        next();
    },
}));

// Route modules import their query layers, but these boundary tests never
// execute a handler. Keep infrastructure clients inert so this suite tests
// Express middleware composition without requiring Postgres or Redis.
vi.mock("./db/client", () => ({ db: {} }));
vi.mock("./mail/queue", () => ({
    default: {},
    addMailJob: vi.fn(),
    addTransactionalMailJob: vi.fn(),
}));
vi.mock("./services/redis", () => ({ default: {} }));

import contactsRoutes from "./contacts/routes";
import segmentsRoutes from "./contacts/segments-routes";
import mediaRoutes from "./media/routes";
import templatesRoutes from "./templates/routes";
import sequencesRoutes from "./sequences/routes";
import transactionalRoutes from "./transactional/routes";
import espRoutes from "./settings/esp/routes";
import generalSettingsRoutes from "./settings/general/routes";
import overviewRoutes from "./overview/routes";
import feedbackRoutes from "./delivery-feedback/feedback-routes";
import deliveryEventsRoutes from "./delivery-feedback/delivery-events-routes";
import suppressionsRoutes from "./delivery-feedback/suppressions-routes";
import teamRoutes from "./team/routes";
import provisioningRoutes from "./provisioning/routes";

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
    it.each(cases)(
        "$name ignores paths owned by other routers",
        async ({ router }) => {
            const response = await requestApp(
                probeApp(router),
                "/__middleware_boundary_probe__",
                { method: "OPTIONS" },
            );

            expect(response.status).toBe(204);
            expect(response.headers["ratelimit-policy"]).toBeUndefined();
            expect(middlewareCalls.auth).not.toHaveBeenCalled();
            expect(middlewareCalls.team).not.toHaveBeenCalled();
        },
    );

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
