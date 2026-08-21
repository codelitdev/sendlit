import express from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";

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
import { teamMembers, user } from "../db/schema";
import { addOrganizationMemberByEmail, createOrganization } from "./queries";
import { listOrganizationAuditEvents } from "./audit";
import {
    archiveTeam,
    findOrCreateTeamByExternalId,
    listTeamsForUser,
    setTeamSendingStatus,
} from "../team/queries";
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

function enterPath(organizationId: string, teamId: string) {
    return `/organizations/${organizationId}/teams/${teamId}/enter`;
}

beforeEach(async () => {
    await truncateAll(tdb);
    authState.userId = "";
    authState.authKind = "session";
    authState.organizationId = "";
    authState.organizationApiKeyId = "";
    authState.organizationScopes = [];
});

describe("POST /organizations/:organizationId/teams/:teamId/enter", () => {
    it("grants admin membership on a provisioned team and lists it for the user", async () => {
        const owner = await insertUser("Owner");
        const organization = await createOrganization(owner.id, "Acme");
        const provisioned = await findOrCreateTeamByExternalId({
            organizationId: organization.id,
            externalId: "school:one",
            name: "School One",
            provisioningRequestHash: "hash-1",
            createdBy: { type: "system" },
        });
        expect(
            await tdb
                .select()
                .from(teamMembers)
                .where(eq(teamMembers.teamId, provisioned.id)),
        ).toHaveLength(0);
        authState.userId = owner.id;

        const listedBefore = await requestApp(
            app(),
            `/organizations/${organization.organizationId}/teams`,
        );
        expect(listedBefore.json().items).toEqual([
            expect.objectContaining({
                teamId: provisioned.teamId,
                viewerIsMember: false,
            }),
        ]);

        const created = await requestApp(
            app(),
            enterPath(organization.organizationId, provisioned.teamId),
            {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({}),
            },
        );
        expect(created.status).toBe(200);
        expect(created.json()).toEqual({
            teamId: provisioned.teamId,
            role: "admin",
            created: true,
        });
        expect(
            await tdb
                .select()
                .from(teamMembers)
                .where(eq(teamMembers.teamId, provisioned.id)),
        ).toHaveLength(1);
        await expect(listTeamsForUser(owner.id)).resolves.toEqual(
            expect.arrayContaining([
                expect.objectContaining({ id: provisioned.id }),
            ]),
        );

        const again = await requestApp(
            app(),
            enterPath(organization.organizationId, provisioned.teamId),
            {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({}),
            },
        );
        expect(again.status).toBe(200);
        expect(again.json()).toEqual({
            teamId: provisioned.teamId,
            role: "admin",
            created: false,
        });
        expect(
            await tdb
                .select()
                .from(teamMembers)
                .where(eq(teamMembers.teamId, provisioned.id)),
        ).toHaveLength(1);

        const events = await listOrganizationAuditEvents(organization.id);
        expect(
            events.filter((event) => event.action === "team.entered"),
        ).toEqual([
            expect.objectContaining({
                action: "team.entered",
                teamId: provisioned.teamId,
                actorType: "user",
                metadata: { role: "admin", created: false },
            }),
            expect.objectContaining({
                action: "team.entered",
                teamId: provisioned.teamId,
                metadata: { role: "admin", created: true },
            }),
        ]);
    });

    it("rejects org members, organization keys, foreign teams, and archived teams", async () => {
        const owner = await insertUser("Owner");
        const member = await insertUser("Member");
        const other = await insertUser("Other");
        const organization = await createOrganization(owner.id, "Acme");
        const otherOrg = await createOrganization(other.id, "Other Co");
        await addOrganizationMemberByEmail(
            organization.id,
            member.email,
            "member",
        );
        const provisioned = await findOrCreateTeamByExternalId({
            organizationId: organization.id,
            externalId: "school:two",
            name: "School Two",
            provisioningRequestHash: "hash-2",
            createdBy: { type: "system" },
        });
        const foreign = await findOrCreateTeamByExternalId({
            organizationId: otherOrg.id,
            externalId: "school:foreign",
            name: "Foreign",
            provisioningRequestHash: "hash-f",
            createdBy: { type: "system" },
        });
        const archived = await findOrCreateTeamByExternalId({
            organizationId: organization.id,
            externalId: "school:archived",
            name: "Archived",
            provisioningRequestHash: "hash-a",
            createdBy: { type: "system" },
        });
        await archiveTeam(archived.id);
        const suspended = await findOrCreateTeamByExternalId({
            organizationId: organization.id,
            externalId: "school:suspended",
            name: "Suspended",
            provisioningRequestHash: "hash-s",
            createdBy: { type: "system" },
        });
        await setTeamSendingStatus(suspended.id, "sending_suspended");

        authState.userId = member.id;
        const asMember = await requestApp(
            app(),
            enterPath(organization.organizationId, provisioned.teamId),
            {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({}),
            },
        );
        expect(asMember.status).toBe(403);

        authState.userId = "";
        authState.authKind = "organization_key";
        authState.organizationId = organization.id;
        authState.organizationScopes = ["teams:manage"];
        const asKey = await requestApp(
            app(),
            enterPath(organization.organizationId, provisioned.teamId),
            {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({}),
            },
        );
        expect(asKey.status).toBe(403);

        authState.authKind = "session";
        authState.userId = owner.id;
        const foreignTeam = await requestApp(
            app(),
            enterPath(organization.organizationId, foreign.teamId),
            {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({}),
            },
        );
        expect(foreignTeam.status).toBe(404);

        const archivedTeam = await requestApp(
            app(),
            enterPath(organization.organizationId, archived.teamId),
            {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({}),
            },
        );
        expect(archivedTeam.status).toBe(422);

        const suspendedTeam = await requestApp(
            app(),
            enterPath(organization.organizationId, suspended.teamId),
            {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({}),
            },
        );
        expect(suspendedTeam.status).toBe(200);
        expect(suspendedTeam.json()).toMatchObject({
            teamId: suspended.teamId,
            role: "admin",
            created: true,
        });
        expect(
            await tdb
                .select()
                .from(teamMembers)
                .where(eq(teamMembers.teamId, provisioned.id)),
        ).toHaveLength(0);
    });
});
