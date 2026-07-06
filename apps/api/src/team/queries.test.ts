import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";

vi.mock("../db/client", async () => {
    const { makeTestDb } = await import("../test/db.js");
    return { db: await makeTestDb() };
});

import { db } from "../db/client";
import { accounts, teams } from "../db/schema";
import { getApiKeysByTeamId } from "../apikey/queries";
import { seedTeamAndContact, truncateAll, type TestDb } from "../test/db";
import {
    createTeam,
    findOrCreateBareAccount,
    findOrCreateTeamByExternalId,
    getTeamMembership,
    hasMailQuotaRemaining,
    incrementMailCount,
    listTeamsForAccount,
} from "./queries";

const tdb = db as unknown as TestDb;

beforeEach(async () => {
    await truncateAll(tdb);
});

async function createAccount(email = "owner@example.com") {
    const [account] = await tdb.insert(accounts).values({ email }).returning();
    return account;
}

describe("team queries", () => {
    it("creates a team with owner membership and a default API key", async () => {
        const account = await createAccount();

        const team = await createTeam({
            ownerAccountId: account.id,
            name: "Main",
        });

        await expect(getTeamMembership(team.id, account.id)).resolves.toEqual(
            expect.objectContaining({ role: "owner" }),
        );
        await expect(listTeamsForAccount(account.id)).resolves.toEqual([
            expect.objectContaining({ id: team.id, name: "Main" }),
        ]);
        await expect(getApiKeysByTeamId(team.id)).resolves.toEqual([
            expect.objectContaining({ teamId: team.id, name: "Default" }),
        ]);
    });

    it("finds or creates provisioned teams by external id without merging owners", async () => {
        const owner = await findOrCreateBareAccount(
            "OWNER@Example.com",
            "Owner",
        );

        const first = await findOrCreateTeamByExternalId({
            externalId: "consumer:one",
            ownerAccountId: owner.id,
            name: "Tenant One",
        });
        const again = await findOrCreateTeamByExternalId({
            externalId: "consumer:one",
            ownerAccountId: owner.id,
            name: "Renamed",
        });
        const second = await findOrCreateTeamByExternalId({
            externalId: "consumer:two",
            ownerAccountId: owner.id,
            name: "Tenant Two",
        });

        expect(again.id).toBe(first.id);
        expect(again.name).toBe("Tenant One");
        expect(second.id).not.toBe(first.id);
        expect(owner.email).toBe("owner@example.com");
    });

    it("enforces and resets mail quota counters", async () => {
        const { team } = await seedTeamAndContact(tdb, {
            team: {
                dailyMailLimit: 1,
                monthlyMailLimit: 2,
                dailyMailCount: 0,
                monthlyMailCount: 0,
            },
        });

        expect(await hasMailQuotaRemaining(team.id)).toBe(true);
        await incrementMailCount(team.id);
        expect(await hasMailQuotaRemaining(team.id)).toBe(false);

        await tdb
            .update(teams)
            .set({
                countersResetAt: new Date(Date.now() - 31 * 24 * 60 * 60_000),
                dailyMailCount: 100,
                monthlyMailCount: 100,
            })
            .where(eq(teams.id, team.id));

        expect(await hasMailQuotaRemaining(team.id)).toBe(true);
        const [resetTeam] = await tdb
            .select()
            .from(teams)
            .where(eq(teams.id, team.id));
        expect(resetTeam.dailyMailCount).toBe(0);
        expect(resetTeam.monthlyMailCount).toBe(0);
    });
});
