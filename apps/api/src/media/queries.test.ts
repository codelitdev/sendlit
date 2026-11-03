import { beforeEach, describe, expect, it, mock, vi } from "bun:test";

mock.module("../db/client", async () => {
  const { makeTestDb } = await import("../test/db");
  return { db: await makeTestDb() };
});
mock.module("./service", () => ({
  deleteMedia: vi.fn(),
}));
const queueMediaLitDeletion = vi.fn();
mock.module("./deletion-queue", () => ({ queueMediaLitDeletion }));
const captureError = vi.fn();
const realObservability = await import("../observability");
mock.module("../observability", () => ({ ...realObservability, captureError }));

const { db } = await import("../db/client");
const { emailContentVersions, media, mediaReferences, sequenceEmails, sequences } =
  await import("../db/schema");
const { seedTeamAndContact, truncateAll } = await import("../test/db");
type TestDb = import("../test/db").TestDb;
const {
  createUploadedMedia,
  deleteMediaReferencesForResource,
  deleteOrphanedMedia,
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

  it("queues a file MediaLit fails to delete and still deletes its row", async () => {
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
      deleted: 2,
      failed: 1,
    });
    expect(await tdb.select().from(media)).toHaveLength(0);
    expect(queueMediaLitDeletion).toHaveBeenCalledWith({
      teamId: team.id,
      mediaLitId: "media-lit-fails",
    });
    expect(captureError).toHaveBeenCalledWith(
      expect.objectContaining({
        source: "media.delete_team_files",
        context: { error_code: "medialit_delete_failed" },
      }),
    );
    (deleteMediaFile as ReturnType<typeof vi.fn>).mockReset();
  });

  it("keeps a file another team also uses when purging a team", async () => {
    const { team } = await seedTeamAndContact(tdb);
    const { team: otherTeam } = await seedTeamAndContact(tdb);
    for (const teamId of [team.id, otherTeam.id]) {
      await createUploadedMedia({
        teamId,
        mediaLitId: "media-lit-both",
        url: "https://cdn.test/p/media-lit-both/main.webp",
      });
    }

    await expect(deleteTeamMediaFiles(team.id)).resolves.toEqual({
      deleted: 1,
      failed: 0,
    });
    expect(deleteMediaFile).not.toHaveBeenCalled();
    const rows = await tdb.select().from(media);
    expect(rows.map((row) => row.teamId)).toEqual([otherTeam.id]);
  });
});

describe("deleteOrphanedMedia", () => {
  async function referencedMedia(teamId: string, mediaLitId: string) {
    const row = await createUploadedMedia({
      teamId,
      mediaLitId,
      url: `https://cdn.test/p/${mediaLitId}/main.webp`,
    });
    const resourceInternalId = crypto.randomUUID();
    await replaceMediaReferencesForResource({
      teamId,
      resource: {
        resourceType: "TEMPLATE",
        resourceInternalId,
        resourcePublicId: "tpl_1",
      },
      mediaRows: [row],
    });
    return { row, resourceInternalId };
  }

  it("deletes only media left without references", async () => {
    const { team } = await seedTeamAndContact(tdb);
    const released = await referencedMedia(team.id, "media-lit-released");
    const kept = await referencedMedia(team.id, "media-lit-kept");

    const mediaIds = await deleteMediaReferencesForResource({
      teamId: team.id,
      resourceType: "TEMPLATE",
      resourceInternalId: released.resourceInternalId,
    });
    expect(mediaIds).toEqual([released.row.id]);

    await expect(
      deleteOrphanedMedia(team.id, [released.row.id, kept.row.id]),
    ).resolves.toEqual({ deleted: 1, failed: 0 });
    expect((deleteMediaFile as ReturnType<typeof vi.fn>).mock.calls).toEqual([
      ["media-lit-released"],
    ]);
    expect((await tdb.select().from(media)).map((row) => row.mediaLitId)).toEqual([
      "media-lit-kept",
    ]);
  });

  it("keeps media that sent mail shows", async () => {
    const { team } = await seedTeamAndContact(tdb);
    const { row, resourceInternalId } = await referencedMedia(
      team.id,
      "media-lit-sent",
    );
    const [sequence] = await tdb
      .insert(sequences)
      .values({ teamId: team.id, type: "broadcast" })
      .returning();
    const content = {
      content: [
        {
          blockType: "image",
          settings: { src: "https://cdn.test/p/media-lit-sent/main.webp" },
        },
      ],
    };
    const [email] = await tdb
      .insert(sequenceEmails)
      .values({ sequenceId: sequence.id, subject: "Sent", content })
      .returning();
    await tdb.insert(emailContentVersions).values({
      teamId: team.id,
      sequenceEmailId: email.id,
      contentHash: "hash",
      subject: "Sent",
      content,
    });
    await deleteMediaReferencesForResource({
      teamId: team.id,
      resourceType: "TEMPLATE",
      resourceInternalId,
    });

    await expect(deleteOrphanedMedia(team.id, [row.id])).resolves.toEqual({
      deleted: 0,
      failed: 0,
    });
    expect(deleteMediaFile).not.toHaveBeenCalled();
    expect(await tdb.select().from(media)).toHaveLength(1);
  });

  it("ignores another team's media ids", async () => {
    const { team } = await seedTeamAndContact(tdb);
    const { team: otherTeam } = await seedTeamAndContact(tdb);
    const other = await createUploadedMedia({
      teamId: otherTeam.id,
      mediaLitId: "media-lit-other-team",
      url: "https://cdn.test/p/media-lit-other-team/main.webp",
    });

    await expect(deleteOrphanedMedia(team.id, [other.id])).resolves.toEqual({
      deleted: 0,
      failed: 0,
    });
    expect(deleteMediaFile).not.toHaveBeenCalled();
    expect(await tdb.select().from(media)).toHaveLength(1);
  });

  it("queues the MediaLit delete when MediaLit fails, leaving no row behind", async () => {
    const { team } = await seedTeamAndContact(tdb);
    const { row, resourceInternalId } = await referencedMedia(
      team.id,
      "media-lit-down",
    );
    await deleteMediaReferencesForResource({
      teamId: team.id,
      resourceType: "TEMPLATE",
      resourceInternalId,
    });
    (deleteMediaFile as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("medialit down"),
    );

    await expect(deleteOrphanedMedia(team.id, [row.id])).resolves.toEqual({
      deleted: 1,
      failed: 1,
    });
    expect(await tdb.select().from(media)).toHaveLength(0);
    expect(queueMediaLitDeletion).toHaveBeenCalledWith({
      teamId: team.id,
      mediaLitId: "media-lit-down",
    });
    expect(captureError).toHaveBeenCalledWith(
      expect.objectContaining({
        source: "media.delete_orphaned",
        teamId: team.id,
        context: { error_code: "medialit_delete_failed" },
      }),
    );
  });
});
