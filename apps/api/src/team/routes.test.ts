import express from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";

const authState = vi.hoisted(() => ({
    accountId: "",
    authKind: "session",
}));

vi.mock("../db/client", async () => {
    const { makeTestDb } = await import("../test/db.js");
    return { db: await makeTestDb() };
});
vi.mock("../auth/middleware", () => ({
    requireAuth: (req: any, _res: any, next: () => void) => {
        req.accountId = authState.accountId;
        req.authKind = authState.authKind;
        next();
    },
}));

import { db } from "../db/client";
import { apiKeys, teamMembers, teams } from "../db/schema";
import { createApiKey } from "../apikey/queries";
import { seedTeamAndContact, truncateAll, type TestDb } from "../test/db";
import { requestApp } from "../test/http";
import teamRoutes from "./routes";

const tdb = db as unknown as TestDb;

function app() {
    const instance = express();
    instance.use(express.json());
    instance.use(teamRoutes);
    return instance;
}

beforeEach(async () => {
    await truncateAll(tdb);
    authState.accountId = "";
    authState.authKind = "session";
});

describe("team management route authorization", () => {
    it("rejects team management through a team API key", async () => {
        authState.authKind = "api-key";

        const response = await requestApp(app(), "/teams");

        expect(response.status).toBe(403);
        expect(response.json()).toMatchObject({ error: "user_auth_required" });
    });

    it("does not reveal another account's team or API keys", async () => {
        const first = await seedTeamAndContact(tdb);
        const second = await seedTeamAndContact(tdb);
        await tdb.insert(teamMembers).values([
            {
                teamId: first.team.id,
                accountId: first.account.id,
                role: "owner",
            },
            {
                teamId: second.team.id,
                accountId: second.account.id,
                role: "owner",
            },
        ]);
        await createApiKey(second.team.id, "Private integration");
        authState.accountId = first.account.id;

        const response = await requestApp(
            app(),
            `/teams/${second.team.teamId}/keys`,
        );

        expect(response.status).toBe(404);
        expect(response.body).not.toContain("Private integration");
    });

    it("prevents a non-owner member from deleting a team", async () => {
        const member = await seedTeamAndContact(tdb);
        const ownedByAnother = await seedTeamAndContact(tdb);
        await tdb.insert(teamMembers).values([
            {
                teamId: ownedByAnother.team.id,
                accountId: ownedByAnother.account.id,
                role: "owner",
            },
            {
                teamId: ownedByAnother.team.id,
                accountId: member.account.id,
                role: "member",
            },
        ]);
        authState.accountId = member.account.id;

        const response = await requestApp(
            app(),
            `/teams/${ownedByAnother.team.teamId}`,
            { method: "DELETE" },
        );

        expect(response.status).toBe(403);
        const [stillPresent] = await tdb
            .select()
            .from(teams)
            .where(eq(teams.id, ownedByAnother.team.id));
        expect(stillPresent).toBeTruthy();
    });

    it("returns a new API key once without exposing hashes or internal team ids", async () => {
        const owner = await seedTeamAndContact(tdb);
        await tdb.insert(teamMembers).values({
            teamId: owner.team.id,
            accountId: owner.account.id,
            role: "owner",
        });
        authState.accountId = owner.account.id;

        const created = await requestApp(
            app(),
            `/teams/${owner.team.teamId}/keys`,
            {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ name: "Automation" }),
            },
        );

        expect(created.status).toBe(201);
        expect(created.json()).toMatchObject({
            name: "Automation",
            key: expect.stringMatching(/^sl_live_/),
        });
        expect(created.body).not.toContain("keyHash");
        expect(created.body).not.toContain(owner.team.id);

        const listed = await requestApp(
            app(),
            `/teams/${owner.team.teamId}/keys`,
        );
        expect(listed.status).toBe(200);
        expect(listed.body).not.toContain(created.json().key);
        expect(listed.body).not.toContain("keyHash");
        expect(await tdb.select().from(apiKeys)).toHaveLength(1);
    });
});
