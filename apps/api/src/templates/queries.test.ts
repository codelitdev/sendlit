import { beforeEach, describe, expect, it, vi } from "vitest";
import { defaultEmail, type Email } from "@sendlit/email-editor";
import { eq } from "drizzle-orm";

vi.mock("../db/client", async () => {
    const { makeTestDb } = await import("../test/db.js");
    return { db: await makeTestDb() };
});
vi.mock("../media/service", () => ({
    sealMedia: vi.fn((mediaId: string) =>
        Promise.resolve({
            mediaId,
            file: `https://cdn.test/p/${mediaId}/main.webp`,
        }),
    ),
    deleteMedia: vi.fn(),
}));

import { db } from "../db/client";
import { media, mediaReferences } from "../db/schema";
import { deleteMedia, sealMedia } from "../media/service";
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
    vi.clearAllMocks();
});

function emailWithImage(mediaId: string): Email {
    return {
        ...defaultEmail,
        content: [
            ...defaultEmail.content,
            {
                blockType: "image",
                settings: {
                    src: `https://cdn.test/i/${mediaId}/main.webp?signature=abc`,
                    alt: "Hero",
                },
            },
        ],
    };
}

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

    it("seals image media and stores references when a template image block is added", async () => {
        const { team } = await seedTeamAndContact(tdb);
        const template = await createTemplate({
            teamId: team.id,
            title: "Media template",
            content: defaultEmail,
        });

        await updateTemplate({
            teamId: team.id,
            templateId: template.templateId,
            content: emailWithImage("template-added-media"),
        });

        expect(sealMedia).toHaveBeenCalledWith("template-added-media");
        expect(deleteMedia).not.toHaveBeenCalled();

        const [mediaRow] = await tdb.select().from(media);
        expect(mediaRow).toMatchObject({
            teamId: team.id,
            mediaLitId: "template-added-media",
            url: "https://cdn.test/p/template-added-media/main.webp",
        });

        const [reference] = await tdb.select().from(mediaReferences);
        expect(reference).toMatchObject({
            teamId: team.id,
            mediaId: mediaRow.id,
            resourceType: "TEMPLATE",
            resourceInternalId: template.id,
            resourcePublicId: template.templateId,
        });
    });

    it("removes only the template reference when an image block is removed", async () => {
        const { team } = await seedTeamAndContact(tdb);
        const template = await createTemplate({
            teamId: team.id,
            title: "Media template",
            content: emailWithImage("template-removed-media"),
        });
        vi.clearAllMocks();

        await updateTemplate({
            teamId: team.id,
            templateId: template.templateId,
            content: defaultEmail,
        });

        expect(deleteMedia).not.toHaveBeenCalled();
        expect(sealMedia).not.toHaveBeenCalled();
        expect(await tdb.select().from(media)).toHaveLength(1);
        expect(
            await tdb
                .select()
                .from(mediaReferences)
                .where(eq(mediaReferences.resourceInternalId, template.id)),
        ).toHaveLength(0);
    });

    it("removes only template media references when a template is deleted", async () => {
        const { team } = await seedTeamAndContact(tdb);
        const template = await createTemplate({
            teamId: team.id,
            title: "Media template",
            content: emailWithImage("template-deleted-media"),
        });
        vi.clearAllMocks();

        await deleteTemplate(team.id, template.templateId);

        expect(deleteMedia).not.toHaveBeenCalled();
        expect(sealMedia).not.toHaveBeenCalled();
        expect(await tdb.select().from(media)).toHaveLength(1);
        expect(
            await tdb
                .select()
                .from(mediaReferences)
                .where(eq(mediaReferences.resourceInternalId, template.id)),
        ).toHaveLength(0);
    });
});
