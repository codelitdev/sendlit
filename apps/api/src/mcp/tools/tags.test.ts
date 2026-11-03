import { beforeEach, describe, expect, it, mock, vi } from "bun:test";

const mocks = {
  listTags: vi.fn(),
  getTagReferences: vi.fn(),
  renameTag: vi.fn(),
  deleteTag: vi.fn(),
};
mock.module("../../contacts/tags-queries", () => mocks);

const { tagTools } = await import("./tags");

const signal = new AbortController().signal;
const context = {
  authKind: "team_key" as const,
  teamId: "team-1",
  user: null,
  scopes: [] as string[],
  requestId: "",
};
const tools = new Map(tagTools().map((tool) => [tool.name, tool]));
function call(name: string, args: unknown, ctx: any = context): Promise<any> {
  return tools.get(name)!.handler({ context: ctx, args, signal });
}

beforeEach(() => {
  for (const fn of Object.values(mocks)) fn.mockReset();
});

describe("MCP tag tools", () => {
  it("has one titled tool per tag operation", () => {
    expect([...tools.keys()]).toEqual([
      "list_tags",
      "get_tag_references",
      "rename_tag",
      "delete_tag",
    ]);
    for (const tool of tools.values()) expect(tool.title).toBeTruthy();
    expect(tools.get("list_tags")!.risk).toBe("read");
    expect(tools.get("rename_tag")!.risk).toBe("write");
    expect(tools.get("delete_tag")!.risk).toBe("destructive");
    expect(Object.keys((tools.get("delete_tag")!.inputSchema as any).shape)).toContain(
      "confirm",
    );
  });

  it("lists and inspects the team's tags", async () => {
    mocks.listTags.mockResolvedValue([{ tag: "vip", contacts: 2 }]);
    await expect(call("list_tags", {})).resolves.toEqual({
      items: [{ tag: "vip", contacts: 2 }],
    });
    expect(mocks.listTags).toHaveBeenCalledWith("team-1");

    mocks.getTagReferences.mockResolvedValue({ tag: "vip", contacts: 2, segments: [] });
    await expect(call("get_tag_references", { tag: "vip" })).resolves.toMatchObject({
      tag: "vip",
    });
    expect(mocks.getTagReferences).toHaveBeenCalledWith("team-1", "vip");
  });

  it("renames a tag and maps a missing or unchanged tag", async () => {
    mocks.renameTag.mockResolvedValue({ tag: "gold", contactsUpdated: 2 });
    await expect(call("rename_tag", { tag: "vip", name: "gold" })).resolves.toEqual({
      tag: "gold",
      contactsUpdated: 2,
    });
    expect(mocks.renameTag).toHaveBeenCalledWith("team-1", "vip", "gold");

    mocks.renameTag.mockResolvedValue("tag_not_found");
    await expect(call("rename_tag", { tag: "nope", name: "x" })).resolves.toMatchObject(
      {
        error: { code: "not_found" },
      },
    );

    mocks.renameTag.mockResolvedValue("tag_unchanged");
    await expect(
      call("rename_tag", { tag: "vip", name: "vip" }),
    ).resolves.toMatchObject({
      error: { code: "validation_failed", safeDetails: { reason: "tag_unchanged" } },
    });
  });

  it("deletes a tag and returns not_found for an unknown one", async () => {
    mocks.deleteTag.mockResolvedValue({ tag: "gold", contactsUpdated: 2 });
    await expect(call("delete_tag", { tag: "gold", confirm: true })).resolves.toEqual({
      tag: "gold",
      contactsUpdated: 2,
    });
    expect(mocks.deleteTag).toHaveBeenCalledWith("team-1", "gold");

    mocks.deleteTag.mockResolvedValue(null);
    await expect(
      call("delete_tag", { tag: "nope", confirm: true }),
    ).resolves.toMatchObject({
      error: { code: "not_found" },
    });
  });

  it("needs contacts:write to rename over OAuth", async () => {
    await expect(
      call(
        "rename_tag",
        { tag: "vip", name: "gold" },
        { ...context, authKind: "oauth", scopes: ["contacts:read"] },
      ),
    ).resolves.toMatchObject({
      error: { code: "forbidden", safeDetails: { reason: "insufficient_scope" } },
    });
    expect(mocks.renameTag).not.toHaveBeenCalled();
  });
});
