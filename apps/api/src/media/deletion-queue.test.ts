import { beforeEach, describe, expect, it, mock, vi } from "bun:test";

const mocks = {
  queueAdd: vi.fn(),
  deleteMedia: vi.fn(),
};

mock.module("../db/client", async () => {
  const { makeTestDb } = await import("../test/db");
  return { db: await makeTestDb() };
});
mock.module("bullmq", () => ({
  Queue: class {
    add = mocks.queueAdd;
  },
}));
mock.module("./service", () => ({ deleteMedia: mocks.deleteMedia }));
const captureError = vi.fn();
const realObservability = await import("../observability");
mock.module("../observability", () => ({ ...realObservability, captureError }));

const { db } = await import("../db/client");
const { media } = await import("../db/schema");
const { seedTeamAndContact, truncateAll } = await import("../test/db");
type TestDb = import("../test/db").TestDb;
const { processMediaDeletionJob, queueMediaLitDeletion } = await import(
  "./deletion-queue"
);
const { createUploadedMedia, deleteTeamMediaFiles } = await import("./queries");

const tdb = db as unknown as TestDb;

beforeEach(async () => {
  await truncateAll(tdb);
  for (const fn of [...Object.values(mocks), captureError]) fn.mockReset();
});

describe("media deletion queue", () => {
  it("queues one job per MediaLit file", async () => {
    await queueMediaLitDeletion({ teamId: "team-1", mediaLitId: "lit-1" });

    expect(mocks.queueAdd).toHaveBeenCalledWith(
      "delete-medialit-file",
      { teamId: "team-1", mediaLitId: "lit-1" },
      { jobId: "medialit-lit-1" },
    );
  });

  it("retries a failed MediaLit delete until nothing is orphaned", async () => {
    const { team } = await seedTeamAndContact(tdb);
    await createUploadedMedia({
      teamId: team.id,
      mediaLitId: "lit-down",
      url: "https://cdn.test/p/lit-down/main.webp",
    });
    mocks.deleteMedia.mockRejectedValueOnce(new Error("medialit down"));

    await expect(deleteTeamMediaFiles(team.id)).resolves.toEqual({
      deleted: 1,
      failed: 1,
    });
    expect(captureError).toHaveBeenCalledTimes(1);
    const [, data] = mocks.queueAdd.mock.calls[0];

    // MediaLit is back: the retry deletes the file.
    await expect(processMediaDeletionJob({ data })).resolves.toBe("deleted");
    expect(mocks.deleteMedia.mock.calls).toEqual([["lit-down"], ["lit-down"]]);
    expect(await tdb.select().from(media)).toHaveLength(0);
  });

  it("rethrows a MediaLit failure so the job is retried", async () => {
    mocks.deleteMedia.mockRejectedValueOnce(new Error("medialit down"));

    await expect(
      processMediaDeletionJob({ data: { teamId: "team-1", mediaLitId: "lit-1" } }),
    ).rejects.toThrow("medialit down");
  });

  it("skips a file that is in use again", async () => {
    const { team } = await seedTeamAndContact(tdb);
    await createUploadedMedia({
      teamId: team.id,
      mediaLitId: "lit-reused",
      url: "https://cdn.test/p/lit-reused/main.webp",
    });

    await expect(
      processMediaDeletionJob({ data: { teamId: team.id, mediaLitId: "lit-reused" } }),
    ).resolves.toBe("in_use");
    expect(mocks.deleteMedia).not.toHaveBeenCalled();
  });
});
