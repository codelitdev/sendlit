import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";

vi.mock("../db/client", async () => {
    const { makeTestDb } = await import("../test/db.js");
    return { db: await makeTestDb() };
});
vi.mock("./service", () => ({
    deleteMedia: vi.fn(),
}));

import { db } from "../db/client";
import { media, mediaReferences, teams } from "../db/schema";
import { seedTeamAndContact, truncateAll, type TestDb } from "../test/db";
import { deleteMedia as deleteMediaFile } from "./service";
import {
    createUploadedMedia,
    deleteTeamMediaFiles,
    deleteUnusedMedia,
    listMediaReferences,
    replaceMediaReferencesForResource,
    updateMediaMetadata,
} from "./queries";

const tdb = db as unknown as TestDb;

beforeEach(async () => {
    await truncateAll(tdb);
    vi.clearAllMocks();
});

describe("media queries", () => {
    it("updates editable media metadata", async () => {
        const { team } = await seedTeamAndContact(tdb);
        const row = await createUploadedMedia({
            teamId: team.id,
            mediaLitId: "media-lit-1",
            url: "https://cdn.test/p/media-lit-1/main.webp",
        });

        const updated = await updateMediaMetadata({
            teamId: team.id,
            mediaId: row.mediaId,
            alt: "Updated alt",
            caption: "Updated caption",
        });

        expect(updated).toMatchObject({
            mediaId: row.mediaId,
            alt: "Updated alt",
            caption: "Updated caption",
        });
    });

    it("blocks deleting media while references exist", async () => {
        const { team } = await seedTeamAndContact(tdb);
        const row = await createUploadedMedia({
            teamId: team.id,
            mediaLitId: "media-lit-1",
            url: "https://cdn.test/p/media-lit-1/main.webp",
        });
        await replaceMediaReferencesForResource({
            teamId: team.id,
            resource: {
                resourceType: "TEMPLATE",
                resourceInternalId: crypto.randomUUID(),
                resourcePublicId: "tpl_123",
            },
            mediaRows: [row],
        });

        await expect(deleteUnusedMedia(team.id, row.mediaId)).resolves.toBe(
            "in_use",
        );
        expect(deleteMediaFile).not.toHaveBeenCalled();
        expect(await tdb.select().from(media)).toHaveLength(1);
    });

    it("deletes unused media from MediaLit and the media table", async () => {
        const { team } = await seedTeamAndContact(tdb);
        const row = await createUploadedMedia({
            teamId: team.id,
            mediaLitId: "media-lit-unused",
            url: "https://cdn.test/p/media-lit-unused/main.webp",
        });

        await expect(deleteUnusedMedia(team.id, row.mediaId)).resolves.toBe(
            "deleted",
        );
        expect(deleteMediaFile).toHaveBeenCalledWith("media-lit-unused");
        expect(await tdb.select().from(media)).toHaveLength(0);
    });

    it("lists public media references", async () => {
        const { team } = await seedTeamAndContact(tdb);
        const row = await createUploadedMedia({
            teamId: team.id,
            mediaLitId: "media-lit-1",
            url: "https://cdn.test/p/media-lit-1/main.webp",
        });
        await replaceMediaReferencesForResource({
            teamId: team.id,
            resource: {
                resourceType: "SEQUENCE_EMAIL",
                resourceInternalId: crypto.randomUUID(),
                resourcePublicId: "email_123",
                parentResourceInternalId: crypto.randomUUID(),
                parentResourcePublicId: "seq_123",
            },
            mediaRows: [row],
        });

        await expect(
            listMediaReferences({ teamId: team.id, mediaId: row.mediaId }),
        ).resolves.toMatchObject([
            {
                mediaId: row.id,
                resourceType: "SEQUENCE_EMAIL",
                resourcePublicId: "email_123",
                parentResourcePublicId: "seq_123",
            },
        ]);
    });

    it("deletes team MediaLit files before team rows cascade away", async () => {
        const { team } = await seedTeamAndContact(tdb);
        const row = await createUploadedMedia({
            teamId: team.id,
            mediaLitId: "media-lit-team",
            url: "https://cdn.test/p/media-lit-team/main.webp",
        });
        await replaceMediaReferencesForResource({
            teamId: team.id,
            resource: {
                resourceType: "TEMPLATE",
                resourceInternalId: crypto.randomUUID(),
                resourcePublicId: "tpl_123",
            },
            mediaRows: [row],
        });

        await deleteTeamMediaFiles(team.id);
        await tdb.delete(teams).where(eq(teams.id, team.id));

        expect(deleteMediaFile).toHaveBeenCalledWith("media-lit-team");
        expect(await tdb.select().from(mediaReferences)).toHaveLength(0);
    });
});
