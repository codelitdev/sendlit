import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../db/client", async () => {
    const { makeTestDb } = await import("../../test/db.js");
    return { db: await makeTestDb() };
});

import { db } from "../../db/client";
import { seedTeamAndContact, truncateAll, type TestDb } from "../../test/db";
import {
    deleteEspConfig,
    getDecryptedEspCredentials,
    getEspConfig,
    recordEspTestResult,
    upsertEspConfig,
} from "./queries";

const tdb = db as unknown as TestDb;

beforeEach(async () => {
    await truncateAll(tdb);
});

describe("ESP config queries", () => {
    it("encrypts, preserves, rotates, and clears SMTP passwords", async () => {
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

        const preserved = await upsertEspConfig(team.id, {
            provider: "smtp",
            host: "smtp2.example.com",
            port: 465,
            secure: true,
            username: "user2",
        });
        expect(preserved.encryptedSecret).toBe(initial.encryptedSecret);
        await expect(
            getDecryptedEspCredentials(team.id),
        ).resolves.toMatchObject({
            password: "first-secret",
            host: "smtp2.example.com",
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
        ).resolves.toMatchObject({ password: undefined });
    });

    it("records test-send status and deletes configs by team", async () => {
        const { team } = await seedTeamAndContact(tdb);
        await upsertEspConfig(team.id, {
            provider: "smtp",
            host: "smtp.example.com",
            port: 587,
            secure: false,
        });

        await recordEspTestResult(team.id, "failed", "Bad credentials");
        await expect(getEspConfig(team.id)).resolves.toMatchObject({
            lastTestStatus: "failed",
            lastTestError: "Bad credentials",
        });

        await deleteEspConfig(team.id);
        await expect(getEspConfig(team.id)).resolves.toBeNull();
    });
});
