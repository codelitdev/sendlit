import { beforeEach, describe, expect, it, mock, vi } from "bun:test";

const mocks = {
  importContacts: vi.fn(),
  countContacts: vi.fn(),
  createContact: vi.fn(),
  getContactByContactId: vi.fn(),
  listContacts: vi.fn(),
  updateContact: vi.fn(),
  addTagToContact: vi.fn(),
  removeTagFromContact: vi.fn(),
  getSegment: vi.fn(),
};

mock.module("../../contacts/import", () => ({ importContacts: mocks.importContacts }));
mock.module("../../contacts/queries", () => ({
  countContacts: mocks.countContacts,
  createContact: mocks.createContact,
  getContactByContactId: mocks.getContactByContactId,
  listContacts: mocks.listContacts,
  updateContact: mocks.updateContact,
  addTagToContact: mocks.addTagToContact,
  removeTagFromContact: mocks.removeTagFromContact,
}));
// segments.test.ts mocks the same module; bun shares mocks across files run
// in one process, so both list every export either one needs.
mock.module("../../contacts/segments-queries", () => ({
  getSegment: mocks.getSegment,
  createSegment: vi.fn(),
  listSegments: vi.fn(),
}));

const { contactTools } = await import("./contacts");
const { PlanGateError } = await import("../../billing/errors");

const signal = new AbortController().signal;
const teamKeyContext = {
  authKind: "team_key" as const,
  teamId: "team-1",
  user: null,
  scopes: [],
  requestId: "",
  clientIp: "",
  replayHeaders: {},
};
const oauthContext = {
  ...teamKeyContext,
  authKind: "oauth" as const,
  user: { id: "user-1", email: "owner@example.com", name: "Owner" } as any,
  scopes: ["contacts:read", "contacts:write"],
};

const tools = new Map(contactTools().map((tool) => [tool.name, tool]));
function call(
  name: string,
  args: unknown,
  context: any = teamKeyContext,
): Promise<any> {
  return tools.get(name)!.handler({ context, args, signal });
}

beforeEach(() => {
  for (const fn of Object.values(mocks)) fn.mockReset();
});

describe("MCP contact tools", () => {
  it("keeps only the dedicated contact tools", () => {
    expect([...tools.keys()].sort()).toEqual(
      [
        "add_contact_tag",
        "create_contact",
        "get_contact",
        "import_contacts",
        "list_contacts",
        "remove_contact_tag",
        "update_contact",
      ].sort(),
    );
    expect(tools.get("list_contacts")!.risk).toBe("read");
    expect(tools.get("create_contact")!.risk).toBe("write");
  });

  it("scopes list/create calls to the resolved team and serializes dates", async () => {
    const firstContactId = crypto.randomUUID();
    mocks.listContacts.mockResolvedValue([
      { contactId: firstContactId, id: "internal" },
    ]);
    mocks.countContacts.mockResolvedValue(1);

    await expect(call("list_contacts", { q: "ada", offset: 2 })).resolves.toEqual({
      items: [{ contactId: firstContactId }],
      total: 1,
    });
    expect(mocks.listContacts).toHaveBeenCalledWith({
      teamId: "team-1",
      searchText: "ada",
      offset: 2,
    });

    mocks.createContact.mockResolvedValue({
      contactId: crypto.randomUUID(),
      email: "reader@example.com",
      subscribed: true,
      customFields: { plan: "pro" },
      tags: [],
      unsubscribeToken: "unsubscribe-token",
      createdAt: new Date("2026-08-09T10:00:00.000Z"),
      updatedAt: new Date("2026-08-09T10:00:00.000Z"),
    });
    const created = await call("create_contact", {
      email: "reader@example.com",
      customFields: { plan: "pro" },
    });
    expect(mocks.createContact).toHaveBeenCalledWith({
      teamId: "team-1",
      email: "reader@example.com",
      customFields: { plan: "pro" },
    });
    expect(created).toMatchObject({
      createdAt: "2026-08-09T10:00:00.000Z",
      updatedAt: "2026-08-09T10:00:00.000Z",
    });
    expect(tools.get("create_contact")!.outputSchema!.safeParse(created).success).toBe(
      true,
    );
  });

  it("filters by a saved segment of the team only", async () => {
    mocks.getSegment.mockResolvedValue({ teamId: "team-2", filter: {} });
    await expect(call("list_contacts", { segmentId: "seg_1" })).resolves.toMatchObject({
      error: { code: "not_found" },
    });
    expect(mocks.listContacts).not.toHaveBeenCalled();
  });

  it("does not leak contacts from another team", async () => {
    mocks.getContactByContactId.mockResolvedValue({
      contactId: "cnt_1",
      teamId: "team-2",
    });
    await expect(call("get_contact", { contactId: "cnt_1" })).resolves.toMatchObject({
      error: { code: "not_found" },
    });
  });

  it("returns not_found when updating or tagging an unknown contact", async () => {
    mocks.updateContact.mockResolvedValue(null);
    mocks.addTagToContact.mockResolvedValue(null);
    mocks.removeTagFromContact.mockResolvedValue(null);
    for (const [name, args] of [
      ["update_contact", { contactId: "cnt_1", name: "Ada" }],
      ["add_contact_tag", { contactId: "cnt_1", tag: "vip" }],
      ["remove_contact_tag", { contactId: "cnt_1", tag: "vip" }],
    ] as const) {
      await expect(call(name, args)).resolves.toMatchObject({
        error: { code: "not_found" },
      });
    }
    expect(mocks.updateContact).toHaveBeenCalledWith("team-1", "cnt_1", {
      name: "Ada",
    });
    expect(mocks.addTagToContact).toHaveBeenCalledWith("team-1", "cnt_1", "vip");
  });

  it("passes the signed-in user to an import and maps plan limits", async () => {
    mocks.importContacts.mockResolvedValue({ created: 1, updated: 0, unchanged: 0 });
    await call(
      "import_contacts",
      { contacts: [{ email: "a@example.com" }] },
      oauthContext,
    );
    expect(mocks.importContacts).toHaveBeenCalledWith(
      expect.objectContaining({ teamId: "team-1", userId: "user-1" }),
    );

    mocks.createContact.mockRejectedValue(
      new PlanGateError("plan_limit_reached", { limit: 500, nested: { no: true } }),
    );
    const gated = await call("create_contact", { email: "a@example.com" });
    expect(gated.error.code).toBe("forbidden");
    expect(gated.error.safeDetails).toEqual({
      reason: "plan_limit_reached",
      limit: 500,
    });
  });

  it("rethrows unexpected failures", async () => {
    mocks.createContact.mockRejectedValue(new Error("db down"));
    await expect(call("create_contact", { email: "a@example.com" })).rejects.toThrow(
      "db down",
    );
  });

  it("refuses an OAuth token without the operation's scope", async () => {
    const result = await call(
      "create_contact",
      { email: "a@example.com" },
      { ...oauthContext, scopes: ["contacts:read"] },
    );
    expect(result).toMatchObject({
      error: {
        code: "forbidden",
        safeDetails: { reason: "insufficient_scope", requiredScope: "contacts:write" },
      },
    });
    expect(mocks.createContact).not.toHaveBeenCalled();
  });
});
