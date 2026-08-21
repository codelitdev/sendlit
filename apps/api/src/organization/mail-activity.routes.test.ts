import express from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";

const authState = vi.hoisted(() => ({
    userId: "",
    authKind: "session" as string,
    organizationId: "",
    organizationApiKeyId: "",
    organizationScopes: [] as string[],
}));

vi.mock("../db/client", async () => {
    const { makeTestDb } = await import("../test/db.js");
    return { db: await makeTestDb() };
});
vi.mock("../auth/middleware", () => ({
    requireAuth: (req: any, _res: any, next: () => void) => {
        req.userId = authState.userId;
        req.authKind = authState.authKind;
        req.organizationId = authState.organizationId;
        req.organizationApiKeyId = authState.organizationApiKeyId;
        req.organizationScopes = authState.organizationScopes;
        next();
    },
}));

import { db } from "../db/client";
import { espConfigs, transactionalEmails, user } from "../db/schema";
import { addOrganizationMemberByEmail, createOrganization } from "./queries";
import { createTeam } from "../team/queries";
import { truncateAll, type TestDb } from "../test/db";
import { requestApp } from "../test/http";
import organizationRoutes from "./routes";

const tdb = db as unknown as TestDb;

function app() {
    const instance = express();
    instance.use(express.json());
    instance.use(organizationRoutes);
    return instance;
}

async function insertUser(name: string) {
    const [account] = await tdb
        .insert(user)
        .values({
            id: crypto.randomUUID(),
            name,
            email: `${name.toLowerCase().replace(/\s+/g, "-")}-${crypto.randomUUID()}@example.com`,
            emailVerified: true,
            createdAt: new Date(),
            updatedAt: new Date(),
        })
        .returning();
    return account;
}

async function attachTeamEsp(teamId: string) {
    const [esp] = await tdb
        .insert(espConfigs)
        .values({
            ownerScope: "team",
            teamId,
            name: "Default ESP",
            host: "smtp.example.com",
            fromName: "Test Sender",
            fromEmail: "sender@example.com",
            status: "active",
        })
        .returning();
    return esp;
}

async function insertTransactional(input: {
    teamId: string;
    outboxId: string;
    status: string;
    createdAt?: Date;
    toEmail?: string;
    subject?: string;
    html?: string;
}) {
    await tdb.insert(transactionalEmails).values({
        teamId: input.teamId,
        deliverySourceType: "team",
        outboxId: input.outboxId,
        toEmail: input.toEmail ?? "recipient@example.com",
        subject: input.subject ?? "Secret subject",
        html: input.html ?? "<p>secret body</p>",
        status: input.status,
        createdAt: input.createdAt ?? new Date(),
    });
}

beforeEach(async () => {
    await truncateAll(tdb);
    authState.userId = "";
    authState.authKind = "session";
    authState.organizationId = "";
    authState.organizationApiKeyId = "";
    authState.organizationScopes = [];
});

describe("GET /organizations/:organizationId/mail-activity", () => {
    it("returns per-team and total transactional counts, including quiet teams", async () => {
        const owner = await insertUser("Owner");
        const organization = await createOrganization(owner.id, "Acme");
        const bravo = await createTeam({
            organizationId: organization.id,
            name: "Bravo",
        });
        const alpha = await createTeam({
            organizationId: organization.id,
            name: "Alpha",
            externalId: "school:alpha",
        });
        const alphaEsp = await attachTeamEsp(alpha.id);
        await insertTransactional({
            teamId: alpha.id,
            outboxId: alphaEsp.id,
            status: "sent",
        });
        await insertTransactional({
            teamId: alpha.id,
            outboxId: alphaEsp.id,
            status: "sent",
        });
        await insertTransactional({
            teamId: alpha.id,
            outboxId: alphaEsp.id,
            status: "queued",
        });
        await insertTransactional({
            teamId: alpha.id,
            outboxId: alphaEsp.id,
            status: "failed",
        });
        await insertTransactional({
            teamId: alpha.id,
            outboxId: alphaEsp.id,
            status: "bounced",
        });
        await insertTransactional({
            teamId: alpha.id,
            outboxId: alphaEsp.id,
            status: "suppressed",
        });
        await insertTransactional({
            teamId: alpha.id,
            outboxId: alphaEsp.id,
            status: "sent",
            createdAt: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000),
        });
        authState.userId = owner.id;

        const response = await requestApp(
            app(),
            `/organizations/${organization.organizationId}/mail-activity`,
        );

        expect(response.status).toBe(200);
        const body = response.json();
        expect(body.rangeDays).toBe(7);
        expect(body.totals).toEqual({
            sent: 2,
            queued: 1,
            failed: 1,
            bounced: 1,
        });
        expect(body.teams.map((team: { name: string }) => team.name)).toEqual([
            "Alpha",
            "Bravo",
        ]);
        expect(body.teams[0]).toMatchObject({
            teamId: alpha.teamId,
            name: "Alpha",
            status: "active",
            externalId: "school:alpha",
            mail: { sent: 2, queued: 1, failed: 1, bounced: 1 },
        });
        expect(body.teams[1]).toMatchObject({
            teamId: bravo.teamId,
            name: "Bravo",
            mail: { sent: 0, queued: 0, failed: 0, bounced: 0 },
        });
        expect(response.body).not.toContain("recipient@example.com");
        expect(response.body).not.toContain("Secret subject");
        expect(response.body).not.toContain("secret body");
        expect(body).not.toHaveProperty("toEmail");
        expect(JSON.stringify(body)).not.toMatch(/html|subject|toEmail/);
    });

    it("honors rangeDays=1 and defaults to 7", async () => {
        const owner = await insertUser("Owner");
        const organization = await createOrganization(owner.id, "Acme");
        const team = await createTeam({
            organizationId: organization.id,
            name: "Alpha",
        });
        const esp = await attachTeamEsp(team.id);
        await insertTransactional({
            teamId: team.id,
            outboxId: esp.id,
            status: "sent",
            createdAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
        });
        authState.userId = owner.id;

        const defaulted = await requestApp(
            app(),
            `/organizations/${organization.organizationId}/mail-activity`,
        );
        expect(defaulted.json().rangeDays).toBe(7);
        expect(defaulted.json().totals.sent).toBe(1);

        const oneDay = await requestApp(
            app(),
            `/organizations/${organization.organizationId}/mail-activity?rangeDays=1`,
        );
        expect(oneDay.status).toBe(200);
        expect(oneDay.json()).toMatchObject({
            rangeDays: 1,
            totals: { sent: 0, queued: 0, failed: 0, bounced: 0 },
        });
    });

    it("rejects organization members and unknown organizations", async () => {
        const owner = await insertUser("Owner");
        const member = await insertUser("Member");
        const organization = await createOrganization(owner.id, "Acme");
        await addOrganizationMemberByEmail(
            organization.id,
            member.email,
            "member",
        );
        authState.userId = member.id;

        const forbidden = await requestApp(
            app(),
            `/organizations/${organization.organizationId}/mail-activity`,
        );
        expect(forbidden.status).toBe(403);

        authState.userId = owner.id;
        const missing = await requestApp(
            app(),
            "/organizations/org_does-not-exist/mail-activity",
        );
        expect(missing.status).toBe(404);
    });

    it("allows an organization key with usage:read and leaves /usage as quota", async () => {
        const owner = await insertUser("Owner");
        const organization = await createOrganization(owner.id, "Acme");
        const team = await createTeam({
            organizationId: organization.id,
            name: "Alpha",
        });
        const esp = await attachTeamEsp(team.id);
        await insertTransactional({
            teamId: team.id,
            outboxId: esp.id,
            status: "sent",
        });
        authState.authKind = "organization_key";
        authState.organizationId = organization.id;
        authState.organizationApiKeyId = crypto.randomUUID();
        authState.organizationScopes = ["usage:read"];

        const activity = await requestApp(
            app(),
            `/organizations/${organization.organizationId}/mail-activity?rangeDays=30`,
        );
        expect(activity.status).toBe(200);
        expect(activity.json()).toMatchObject({
            rangeDays: 30,
            totals: { sent: 1, queued: 0, failed: 0, bounced: 0 },
        });

        const usage = await requestApp(
            app(),
            `/organizations/${organization.organizationId}/usage`,
        );
        expect(usage.status).toBe(200);
        expect(usage.json()).toEqual(
            expect.objectContaining({
                day: expect.objectContaining({
                    accepted: expect.any(Number),
                    reserved: expect.any(Number),
                }),
                month: expect.objectContaining({
                    accepted: expect.any(Number),
                    reserved: expect.any(Number),
                }),
            }),
        );
        expect(usage.json()).not.toHaveProperty("totals");
        expect(usage.json()).not.toHaveProperty("teams");
        expect(usage.json()).not.toHaveProperty("rangeDays");
    });
});
