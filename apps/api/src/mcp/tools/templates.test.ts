import { beforeEach, describe, expect, it, mock, vi } from "bun:test";

const mocks = {
  createTemplate: vi.fn(),
  deleteTemplate: vi.fn(),
  duplicateTemplate: vi.fn(),
  getTemplate: vi.fn(),
  listTemplates: vi.fn(),
  updateTemplate: vi.fn(),
};

mock.module("../../templates/queries", () => ({
  createTemplate: mocks.createTemplate,
  deleteTemplate: mocks.deleteTemplate,
  duplicateTemplate: mocks.duplicateTemplate,
  getTemplate: mocks.getTemplate,
  listTemplates: mocks.listTemplates,
  updateTemplate: mocks.updateTemplate,
}));

const { templateTools } = await import("./templates");
const { TemplateValidationError } = await import("../../templates/validation");

const teamKey = {
  authKind: "team_key" as const,
  teamId: "team-1",
  user: null,
  scopes: [],
  requestId: "",
};

const tools = new Map(templateTools().map((tool) => [tool.name, tool]));

function call(name: string, args: Record<string, unknown>, context: any = teamKey) {
  const tool = tools.get(name);
  if (!tool) throw new Error(`unknown tool ${name}`);
  return tool.handler({ context, args, signal: new AbortController().signal });
}

const template = {
  id: "internal-template",
  teamId: "team-1",
  templateId: "tpl_1",
  title: "Receipt",
  purpose: "transactional",
  content: { style: {}, meta: {}, content: [] },
  requiredVariables: ["order.id"],
  createdAt: new Date("2026-10-28T00:00:00.000Z"),
  updatedAt: null,
};

beforeEach(() => {
  for (const fn of Object.values(mocks)) fn.mockReset();
});

describe("MCP template tools", () => {
  it("has one titled tool per template operation", () => {
    expect([...tools.keys()]).toEqual([
      "list_system_templates",
      "list_templates",
      "get_template",
      "create_template",
      "update_template",
      "duplicate_template",
      "delete_template",
    ]);
    for (const tool of tools.values()) expect(tool.title).toBeTruthy();
    const remove = tools.get("delete_template")!;
    expect(remove.risk).toBe("destructive");
    expect((remove.inputSchema as any).shape.confirm).toBeDefined();
    expect(String(tools.get("create_template")!.description)).not.toContain("api.");
  });

  it("lists system starters, optionally by purpose", async () => {
    const all: any = await call("list_system_templates", {});
    expect(all.items.length).toBeGreaterThan(0);
    const transactional: any = await call("list_system_templates", {
      purpose: "transactional",
    });
    expect(transactional.items.length).toBeGreaterThan(0);
    expect(
      transactional.items.every((item: any) => item.purpose === "transactional"),
    ).toBe(true);
  });

  it("duplicates and deletes templates of the caller's team", async () => {
    mocks.duplicateTemplate.mockResolvedValueOnce({ ...template, templateId: "tpl_2" });
    await expect(
      call("duplicate_template", { templateId: "tpl_1" }),
    ).resolves.toMatchObject({ templateId: "tpl_2", purpose: "transactional" });
    expect(mocks.duplicateTemplate).toHaveBeenCalledWith({
      teamId: "team-1",
      templateId: "tpl_1",
      title: undefined,
    });

    mocks.duplicateTemplate.mockResolvedValueOnce(null);
    await expect(
      call("duplicate_template", { templateId: "tpl_x" }),
    ).resolves.toMatchObject({ error: { code: "not_found" } });

    mocks.duplicateTemplate.mockRejectedValueOnce(
      new TemplateValidationError("marketing_variables_not_allowed", ["contact.email"]),
    );
    await expect(
      call("duplicate_template", { templateId: "tpl_1" }),
    ).resolves.toMatchObject({
      error: {
        code: "validation_failed",
        safeDetails: { reason: "marketing_variables_not_allowed" },
      },
    });

    mocks.deleteTemplate.mockResolvedValueOnce(undefined);
    await expect(
      call("delete_template", { templateId: "tpl_1", confirm: true }),
    ).resolves.toEqual({ message: "Template deleted." });
    expect(mocks.deleteTemplate).toHaveBeenCalledWith("team-1", "tpl_1");
  });

  it("keeps template ID inputs non-empty", () => {
    for (const name of ["get_template", "update_template"]) {
      expect(tools.get(name)!.inputSchema.safeParse({ templateId: "" }).success).toBe(
        false,
      );
    }
  });

  it("refuses an OAuth token without the templates scope", async () => {
    await expect(
      call(
        "create_template",
        { title: "Receipt", purpose: "transactional", content: template.content },
        { ...teamKey, authKind: "oauth", scopes: ["templates:read"] },
      ),
    ).resolves.toMatchObject({
      error: {
        code: "forbidden",
        safeDetails: { reason: "insufficient_scope", requiredScope: "templates:write" },
      },
    });
    expect(mocks.createTemplate).not.toHaveBeenCalled();
  });

  it("filters and creates templates without changing purpose", async () => {
    mocks.listTemplates.mockResolvedValue([template]);
    const listed: any = await call("list_templates", { purpose: "transactional" });
    expect(listed).toMatchObject({
      items: [
        {
          templateId: "tpl_1",
          purpose: "transactional",
          requiredVariables: ["order.id"],
          createdAt: "2026-10-28T00:00:00.000Z",
        },
      ],
    });
    expect(listed.items[0]).not.toHaveProperty("id");
    expect(listed.items[0]).not.toHaveProperty("teamId");
    expect(mocks.listTemplates).toHaveBeenCalledWith("team-1", "transactional");

    mocks.createTemplate.mockResolvedValue(template);
    await call("create_template", {
      title: "Receipt",
      purpose: "transactional",
      content: template.content,
    });
    expect(mocks.createTemplate).toHaveBeenCalledWith({
      teamId: "team-1",
      title: "Receipt",
      purpose: "transactional",
      content: template.content,
    });
  });

  it("hides another team's template", async () => {
    mocks.getTemplate.mockResolvedValue({ ...template, teamId: "team-2" });
    await expect(call("get_template", { templateId: "tpl_1" })).resolves.toMatchObject({
      error: { code: "not_found" },
    });
  });

  it("maps validation and duplicate-title failures", async () => {
    mocks.createTemplate.mockRejectedValueOnce(
      new TemplateValidationError("marketing_variables_not_allowed", ["contact.email"]),
    );
    await expect(
      call("create_template", {
        title: "Receipt",
        purpose: "transactional",
        content: template.content,
      }),
    ).resolves.toMatchObject({
      error: {
        code: "validation_failed",
        safeDetails: {
          reason: "marketing_variables_not_allowed",
          variables: "contact.email",
        },
      },
    });

    mocks.updateTemplate.mockRejectedValueOnce(new Error("duplicate_title"));
    await expect(
      call("update_template", { templateId: "tpl_1", title: "Taken" }),
    ).resolves.toMatchObject({
      error: { code: "conflict", safeDetails: { reason: "duplicate_title" } },
    });

    mocks.updateTemplate.mockResolvedValueOnce(null);
    await expect(
      call("update_template", { templateId: "tpl_x", title: "New" }),
    ).resolves.toMatchObject({ error: { code: "not_found" } });

    mocks.updateTemplate.mockRejectedValueOnce(new Error("db down"));
    await expect(call("update_template", { templateId: "tpl_1" })).rejects.toThrow(
      "db down",
    );
  });
});
