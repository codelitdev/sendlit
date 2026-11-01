import { beforeEach, describe, expect, it, mock, vi } from "bun:test";

const mocks = {
  countMedia: vi.fn(),
  deleteUnusedMedia: vi.fn(),
  getMediaByMediaId: vi.fn(),
  listMedia: vi.fn(),
  listMediaReferences: vi.fn(),
  updateMediaMetadata: vi.fn(),
};

mock.module("../../media/queries", () => ({ ...mocks }));

const { mediaTools } = await import("./media");

const teamKey = {
  authKind: "team_key" as const,
  teamId: "team-1",
  user: null,
  scopes: [],
  requestId: "",
};

const tools = new Map(mediaTools().map((tool) => [tool.name, tool]));

function call(name: string, args: Record<string, unknown>, context: any = teamKey) {
  const tool = tools.get(name);
  if (!tool) throw new Error(`unknown tool ${name}`);
  return tool.handler({ context, args, signal: new AbortController().signal });
}

const row = {
  id: "internal-media-1",
  teamId: "team-1",
  mediaId: "med_1",
  url: "https://cdn.test/p/media-lit/main.webp",
  mediaLitId: "media-lit",
};

beforeEach(() => {
  for (const fn of Object.values(mocks)) fn.mockReset();
});

describe("MCP media tools", () => {
  it("has one titled tool per media operation", () => {
    expect([...tools.keys()]).toEqual([
      "list_media",
      "get_media",
      "update_media",
      "delete_media",
      "list_media_references",
    ]);
    for (const tool of tools.values()) expect(tool.title).toBeTruthy();
    expect((tools.get("delete_media")!.inputSchema as any).shape.confirm).toBeDefined();
  });

  it("lists and updates media within the resolved team", async () => {
    mocks.listMedia.mockResolvedValue([row]);
    mocks.countMedia.mockResolvedValue(1);
    const listed: any = await call("list_media", { query: "hero", page: 2 });
    expect(listed).toMatchObject({
      items: [{ mediaId: "med_1", url: "https://cdn.test/p/media-lit/main.webp" }],
      total: 1,
    });
    expect(listed.items[0]).not.toHaveProperty("id");
    expect(mocks.listMedia).toHaveBeenCalledWith({
      teamId: "team-1",
      query: "hero",
      page: 2,
      pageSize: undefined,
    });
    expect(mocks.countMedia).toHaveBeenCalledWith({ teamId: "team-1", query: "hero" });

    mocks.updateMediaMetadata.mockResolvedValue({ ...row, alt: "Hero" });
    await expect(
      call("update_media", { mediaId: "med_1", alt: "Hero" }),
    ).resolves.toMatchObject({ mediaId: "med_1", alt: "Hero" });
    expect(mocks.updateMediaMetadata).toHaveBeenCalledWith({
      teamId: "team-1",
      mediaId: "med_1",
      alt: "Hero",
      caption: undefined,
    });

    mocks.getMediaByMediaId.mockResolvedValue(null);
    await expect(call("get_media", { mediaId: "med_x" })).resolves.toMatchObject({
      error: { code: "not_found" },
    });
    expect(mocks.getMediaByMediaId).toHaveBeenCalledWith("team-1", "med_x");
  });

  it("blocks deleting in-use media and lists references", async () => {
    mocks.deleteUnusedMedia.mockResolvedValueOnce("in_use");
    await expect(call("delete_media", { mediaId: "med_1" })).resolves.toMatchObject({
      error: { code: "conflict", safeDetails: { reason: "media_in_use" } },
    });
    expect(mocks.deleteUnusedMedia).toHaveBeenCalledWith("team-1", "med_1");

    mocks.deleteUnusedMedia.mockResolvedValueOnce("not_found");
    await expect(call("delete_media", { mediaId: "med_x" })).resolves.toMatchObject({
      error: { code: "not_found" },
    });
    mocks.deleteUnusedMedia.mockResolvedValueOnce("deleted");
    await expect(call("delete_media", { mediaId: "med_1" })).resolves.toEqual({
      message: "Media deleted.",
    });

    mocks.listMediaReferences.mockResolvedValue([
      {
        resourceType: "SEQUENCE_EMAIL",
        resourcePublicId: "email_1",
        parentResourcePublicId: "seq_1",
        internalId: "hidden",
      },
    ]);
    const references: any = await call("list_media_references", { mediaId: "med_1" });
    expect(references.items).toEqual([
      {
        resourceType: "SEQUENCE_EMAIL",
        resourcePublicId: "email_1",
        parentResourcePublicId: "seq_1",
        createdAt: undefined,
        updatedAt: undefined,
      },
    ]);
  });

  it("refuses an OAuth token without media:write", async () => {
    await expect(
      call(
        "delete_media",
        { mediaId: "med_1" },
        { ...teamKey, authKind: "oauth", scopes: ["media:read"] },
      ),
    ).resolves.toMatchObject({
      error: {
        code: "forbidden",
        safeDetails: { reason: "insufficient_scope", requiredScope: "media:write" },
      },
    });
    expect(mocks.deleteUnusedMedia).not.toHaveBeenCalled();
  });
});
