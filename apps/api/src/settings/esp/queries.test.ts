import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../db/client", async () => {
    const { makeTestDb } = await import("../../test/db.js");
    return { db: await makeTestDb() };
});

import { db } from "../../db/client";
import { seedTeamAndContact, truncateAll, type TestDb } from "../../test/db";
import {
    createEspConfig,
    deleteEspConfig,
    getDecryptedEspCredentials,
    getEspConfigByEspId,
    listEspConfigs,
    recordEspTestResult,
    upsertEspConfig,
} from "./queries";

const tdb = db as unknown as TestDb;

beforeEach(async () => {
    await truncateAll(tdb);
});

describe("ESP config queries", () => {
    it("stores multiple team-owned configurations", async () => {
        const { team } = await seedTeamAndContact(tdb);
        const second = await createEspConfig(team.id, {
            name: "Transactional",
            provider: "smtp",
            host: "transactional.example.com",
            port: 587,
            secure: false,
        });

        const configs = await listEspConfigs(team.id);
        expect(configs).toHaveLength(2);
        expect(second.espId).toMatch(/^esp_/);
        expect(configs).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    espId: second.espId,
                    ownerScope: "team",
                }),
            ]),
        );
    });

    it("encrypts, preserves, and clears SMTP passwords", async () => {
        const { team } = await seedTeamAndContact(tdb);
        const initial = await upsertEspConfig(team.id, {
            provider: "smtp",
            host: "smtp.example.com",
            port: 587,
            secure: false,
            username: "user",
            password: "first-secret",
            fromName: "Sender",
            fromEmail: "sender@example.com",
        });
        expect(initial.encryptedSecret).not.toContain("first-secret");
        await expect(
            getDecryptedEspCredentials(team.id),
        ).resolves.toMatchObject({
            password: "first-secret",
            username: "user",
        });

        await upsertEspConfig(team.id, {
            provider: "smtp",
            host: "smtp2.example.com",
            port: 465,
            secure: true,
            password: "",
        });
        await expect(
            getDecryptedEspCredentials(team.id),
        ).resolves.toMatchObject({
            password: undefined,
            host: "smtp2.example.com",
        });
    });

    it("records a test result and deletes an unused draft", async () => {
        const { team } = await seedTeamAndContact(tdb);
        const draft = await createEspConfig(team.id, {
            name: "Draft",
            provider: "smtp",
            host: "draft.example.com",
            port: 587,
            secure: false,
        });
        await recordEspTestResult(
            team.id,
            "failed",
            "Bad credentials",
            draft.espId,
        );
        await expect(
            getEspConfigByEspId(team.id, draft.espId),
        ).resolves.toMatchObject({
            lastTestStatus: "failed",
            lastTestError: "Bad credentials",
        });
        await expect(deleteEspConfig(team.id, draft.espId)).resolves.toBe(true);
        await expect(
            getEspConfigByEspId(team.id, draft.espId),
        ).resolves.toBeNull();
    });

    it("scopes ESP lookups and deletes to the owning team", async () => {
        const { team: teamA } = await seedTeamAndContact(tdb);
        const { team: teamB } = await seedTeamAndContact(tdb);
        const [espA] = await listEspConfigs(teamA.id);

        await expect(
            getEspConfigByEspId(teamB.id, espA.espId),
        ).resolves.toBeNull();
        await expect(deleteEspConfig(teamB.id, espA.espId)).resolves.toBe(
            false,
        );
    });
});
