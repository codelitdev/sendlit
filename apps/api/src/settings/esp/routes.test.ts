import express from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";

const requestContext = vi.hoisted(() => ({ teamId: "", account: null as any }));
const transportMocks = vi.hoisted(() => ({
    invalidateEsp: vi.fn(),
    invalidateTeam: vi.fn(),
}));

vi.mock("../../db/client", async () => {
    const { makeTestDb } = await import("../../test/db.js");
    return { db: await makeTestDb() };
});
vi.mock("../../auth/middleware", () => ({
    requireAuth: (req: any, _res: any, next: () => void) => {
        req.account = requestContext.account;
        next();
    },
}));
vi.mock("../../auth/require-team", () => ({
    requireTeam: (req: any, _res: any, next: () => void) => {
        req.teamId = requestContext.teamId;
        next();
    },
}));
vi.mock("../../mail/transport", () => ({
    invalidateEspTransport: transportMocks.invalidateEsp,
    invalidateTeamTransport: transportMocks.invalidateTeam,
}));
vi.mock("./test", () => ({
    testEspConfig: vi.fn().mockResolvedValue({ success: true }),
}));
vi.mock("../../observability/posthog", () => ({ captureEvent: vi.fn() }));

import { db } from "../../db/client";
import { espConfigs, sequences } from "../../db/schema";
import { seedTeamAndContact, truncateAll, type TestDb } from "../../test/db";
import { seedSequence } from "../../test/fixtures";
import { requestApp } from "../../test/http";
import { createEspConfig } from "./queries";
import espRoutes from "./routes";

const tdb = db as unknown as TestDb;

function app() {
    const instance = express();
    instance.use(express.json());
    instance.use(espRoutes);
    return instance;
}

beforeEach(async () => {
    await truncateAll(tdb);
    vi.clearAllMocks();
});

describe("ESP settings routes", () => {
    it("does not expose another team's ESP or stored credentials", async () => {
        const first = await seedTeamAndContact(tdb);
        const second = await seedTeamAndContact(tdb);
        const [otherEsp] = await tdb
            .select()
            .from(espConfigs)
            .where(eq(espConfigs.teamId, second.team.id));
        requestContext.teamId = first.team.id;

        const response = await requestApp(
            app(),
            `/settings/esps/${otherEsp.espId}`,
        );

        expect(response.status).toBe(404);
        expect(response.body).not.toContain("encryptedSecret");
    });

    it("returns credential presence but never encrypted credential material", async () => {
        const owner = await seedTeamAndContact(tdb);
        const config = await createEspConfig(owner.team.id, {
            name: "Marketing",
            provider: "smtp",
            host: "smtp.example.com",
            port: 587,
            secure: false,
            username: "mailer",
            password: "super-secret",
        });
        requestContext.teamId = owner.team.id;

        const response = await requestApp(
            app(),
            `/settings/esps/${config.espId}`,
        );

        expect(response.status).toBe(200);
        expect(response.json()).toMatchObject({ hasPassword: true });
        expect(response.body).not.toContain("super-secret");
        expect(response.body).not.toContain("encryptedSecret");
        expect(response.body).not.toContain(config.id);
    });

    it("invalidates the pinned cache and the default cache when changing the default", async () => {
        const owner = await seedTeamAndContact(tdb);
        const config = await createEspConfig(owner.team.id, {
            name: "Marketing",
            provider: "smtp",
            host: "smtp.marketing.example.com",
            port: 587,
            secure: false,
        });
        requestContext.teamId = owner.team.id;

        const response = await requestApp(
            app(),
            `/settings/esps/${config.espId}`,
            {
                method: "PATCH",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ isDefault: true }),
            },
        );

        expect(response.status).toBe(200);
        expect(transportMocks.invalidateEsp).toHaveBeenCalledWith(
            owner.team.id,
            config.id,
        );
        expect(transportMocks.invalidateTeam).toHaveBeenCalledWith(
            owner.team.id,
        );
    });

    it("refuses to delete a pinned ESP and retains its transport cache", async () => {
        const owner = await seedTeamAndContact(tdb);
        const config = await createEspConfig(owner.team.id, {
            name: "Pinned",
            provider: "smtp",
            host: "smtp.pinned.example.com",
            port: 587,
            secure: false,
        });
        const { sequenceRow } = await seedSequence(tdb, {
            teamId: owner.team.id,
            emails: [{ emailId: "email_1" }],
        });
        await tdb
            .update(sequences)
            .set({ outboxId: config.id, deliveryRoute: "custom" })
            .where(eq(sequences.id, sequenceRow.id));
        requestContext.teamId = owner.team.id;

        const response = await requestApp(
            app(),
            `/settings/esps/${config.espId}`,
            { method: "DELETE" },
        );

        expect(response.status).toBe(409);
        expect(transportMocks.invalidateEsp).not.toHaveBeenCalled();
        const [stillPresent] = await tdb
            .select()
            .from(espConfigs)
            .where(eq(espConfigs.id, config.id));
        expect(stillPresent).toBeTruthy();
    });
});
