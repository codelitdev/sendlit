import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db/client", async () => {
    const { makeTestDb } = await import("../test/db.js");
    return { db: await makeTestDb() };
});

import { db } from "../db/client";
import { seedTeamAndContact, truncateAll, type TestDb } from "../test/db";
import {
    createEspConfig,
    getEspConfigByEspId,
    recordEspTestResult,
    transitionEspConfig,
} from "../settings/esp/queries";
import { updateTeamDeliverySource } from "./queries";

const tdb = db as unknown as TestDb;

beforeEach(async () => {
    await truncateAll(tdb);
});

describe("updateTeamDeliverySource", () => {
    it("distinguishes an inactive team ESP from an ESP outside the team", async () => {
        const { team } = await seedTeamAndContact(tdb);
        const draft = await createEspConfig(team.id, {
            name: "Marketing",
            provider: "smtp",
            host: "smtp.example.com",
            port: 587,
            secure: false,
            fromEmail: "marketing@example.com",
        });

        await expect(
            updateTeamDeliverySource(team.id, {
                type: "team",
                espId: draft.espId,
            }),
        ).rejects.toThrow("esp_not_active");

        await recordEspTestResult(team.id, "success", undefined, draft.espId);
        const verified = await transitionEspConfig(
            (await getEspConfigByEspId(team.id, draft.espId))!,
            "activate",
        );

        await expect(
            updateTeamDeliverySource(team.id, {
                type: "team",
                espId: verified.espId,
            }),
        ).resolves.toMatchObject({
            defaultTeamEspId: verified.espId,
        });
    });
});
