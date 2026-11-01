import { beforeEach, describe, expect, it, mock, vi } from "bun:test";

const mocks = {
  createSegment: vi.fn(),
  listSegments: vi.fn(),
  getSegment: vi.fn(),
  updateSegment: vi.fn(),
  deleteSegment: vi.fn(),
};
// contacts.test.ts mocks the same module; see the note there.
mock.module("../../contacts/segments-queries", () => mocks);

const { segmentTools } = await import("./segments");

const signal = new AbortController().signal;
const context = {
  authKind: "team_key" as const,
  teamId: "team-1",
  user: null,
  scopes: [],
  requestId: "",
};
const tools = new Map(segmentTools().map((tool) => [tool.name, tool]));
function call(name: string, args: unknown, ctx: any = context): Promise<any> {
  return tools.get(name)!.handler({ context: ctx, args, signal });
}

beforeEach(() => {
  for (const fn of Object.values(mocks)) fn.mockReset();
});

describe("MCP segment tools", () => {
  it("has one titled tool per segment operation", () => {
    expect([...tools.keys()]).toEqual([
      "list_segments",
      "get_segment",
      "create_segment",
      "update_segment",
      "delete_segment",
    ]);
    for (const tool of tools.values()) expect(tool.title).toBeTruthy();
    expect(tools.get("delete_segment")!.risk).toBe("destructive");
  });

  it("gets, updates and deletes only the team's segments", async () => {
    mocks.getSegment.mockResolvedValue({ teamId: "team-2", segmentId: "seg_1" });
    await expect(call("get_segment", { segmentId: "seg_1" })).resolves.toMatchObject({
      error: { code: "not_found" },
    });
    mocks.getSegment.mockResolvedValue({
      id: "internal",
      teamId: "team-1",
      segmentId: "seg_1",
      name: "VIP",
    });
    await expect(call("get_segment", { segmentId: "seg_1" })).resolves.toEqual({
      segmentId: "seg_1",
      name: "VIP",
    });

    mocks.updateSegment.mockResolvedValue(null);
    await expect(
      call("update_segment", { segmentId: "seg_1", name: "Gold" }),
    ).resolves.toMatchObject({ error: { code: "not_found" } });
    expect(mocks.updateSegment).toHaveBeenCalledWith({
      teamId: "team-1",
      segmentId: "seg_1",
      name: "Gold",
    });
    mocks.updateSegment.mockRejectedValue(new Error("duplicate_name"));
    await expect(
      call("update_segment", { segmentId: "seg_1", name: "Gold" }),
    ).resolves.toMatchObject({
      error: { code: "conflict", safeDetails: { reason: "duplicate_name" } },
    });

    await expect(
      call("delete_segment", { segmentId: "seg_1", confirm: true }),
    ).resolves.toEqual({ message: "Segment deleted." });
    expect(mocks.deleteSegment).toHaveBeenCalledWith("team-1", "seg_1");
  });

  it("lists the team's segments without internal ids", async () => {
    mocks.listSegments.mockResolvedValue([
      { id: "internal", segmentId: "seg_1", name: "VIP", filter: {} },
    ]);
    await expect(call("list_segments", {})).resolves.toEqual({
      items: [{ segmentId: "seg_1", name: "VIP", filter: {} }],
    });
    expect(mocks.listSegments).toHaveBeenCalledWith("team-1");
  });

  it("creates a segment for the team and maps a taken name to conflict", async () => {
    const filter = { aggregator: "and", filters: [] };
    mocks.createSegment.mockResolvedValue({ segmentId: "seg_1", name: "VIP", filter });
    await expect(
      call("create_segment", { name: "VIP", filter }),
    ).resolves.toMatchObject({
      segmentId: "seg_1",
    });
    expect(mocks.createSegment).toHaveBeenCalledWith({
      teamId: "team-1",
      name: "VIP",
      filter,
    });

    mocks.createSegment.mockRejectedValue(new Error("duplicate_name"));
    await expect(
      call("create_segment", { name: "VIP", filter }),
    ).resolves.toMatchObject({
      error: { code: "conflict", safeDetails: { reason: "duplicate_name" } },
    });

    mocks.createSegment.mockRejectedValue(new Error("db down"));
    await expect(call("create_segment", { name: "VIP", filter })).rejects.toThrow(
      "db down",
    );
  });

  it("needs contacts:write to create a segment over OAuth", async () => {
    const result = await call(
      "create_segment",
      { name: "VIP", filter: {} },
      { ...context, authKind: "oauth", scopes: ["contacts:read"] },
    );
    expect(result).toMatchObject({
      error: { code: "forbidden", safeDetails: { reason: "insufficient_scope" } },
    });
    expect(mocks.createSegment).not.toHaveBeenCalled();
  });
});
