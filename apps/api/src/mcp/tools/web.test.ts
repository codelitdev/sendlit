import { beforeEach, describe, expect, it, mock, vi } from "bun:test";

class WebPublishingError extends Error {
  constructor(
    readonly status: 400 | 404 | 409,
    code: string,
  ) {
    super(code);
  }
}

const mocks = {
  getIssue: vi.fn(),
  getWebSettings: vi.fn(),
  listIssues: vi.fn(),
  toWebPublishing: vi.fn(),
  updateWebPublishing: vi.fn(),
  updateWebSettings: vi.fn(),
  getSequenceBySequenceId: vi.fn(),
};

mock.module("../../web/queries", () => ({
  getIssue: mocks.getIssue,
  getWebSettings: mocks.getWebSettings,
  listIssues: mocks.listIssues,
  toWebPublishing: mocks.toWebPublishing,
  updateWebPublishing: mocks.updateWebPublishing,
  updateWebSettings: mocks.updateWebSettings,
  WebPublishingError,
}));
// bun shares module mocks across test files in one process, so this mock
// exports everything the sequence tools import too.
mock.module("../../sequences/queries", () => ({
  addMailToSequence: vi.fn(),
  countSequences: vi.fn(),
  createSequence: vi.fn(),
  deleteMailFromSequence: vi.fn(),
  deleteSequence: vi.fn(),
  getEmailSentCount: vi.fn(),
  getSequenceBySequenceId: mocks.getSequenceBySequenceId,
  getSequenceClickThroughRate: vi.fn(),
  getSequenceDeletionImpact: vi.fn(),
  getSequenceOpenRate: vi.fn(),
  getSequenceSchedule: vi.fn(),
  getSubscribers: vi.fn(),
  getSubscribersCount: vi.fn(),
  getWaitingContacts: vi.fn(),
  InvalidCursorError: class InvalidCursorError extends Error {},
  listSequences: vi.fn(),
  pauseSequence: vi.fn(),
  setBroadcastArchived: vi.fn(),
  startSequence: vi.fn(),
  updateMailInSequence: vi.fn(),
  updateSequence: vi.fn(),
}));

const { webTools } = await import("./web");

const teamKey = {
  authKind: "team_key" as const,
  teamId: "team-1",
  user: null,
  scopes: [],
  requestId: "",
};

const tools = new Map(webTools().map((tool) => [tool.name, tool]));

function call(name: string, args: Record<string, unknown>, context: any = teamKey) {
  const tool = tools.get(name);
  if (!tool) throw new Error(`unknown tool ${name}`);
  return tool.handler({ context, args, signal: new AbortController().signal });
}

beforeEach(() => {
  for (const fn of Object.values(mocks)) fn.mockReset();
});

describe("MCP web archive tools", () => {
  it("has one titled tool per web operation", () => {
    expect([...tools.keys()]).toEqual([
      "get_broadcast_web_publishing",
      "update_broadcast_web_publishing",
      "get_web_settings",
      "update_web_settings",
      "list_web_issues",
      "get_web_issue",
    ]);
    for (const tool of tools.values()) {
      expect(tool.title).toBeTruthy();
      expect(tool.risk).not.toBe("destructive");
    }
  });

  it("reads and updates a broadcast's web publishing for the caller's team", async () => {
    const sequence = { sequenceId: "seq-1", type: "broadcast" };
    mocks.getSequenceBySequenceId.mockResolvedValueOnce(null);
    await expect(
      call("get_broadcast_web_publishing", { sequenceId: "seq-x" }),
    ).resolves.toMatchObject({ error: { code: "not_found" } });
    expect(mocks.getSequenceBySequenceId).toHaveBeenCalledWith("team-1", "seq-x");

    mocks.getSequenceBySequenceId.mockResolvedValueOnce(sequence);
    mocks.toWebPublishing.mockResolvedValueOnce({ published: false, slug: null });
    await expect(
      call("get_broadcast_web_publishing", { sequenceId: "seq-1" }),
    ).resolves.toEqual({ published: false, slug: null });

    mocks.getSequenceBySequenceId.mockResolvedValueOnce(sequence);
    mocks.updateWebPublishing.mockResolvedValueOnce({ published: true, slug: "hello" });
    await expect(
      call("update_broadcast_web_publishing", {
        sequenceId: "seq-1",
        published: true,
        slug: "hello",
      }),
    ).resolves.toEqual({ published: true, slug: "hello" });
    expect(mocks.updateWebPublishing).toHaveBeenCalledWith(sequence, {
      published: true,
      slug: "hello",
    });
  });

  it("keeps REST's status and code for publishing refusals", async () => {
    mocks.getSequenceBySequenceId.mockResolvedValue({ sequenceId: "seq-1" });
    mocks.updateWebPublishing.mockRejectedValueOnce(
      new WebPublishingError(409, "slug_taken"),
    );
    await expect(
      call("update_broadcast_web_publishing", { sequenceId: "seq-1", slug: "taken" }),
    ).resolves.toMatchObject({
      error: { code: "conflict", safeDetails: { reason: "slug_taken" } },
    });

    mocks.updateWebSettings.mockRejectedValueOnce(
      new WebPublishingError(400, "signup_form_not_found"),
    );
    await expect(
      call("update_web_settings", { enabled: true, signupFormId: "frm_x" }),
    ).resolves.toMatchObject({
      error: {
        code: "validation_failed",
        safeDetails: { reason: "signup_form_not_found" },
      },
    });

    mocks.updateWebSettings.mockRejectedValueOnce(new Error("db down"));
    await expect(call("update_web_settings", { enabled: true })).rejects.toThrow(
      "db down",
    );
  });

  it("reads the team's settings and published issues", async () => {
    mocks.getWebSettings.mockResolvedValueOnce({ enabled: true, handle: "news" });
    await expect(call("get_web_settings", {})).resolves.toEqual({
      enabled: true,
      handle: "news",
    });
    expect(mocks.getWebSettings).toHaveBeenCalledWith("team-1");

    mocks.listIssues.mockResolvedValueOnce({ items: [], total: 0 });
    await expect(call("list_web_issues", {})).resolves.toEqual({ items: [], total: 0 });
    expect(mocks.listIssues).toHaveBeenCalledWith("team-1", expect.any(Object));

    mocks.getIssue.mockResolvedValueOnce(null);
    await expect(call("get_web_issue", { slug: "nope" })).resolves.toMatchObject({
      error: { code: "not_found" },
    });
    expect(mocks.getIssue).toHaveBeenCalledWith("team-1", "nope");
  });

  it("refuses an OAuth token without settings:write", async () => {
    await expect(
      call(
        "update_web_settings",
        { enabled: true },
        { ...teamKey, authKind: "oauth", scopes: ["settings:read"] },
      ),
    ).resolves.toMatchObject({
      error: {
        code: "forbidden",
        safeDetails: { reason: "insufficient_scope", requiredScope: "settings:write" },
      },
    });
    expect(mocks.updateWebSettings).not.toHaveBeenCalled();
  });
});
