import { beforeEach, describe, expect, it, mock, vi } from "bun:test";

mock.module("../db/client", async () => {
  const { makeTestDb } = await import("../test/db");
  return { db: await makeTestDb() };
});
mock.module("./service", () => ({
  deleteMedia: vi.fn(),
}));

const { db } = await import("../db/client");
const { media, mediaReferences } = await import("../db/schema");
const { seedTeamAndContact, truncateAll } = await import("../test/db");
type TestDb = import("../test/db").TestDb;
const {
  createUploadedMedia,
  deleteTeamMediaFiles,
  deleteUnusedMedia,
  listMediaReferences,
  replaceMediaReferencesForResource,
  updateMediaMetadata,
} = await import("./queries");
const { deleteMedia: deleteMediaFile } = await import("./service");

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

    await expect(deleteUnusedMedia(team.id, row.mediaId)).resolves.toBe("in_use");
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

    await expect(deleteUnusedMedia(team.id, row.mediaId)).resolves.toBe("deleted");
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

  it("deletes a team's MediaLit files and their media rows", async () => {
    const { team } = await seedTeamAndContact(tdb);
    const { team: otherTeam } = await seedTeamAndContact(tdb);
    const row = await createUploadedMedia({
      teamId: team.id,
      mediaLitId: "media-lit-team",
      url: "https://cdn.test/p/media-lit-team/main.webp",
    });
    await createUploadedMedia({
      teamId: otherTeam.id,
      mediaLitId: "media-lit-other",
      url: "https://cdn.test/p/media-lit-other/main.webp",
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

    await expect(deleteTeamMediaFiles(team.id)).resolves.toEqual({
      deleted: 1,
      failed: 0,
    });

    expect((deleteMediaFile as ReturnType<typeof vi.fn>).mock.calls).toEqual([
      ["media-lit-team"],
    ]);
    expect(await tdb.select().from(mediaReferences)).toHaveLength(0);
    expect((await tdb.select().from(media)).map((item) => item.mediaLitId)).toEqual([
      "media-lit-other",
    ]);
  });

  it("keeps the media row of a file MediaLit fails to delete", async () => {
    const { team } = await seedTeamAndContact(tdb);
    await createUploadedMedia({
      teamId: team.id,
      mediaLitId: "media-lit-fails",
      url: "https://cdn.test/p/media-lit-fails/main.webp",
    });
    await createUploadedMedia({
      teamId: team.id,
      mediaLitId: "media-lit-ok",
      url: "https://cdn.test/p/media-lit-ok/main.webp",
    });
    (deleteMediaFile as ReturnType<typeof vi.fn>).mockImplementation(
      async (id: string) => {
        if (id === "media-lit-fails") throw new Error("medialit down");
      },
    );

    await expect(deleteTeamMediaFiles(team.id)).resolves.toEqual({
      deleted: 1,
      failed: 1,
    });
    expect((await tdb.select().from(media)).map((item) => item.mediaLitId)).toEqual([
      "media-lit-fails",
    ]);
    (deleteMediaFile as ReturnType<typeof vi.fn>).mockReset();
  });
});
