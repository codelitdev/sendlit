import { beforeEach, describe, expect, it, vi } from "vitest";
import {
    defaultEmail as editorDefaultEmail,
    type Email,
} from "@sendlit/email-editor";
import { createFooterEmailBlock } from "@sendlit/email-blocks/footer";
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
import { emailTemplates, media, mediaReferences } from "../db/schema";
import { deleteMedia, sealMedia } from "../media/service";
import { seedTeamAndContact, truncateAll, type TestDb } from "../test/db";
import {
    createTemplate,
    deleteTemplate,
    duplicateTemplate,
    getTemplate,
    listTemplates,
    resolveStartingTemplate,
    updateTemplate,
} from "./queries";

const tdb = db as unknown as TestDb;
const defaultEmail: Email = {
    ...editorDefaultEmail,
    content: [...editorDefaultEmail.content, createFooterEmailBlock()],
};

beforeEach(async () => {
    await truncateAll(tdb);
    vi.clearAllMocks();
});

function emailWithImage(mediaId: string): Email {
    return {
        ...defaultEmail,
        content: [
            ...defaultEmail.content.slice(0, -1),
            {
                blockType: "image",
                settings: {
                    src: `https://cdn.test/i/${mediaId}/main.webp?signature=abc`,
                    alt: "Hero",
                },
            },
            defaultEmail.content.at(-1)!,
        ],
    };
}

describe("template queries", () => {
    it("persists, filters, and discovers requirements by purpose", async () => {
        const { team } = await seedTeamAndContact(tdb);
        const marketing = await createTemplate({
            teamId: team.id,
            title: "Campaign",
            purpose: "marketing",
            content: defaultEmail,
        });
        const transactional = await createTemplate({
            teamId: team.id,
            title: "OTP",
            purpose: "transactional",
            content: {
                ...editorDefaultEmail,
                content: [
                    {
                        blockType: "text",
                        settings: {
                            content:
                                "{{ customer.name }} {{ otp }} {{ optional | default: 'none' }}",
                        },
                    },
                ],
            },
        });

        expect(marketing).toMatchObject({
            purpose: "marketing",
            requiredVariables: [],
        });
        expect(transactional).toMatchObject({
            purpose: "transactional",
            requiredVariables: ["customer.name", "otp"],
        });
        expect(await listTemplates(team.id, "marketing")).toHaveLength(1);
        expect(await listTemplates(team.id, "transactional")).toHaveLength(1);
    });

    it("lists a retired pre-footer template without failing the whole hub", async () => {
        const { team } = await seedTeamAndContact(tdb);
        const [legacy] = await tdb
            .insert(emailTemplates)
            .values({
                teamId: team.id,
                title: "Legacy campaign",
                purpose: "marketing",
                content: editorDefaultEmail,
            })
            .returning();

        await expect(listTemplates(team.id)).resolves.toEqual([
            expect.objectContaining({
                title: "Legacy campaign",
                requiredVariables: [],
                validationError: "footer_required",
            }),
        ]);

        await deleteTemplate(team.id, legacy.templateId);
        await expect(listTemplates(team.id)).resolves.toEqual([]);
    });

    it("rejects invalid purpose values at the database boundary", async () => {
        const { team } = await seedTeamAndContact(tdb);

        await expect(
            db.insert(emailTemplates).values({
                teamId: team.id,
                title: "Invalid",
                purpose: "bulk" as any,
                content: defaultEmail,
            }),
        ).rejects.toThrow();
    });

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
            resolveStartingTemplate(
                one.team.id,
                template.templateId,
                "marketing",
            ),
        ).resolves.toMatchObject({ title: "Owned" });
        await expect(
            resolveStartingTemplate(
                two.team.id,
                template.templateId,
                "marketing",
            ),
        ).resolves.toBeNull();
        await expect(
            resolveStartingTemplate(
                one.team.id,
                template.templateId,
                "transactional",
            ),
        ).rejects.toThrow("template_not_transactional");
    });

    it("duplicates within the source purpose without mutating the source", async () => {
        const { team } = await seedTeamAndContact(tdb);
        const transactional = await createTemplate({
            teamId: team.id,
            title: "Receipt",
            purpose: "transactional",
            content: {
                ...editorDefaultEmail,
                content: [
                    {
                        blockType: "text",
                        settings: { content: "Receipt {{ order.id }}" },
                    },
                ],
            },
        });

        const duplicate = await duplicateTemplate({
            teamId: team.id,
            templateId: transactional.templateId,
        });

        expect(duplicate).toMatchObject({
            purpose: "transactional",
            title: "Receipt (Copy)",
        });
        expect(duplicate?.content).toEqual(transactional.content);
        expect((await getTemplate(transactional.templateId))?.purpose).toBe(
            "transactional",
        );
    });

    it("reconciles media references for the duplicated template", async () => {
        const { team } = await seedTeamAndContact(tdb);
        const source = await createTemplate({
            teamId: team.id,
            title: "Campaign with image",
            purpose: "marketing",
            content: emailWithImage("duplicated-media"),
        });

        const duplicate = await duplicateTemplate({
            teamId: team.id,
            templateId: source.templateId,
        });

        const references = await tdb
            .select()
            .from(mediaReferences)
            .where(eq(mediaReferences.resourceType, "TEMPLATE"));
        expect(references).toHaveLength(2);
        expect(
            new Set(references.map((reference) => reference.mediaId)).size,
        ).toBe(1);
        expect(
            new Set(references.map((reference) => reference.resourcePublicId)),
        ).toEqual(new Set([source.templateId, duplicate?.templateId]));
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
