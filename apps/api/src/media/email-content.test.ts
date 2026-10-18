import { beforeEach, describe, expect, it, mock, vi } from "bun:test";
import type { Email } from "@sendlit/email-editor";
import { defaultEmail } from "@sendlit/email-editor";
import { eq } from "drizzle-orm";

mock.module("../db/client", async () => {
  const { makeTestDb } = await import("../test/db");
  return { db: await makeTestDb() };
});
mock.module("./service", () => ({
  sealMedia: vi.fn((mediaLitId: string) =>
    Promise.resolve({
      mediaLitId,
      file: `https://cdn.test/p/${mediaLitId}/main.webp`,
      fileName: `${mediaLitId}.webp`,
      mimeType: "image/webp",
    }),
  ),
  deleteMedia: vi.fn(),
}));

const { db } = await import("../db/client");
const { media, mediaReferences } = await import("../db/schema");
const { seedTeamAndContact, truncateAll } = await import("../test/db");
type TestDb = import("../test/db").TestDb;
const { extractMediaLitImagesFromEmailContent, syncEmailContentMediaReferences } =
  await import("./email-content");
const { deleteMedia, sealMedia } = await import("./service");

const tdb = db as unknown as TestDb;

function emailWithImage(settings: Record<string, unknown>): Email {
  return {
    ...defaultEmail,
    content: [
      {
        blockType: "image",
        settings,
      },
    ],
  };
}

beforeEach(async () => {
  await truncateAll(tdb);
  vi.clearAllMocks();
});

describe("email content media reference sync", () => {
  it("extracts MediaLit ids embedded in image URLs only", () => {
    const images = extractMediaLitImagesFromEmailContent(
      emailWithImage({
        mediaId: "ignored-editor-agnostic-id",
        src: "https://cdn.test/i/url-media/main.webp?signature=abc",
        alt: "Hero",
      }),
    );

    expect(images).toEqual([
      {
        mediaLitId: "url-media",
        src: "https://cdn.test/i/url-media/main.webp?signature=abc",
        alt: "Hero",
      },
    ]);
  });

  it("seals new MediaLit URLs, creates media rows, and stores references", async () => {
    const { team } = await seedTeamAndContact(tdb);
    const resourceInternalId = crypto.randomUUID();
    const reconciled = await syncEmailContentMediaReferences({
      teamId: team.id,
      content: emailWithImage({
        src: "https://cdn.test/i/new-media/main.webp?signature=abc",
        alt: "Hero",
      }),
      resource: {
        resourceType: "TEMPLATE",
        resourceInternalId,
        resourcePublicId: "tpl_123",
      },
    });

    expect(sealMedia).toHaveBeenCalledWith("new-media");
    expect(deleteMedia).not.toHaveBeenCalled();
    expect(reconciled?.content[0].settings).toMatchObject({
      src: "https://cdn.test/p/new-media/main.webp",
      alt: "Hero",
    });

    const [mediaRow] = await tdb.select().from(media);
    expect(mediaRow).toMatchObject({
      teamId: team.id,
      mediaLitId: "new-media",
      url: "https://cdn.test/p/new-media/main.webp",
      fileName: "new-media.webp",
      mimeType: "image/webp",
      alt: "Hero",
    });

    const [reference] = await tdb.select().from(mediaReferences);
    expect(reference).toMatchObject({
      teamId: team.id,
      mediaId: mediaRow.id,
      resourceType: "TEMPLATE",
      resourceInternalId,
      resourcePublicId: "tpl_123",
    });
  });

  it("replaces this resource's references without deleting MediaLit files", async () => {
    const { team } = await seedTeamAndContact(tdb);
    const resourceInternalId = crypto.randomUUID();

    await syncEmailContentMediaReferences({
      teamId: team.id,
      content: emailWithImage({
        src: "https://cdn.test/i/removed-media/main.webp?signature=abc",
      }),
      resource: {
        resourceType: "TEMPLATE",
        resourceInternalId,
        resourcePublicId: "tpl_123",
      },
    });
    vi.clearAllMocks();

    await syncEmailContentMediaReferences({
      teamId: team.id,
      content: defaultEmail,
      resource: {
        resourceType: "TEMPLATE",
        resourceInternalId,
        resourcePublicId: "tpl_123",
      },
    });

    expect(deleteMedia).not.toHaveBeenCalled();
    expect(sealMedia).not.toHaveBeenCalled();
    expect(await tdb.select().from(media)).toHaveLength(1);
    expect(
      await tdb
        .select()
        .from(mediaReferences)
        .where(eq(mediaReferences.resourceInternalId, resourceInternalId)),
    ).toHaveLength(0);
  });
});
