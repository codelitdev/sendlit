import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../db/client", async () => {
    const { makeTestDb } = await import("../../test/db.js");
    return { db: await makeTestDb() };
});

import { db } from "../../db/client";
import * as schema from "../../db/schema";
import { seedTeamAndContact, truncateAll, type TestDb } from "../../test/db";
import {
    createEspConfig,
    deleteEspConfig,
    getDecryptedEspCredentials,
    getEspConfig,
    getEspConfigByEspId,
    listEspConfigs,
    recordEspTestResult,
    updateEspConfig,
    upsertEspConfig,
} from "./queries";

const tdb = db as unknown as TestDb;

beforeEach(async () => {
    await truncateAll(tdb);
});

describe("ESP config queries", () => {
    it("stores multiple configs and maintains one team default", async () => {
        const { team } = await seedTeamAndContact(tdb);
        await deleteEspConfig(team.id);

        const first = await createEspConfig(team.id, {
            name: "Marketing",
            provider: "smtp",
            host: "marketing.example.com",
            port: 587,
            secure: false,
        });
        const second = await createEspConfig(team.id, {
            name: "Transactional",
            provider: "smtp",
            host: "transactional.example.com",
            port: 587,
            secure: false,
        });

        expect(first.isDefault).toBe(true);
        expect(second.isDefault).toBe(false);
        expect(first.espId).toMatch(/^esp_/);
        await updateEspConfig(team.id, second.espId, { isDefault: true });

        const configs = await listEspConfigs(team.id);
        expect(configs).toHaveLength(2);
        expect(configs.find((config) => config.isDefault)?.espId).toBe(
            second.espId,
        );
    });

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

    it("promotes another user ESP when the default is deleted", async () => {
        const { team } = await seedTeamAndContact(tdb);
        const [existingDefault] = await listEspConfigs(team.id);
        const second = await createEspConfig(team.id, {
            name: "Backup",
            provider: "smtp",
            host: "backup.example.com",
            port: 587,
            secure: false,
        });
        expect(second.isDefault).toBe(false);

        await deleteEspConfig(team.id, existingDefault.espId);

        const remaining = await getEspConfigByEspId(team.id, second.espId);
        expect(remaining?.isDefault).toBe(true);
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
        await expect(
            getEspConfigByEspId(teamA.id, espA.espId),
        ).resolves.not.toBeNull();
    });

    it("rejects deleting an ESP referenced by an active sequence", async () => {
        const { team } = await seedTeamAndContact(tdb);
        const [esp] = await listEspConfigs(team.id);

        await tdb.insert(schema.sequences).values({
            teamId: team.id,
            type: "sequence",
            status: "active",
            deliveryRoute: "custom",
            outboxId: esp.id,
            title: "Active sequence",
        });

        await expect(deleteEspConfig(team.id, esp.espId)).rejects.toThrow(
            "esp_in_use",
        );
    });

    it("rejects deleting an ESP referenced by a queued transactional email", async () => {
        const { team } = await seedTeamAndContact(tdb);
        const [esp] = await listEspConfigs(team.id);

        await tdb.insert(schema.transactionalEmails).values({
            teamId: team.id,
            deliveryRoute: "custom",
            outboxId: esp.id,
            toEmail: "reader@example.com",
            subject: "Hi",
            html: "<p>hi</p>",
            status: "queued",
        });

        await expect(deleteEspConfig(team.id, esp.espId)).rejects.toThrow(
            "esp_in_use",
        );
    });

    it("allows deleting an ESP once only terminal transactional records reference it", async () => {
        const { team } = await seedTeamAndContact(tdb);
        const [esp] = await listEspConfigs(team.id);

        await tdb.insert(schema.transactionalEmails).values({
            teamId: team.id,
            deliveryRoute: "custom",
            outboxId: esp.id,
            toEmail: "reader@example.com",
            subject: "Hi",
            html: "<p>hi</p>",
            status: "sent",
        });

        await expect(deleteEspConfig(team.id, esp.espId)).resolves.toBe(true);
    });
});
