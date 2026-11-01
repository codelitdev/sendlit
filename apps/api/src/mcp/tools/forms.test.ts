import { beforeEach, describe, expect, it, mock, vi } from "bun:test";

class FakeFormSenderError extends Error {
  constructor(readonly issue: string) {
    super("confirmation_sender_unavailable");
  }
}
const mocks = {
  createForm: vi.fn(),
  deleteForm: vi.fn(),
  getForm: vi.fn(),
  listForms: vi.fn(),
  updateForm: vi.fn(),
  toPublicForms: vi.fn(async (_teamId: string, forms: any[]) =>
    forms.map((form) => ({ ...form, url: `https://forms.example/${form.formId}` })),
  ),
};
mock.module("../../forms/queries", () => ({
  ...mocks,
  FormSenderError: FakeFormSenderError,
}));

const { formTools } = await import("./forms");

const signal = new AbortController().signal;
const context = {
  authKind: "team_key" as const,
  teamId: "team-1",
  user: null,
  scopes: [] as string[],
  requestId: "",
};
const tools = new Map(formTools().map((tool) => [tool.name, tool]));
function call(name: string, args: unknown, ctx: any = context): Promise<any> {
  return tools.get(name)!.handler({ context: ctx, args, signal });
}

beforeEach(() => {
  for (const fn of Object.values(mocks)) fn.mockClear();
  for (const fn of [
    mocks.createForm,
    mocks.deleteForm,
    mocks.getForm,
    mocks.listForms,
    mocks.updateForm,
  ]) {
    fn.mockReset();
  }
});

describe("MCP signup form tools", () => {
  it("has one titled tool per form operation", () => {
    expect([...tools.keys()]).toEqual([
      "list_signup_forms",
      "create_signup_form",
      "get_signup_form",
      "update_signup_form",
      "delete_signup_form",
    ]);
    for (const tool of tools.values()) expect(tool.title).toBeTruthy();
    expect(tools.get("delete_signup_form")!.risk).toBe("destructive");
  });

  it("lists, gets and creates the team's forms with their public URLs", async () => {
    mocks.listForms.mockResolvedValue([{ formId: "frm_1", name: "Newsletter" }]);
    await expect(call("list_signup_forms", {})).resolves.toEqual({
      items: [
        { formId: "frm_1", name: "Newsletter", url: "https://forms.example/frm_1" },
      ],
    });
    expect(mocks.listForms).toHaveBeenCalledWith("team-1");

    mocks.getForm.mockResolvedValue(null);
    await expect(call("get_signup_form", { formId: "frm_x" })).resolves.toMatchObject({
      error: { code: "not_found" },
    });

    mocks.createForm.mockResolvedValue({ formId: "frm_2", name: "Launch" });
    await expect(call("create_signup_form", { name: "Launch" })).resolves.toMatchObject(
      {
        formId: "frm_2",
        url: "https://forms.example/frm_2",
      },
    );
    expect(mocks.createForm).toHaveBeenCalledWith(
      "team-1",
      expect.objectContaining({ name: "Launch" }),
    );
  });

  it("explains a missing confirmation sender", async () => {
    mocks.createForm.mockRejectedValue(new FakeFormSenderError("no_sending_mailbox"));
    await expect(call("create_signup_form", { name: "Launch" })).resolves.toMatchObject(
      {
        error: {
          code: "conflict",
          safeDetails: {
            reason: "confirmation_sender_unavailable",
            message: "no_sending_mailbox",
          },
        },
      },
    );

    mocks.updateForm.mockRejectedValue(new FakeFormSenderError("no_sending_mailbox"));
    await expect(
      call("update_signup_form", { formId: "frm_1", doubleOptIn: true }),
    ).resolves.toMatchObject({
      error: { safeDetails: { reason: "confirmation_sender_unavailable" } },
    });

    mocks.createForm.mockRejectedValue(new Error("db down"));
    await expect(call("create_signup_form", { name: "Launch" })).rejects.toThrow(
      "db down",
    );
  });

  it("updates and deletes only existing forms", async () => {
    mocks.updateForm.mockResolvedValue(null);
    await expect(
      call("update_signup_form", { formId: "frm_1", name: "Renamed" }),
    ).resolves.toMatchObject({ error: { code: "not_found" } });
    expect(mocks.updateForm).toHaveBeenCalledWith("team-1", "frm_1", {
      name: "Renamed",
    });

    mocks.deleteForm.mockResolvedValue(true);
    await expect(
      call("delete_signup_form", { formId: "frm_1", confirm: true }),
    ).resolves.toEqual({ deleted: true });
    mocks.deleteForm.mockResolvedValue(false);
    await expect(
      call("delete_signup_form", { formId: "frm_1", confirm: true }),
    ).resolves.toMatchObject({ error: { code: "not_found" } });
  });

  it("needs contacts:write to create a form over OAuth", async () => {
    await expect(
      call(
        "create_signup_form",
        { name: "Launch" },
        { ...context, authKind: "oauth", scopes: ["contacts:read"] },
      ),
    ).resolves.toMatchObject({
      error: { code: "forbidden", safeDetails: { reason: "insufficient_scope" } },
    });
    expect(mocks.createForm).not.toHaveBeenCalled();
  });
});
