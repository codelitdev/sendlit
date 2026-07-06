import { beforeEach, describe, expect, it, vi } from "vitest";
import { defaultEmail } from "@sendlit/email-editor";

vi.mock("../db/client", async () => {
    const { makeTestDb } = await import("../test/db.js");
    return { db: await makeTestDb() };
});

import { db } from "../db/client";
import { seedTeamAndContact, truncateAll, type TestDb } from "../test/db";
import {
    createTemplate,
    deleteTemplate,
    listTemplates,
    resolveStartingTemplate,
    updateTemplate,
} from "./queries";

const tdb = db as unknown as TestDb;

beforeEach(async () => {
    await truncateAll(tdb);
});

describe("template queries", () => {
    it("deduplicates template titles within a team only", async () => {
        const one = await seedTeamAndContact(tdb);
        const two = await seedTeamAndContact(tdb);

        const first = await createTemplate({
            teamId: one.team.id,
            title: "Welcome",
            content: defaultEmail,
        });
        const second = await createTemplate({
            teamId: one.team.id,
            title: "Welcome",
            content: defaultEmail,
        });
        const otherTeam = await createTemplate({
            teamId: two.team.id,
            title: "Welcome",
            content: defaultEmail,
        });

        expect(first.title).toBe("Welcome");
        expect(second.title).toBe("Welcome (1)");
        expect(otherTeam.title).toBe("Welcome");
        expect(await listTemplates(one.team.id)).toHaveLength(2);
    });

    it("resolves only system templates or templates owned by the team", async () => {
        const one = await seedTeamAndContact(tdb);
        const two = await seedTeamAndContact(tdb);
        const template = await createTemplate({
            teamId: one.team.id,
            title: "Owned",
            content: defaultEmail,
        });

        await expect(
            resolveStartingTemplate(one.team.id, template.templateId),
        ).resolves.toMatchObject({ title: "Owned" });
        await expect(
            resolveStartingTemplate(two.team.id, template.templateId),
        ).resolves.toBeNull();
    });

    it("blocks duplicate renames and scopes updates/deletes by team", async () => {
        const one = await seedTeamAndContact(tdb);
        const two = await seedTeamAndContact(tdb);
        const first = await createTemplate({
            teamId: one.team.id,
            title: "First",
            content: defaultEmail,
        });
        await createTemplate({
            teamId: one.team.id,
            title: "Second",
            content: defaultEmail,
        });

        await expect(
            updateTemplate({
                teamId: one.team.id,
                templateId: first.templateId,
                title: "Second",
            }),
        ).rejects.toThrow("duplicate_title");
        await expect(
            updateTemplate({
                teamId: two.team.id,
                templateId: first.templateId,
                title: "Wrong tenant",
            }),
        ).resolves.toBeNull();

        await deleteTemplate(two.team.id, first.templateId);
        expect(await listTemplates(one.team.id)).toHaveLength(2);
        await deleteTemplate(one.team.id, first.templateId);
        expect(await listTemplates(one.team.id)).toHaveLength(1);
    });
});
