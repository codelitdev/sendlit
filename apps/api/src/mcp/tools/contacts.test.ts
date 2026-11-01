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
  deleteContact: vi.fn(),
  getDeliveriesByContact: vi.fn(),
  getSegment: vi.fn(),
  exportContactsCsv: vi.fn(),
  selectionCondition: vi.fn(),
  countSelection: vi.fn(),
  startContactDeletion: vi.fn(),
  getContactDeletion: vi.fn(),
};

mock.module("../../contacts/import", () => ({ importContacts: mocks.importContacts }));
// events.test.ts mocks the same module; bun shares mocks across files run
// in one process, so both list every export either one needs.
mock.module("../../contacts/queries", () => ({
  countContacts: mocks.countContacts,
  createContact: mocks.createContact,
  getContactByContactId: mocks.getContactByContactId,
  listContacts: mocks.listContacts,
  updateContact: mocks.updateContact,
  addTagToContact: mocks.addTagToContact,
  removeTagFromContact: mocks.removeTagFromContact,
  deleteContact: mocks.deleteContact,
  getDeliveriesByContact: mocks.getDeliveriesByContact,
}));
// Likewise segments.test.ts.
mock.module("../../contacts/segments-queries", () => ({
  getSegment: mocks.getSegment,
  createSegment: vi.fn(),
  listSegments: vi.fn(),
  updateSegment: vi.fn(),
  deleteSegment: vi.fn(),
}));
mock.module("../../contacts/export", () => ({
  exportContactsCsv: mocks.exportContactsCsv,
}));
mock.module("../../contacts/bulk-delete", () => ({
  selectionCondition: mocks.selectionCondition,
  countSelection: mocks.countSelection,
}));
mock.module("../../contacts/deletion-queue", () => ({
  startContactDeletion: mocks.startContactDeletion,
  getContactDeletion: mocks.getContactDeletion,
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
  it("has one titled tool per contact operation, in the original order", () => {
    expect([...tools.keys()]).toEqual([
      "import_contacts",
      "export_contacts",
      "list_contacts",
      "get_contact",
      "get_contact_deliveries",
      "create_contact",
      "update_contact",
      "add_contact_tag",
      "remove_contact_tag",
      "delete_contact",
      "preview_delete_contacts",
      "delete_contacts",
      "get_contact_deletion",
    ]);
    for (const tool of tools.values()) expect(tool.title).toBeTruthy();
    expect(tools.get("list_contacts")!.risk).toBe("read");
    expect(tools.get("create_contact")!.risk).toBe("write");
    expect(tools.get("delete_contact")!.risk).toBe("destructive");
    expect(tools.get("delete_contacts")!.risk).toBe("destructive");
    // Destructive tools advertise the kit's confirmation flag.
    const deleteSchema = tools.get("delete_contacts")!.inputSchema as any;
    expect(Object.keys(deleteSchema.shape)).toContain("confirm");
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

  it("bulk deletes only with a valid selection and passes the acting user", async () => {
    const missingCount = await call("delete_contacts", { match: {}, confirm: true });
    expect(missingCount).toMatchObject({
      error: {
        code: "validation_failed",
        safeDetails: { reason: "invalid_selection" },
      },
    });
    expect(mocks.startContactDeletion).not.toHaveBeenCalled();

    mocks.startContactDeletion.mockResolvedValue({
      status: 409,
      body: { error: "count_changed", count: 7 },
    });
    await expect(
      call(
        "delete_contacts",
        { match: { q: "old" }, expectedCount: 5, confirm: true },
        oauthContext,
      ),
    ).resolves.toMatchObject({
      error: { code: "conflict", safeDetails: { reason: "count_changed", count: 7 } },
    });
    expect(mocks.startContactDeletion).toHaveBeenCalledWith({
      teamId: "team-1",
      selection: { match: { q: "old" } },
      expectedCount: 5,
      actorUserId: "user-1",
    });

    const queued = {
      deletionId: "cdel_1",
      status: "queued",
      count: 5000,
      deleted: 0,
      suppressed: 0,
    };
    mocks.startContactDeletion.mockResolvedValue({ status: 202, body: queued });
    await expect(
      call("delete_contacts", { match: {}, expectedCount: 5000, confirm: true }),
    ).resolves.toEqual(queued);

    mocks.startContactDeletion.mockResolvedValue({
      status: 404,
      body: { error: "segment_not_found" },
    });
    await expect(
      call("delete_contacts", {
        match: { segmentId: "seg_x" },
        expectedCount: 1,
        confirm: true,
      }),
    ).resolves.toMatchObject({ error: { code: "not_found" } });

    mocks.getContactDeletion.mockResolvedValue(null);
    await expect(
      call("get_contact_deletion", { deletionId: "cdel_1" }),
    ).resolves.toMatchObject({
      error: { code: "not_found" },
    });
    mocks.getContactDeletion.mockResolvedValue(queued);
    await expect(
      call("get_contact_deletion", { deletionId: "cdel_1" }),
    ).resolves.toEqual(queued);
    expect(mocks.getContactDeletion).toHaveBeenCalledWith("team-1", "cdel_1");
  });

  it("previews a bulk delete", async () => {
    mocks.selectionCondition.mockResolvedValue({ condition: "sql" });
    mocks.countSelection.mockResolvedValue({ count: 4, unsubscribed: 1 });
    await expect(
      call("preview_delete_contacts", { contactIds: ["cnt_a"] }),
    ).resolves.toEqual({ count: 4, unsubscribed: 1 });
    expect(mocks.selectionCondition).toHaveBeenCalledWith("team-1", {
      contactIds: ["cnt_a"],
    });

    await expect(
      call("preview_delete_contacts", { contactIds: ["cnt_a"], match: {} }),
    ).resolves.toMatchObject({
      error: {
        code: "validation_failed",
        safeDetails: { reason: "invalid_selection" },
      },
    });

    mocks.selectionCondition.mockResolvedValue({ error: "segment_not_found" });
    await expect(
      call("preview_delete_contacts", { match: { segmentId: "seg_x" } }),
    ).resolves.toMatchObject({ error: { code: "not_found" } });
  });

  it("deletes one contact on behalf of the signed-in user", async () => {
    mocks.deleteContact.mockResolvedValue(undefined);
    await expect(
      call("delete_contact", { contactId: "cnt_1", confirm: true }, oauthContext),
    ).resolves.toEqual({ message: "Contact deleted." });
    expect(mocks.deleteContact).toHaveBeenCalledWith("team-1", "cnt_1", "user-1");
  });

  it("returns contact deliveries after checking contact ownership", async () => {
    mocks.getContactByContactId.mockResolvedValue({
      id: "internal-1",
      contactId: "cnt_1",
      teamId: "team-1",
    });
    mocks.getDeliveriesByContact.mockResolvedValue([
      {
        sequenceId: "seq-1",
        sequenceTitle: "Welcome",
        sequenceType: "sequence",
        emailId: "email-1",
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
      },
    ]);
    await expect(
      call("get_contact_deliveries", { contactId: "cnt_1" }),
    ).resolves.toEqual({
      items: [
        {
          sequenceId: "seq-1",
          sequenceTitle: "Welcome",
          sequenceType: "sequence",
          emailId: "email-1",
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      ],
    });
    expect(mocks.getDeliveriesByContact).toHaveBeenCalledWith("team-1", "internal-1");

    mocks.getContactByContactId.mockResolvedValue({
      contactId: "cnt_1",
      teamId: "team-2",
    });
    await expect(
      call("get_contact_deliveries", { contactId: "cnt_1" }),
    ).resolves.toMatchObject({
      error: { code: "not_found" },
    });
  });

  it("exports CSV for a team segment and refuses another team's", async () => {
    mocks.getSegment.mockResolvedValue({
      teamId: "team-1",
      filter: { aggregator: "and", filters: [] },
    });
    mocks.exportContactsCsv.mockResolvedValue({ csv: "email\na@b.co\n", count: 1 });
    await expect(call("export_contacts", { segmentId: "seg_1" })).resolves.toEqual({
      csv: "email\na@b.co\n",
      contacts: 1,
    });
    expect(mocks.exportContactsCsv).toHaveBeenCalledWith({
      teamId: "team-1",
      filter: [{ aggregator: "and", filters: [] }],
    });

    mocks.getSegment.mockResolvedValue({ teamId: "team-2", filter: {} });
    await expect(
      call("export_contacts", { segmentId: "seg_1" }),
    ).resolves.toMatchObject({
      error: { code: "not_found" },
    });
  });

  it("needs contacts:write to delete over OAuth", async () => {
    await expect(
      call(
        "delete_contact",
        { contactId: "cnt_1", confirm: true },
        { ...oauthContext, scopes: ["contacts:read"] },
      ),
    ).resolves.toMatchObject({
      error: { code: "forbidden", safeDetails: { reason: "insufficient_scope" } },
    });
    expect(mocks.deleteContact).not.toHaveBeenCalled();
  });
});
