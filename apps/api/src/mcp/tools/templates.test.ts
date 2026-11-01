import { beforeEach, describe, expect, it, mock, vi } from "bun:test";

const mocks = {
  createTemplate: vi.fn(),
  getTemplate: vi.fn(),
  listTemplates: vi.fn(),
  updateTemplate: vi.fn(),
};

mock.module("../../templates/queries", () => ({
  createTemplate: mocks.createTemplate,
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
  clientIp: "",
  replayHeaders: {},
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
  it("keeps only the dedicated template tools", () => {
    expect([...tools.keys()]).toEqual([
      "list_templates",
      "get_template",
      "create_template",
      "update_template",
    ]);
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
