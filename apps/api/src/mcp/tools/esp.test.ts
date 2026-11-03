import { beforeEach, describe, expect, it, mock, vi } from "bun:test";

const mocks = {
  checkAndRememberDomainAuthentication: vi.fn(),
  createEspConfig: vi.fn(),
  deleteEspConfig: vi.fn(),
  getEspConfig: vi.fn(),
  getEspConfigByEspId: vi.fn(),
  listEspConfigs: vi.fn(),
  transitionEspConfig: vi.fn(),
  updateEspConfig: vi.fn(),
  upsertEspConfig: vi.fn(),
  invalidateEspTransport: vi.fn(),
  invalidateTeamTransport: vi.fn(),
  testEspConfig: vi.fn(),
  isTeamAdminOrKey: vi.fn(),
  canManageTeamEsp: vi.fn(),
};

// bun shares module mocks across test files in one process, so this mock
// exports everything the MCP tool modules import from the ESP queries.
mock.module("../../settings/esp/queries", () => ({
  checkAndRememberDomainAuthentication: mocks.checkAndRememberDomainAuthentication,
  createEspConfig: mocks.createEspConfig,
  deleteEspConfig: mocks.deleteEspConfig,
  getEspConfig: mocks.getEspConfig,
  getEspConfigByEspId: mocks.getEspConfigByEspId,
  listEspConfigs: mocks.listEspConfigs,
  transitionEspConfig: mocks.transitionEspConfig,
  updateEspConfig: mocks.updateEspConfig,
  upsertEspConfig: mocks.upsertEspConfig,
}));
mock.module("../../mail/transport", () => ({
  invalidateEspTransport: mocks.invalidateEspTransport,
  invalidateTeamTransport: mocks.invalidateTeamTransport,
}));
mock.module("../../team/authority", () => ({
  isTeamAdminOrKey: mocks.isTeamAdminOrKey,
  canManageTeamEsp: mocks.canManageTeamEsp,
}));
mock.module("../../settings/esp/test", () => ({ testEspConfig: mocks.testEspConfig }));

const { espTools } = await import("./esp");

const signal = new AbortController().signal;
const context = {
  authKind: "team_key" as const,
  teamId: "team-1",
  user: null,
  scopes: [] as string[],
  requestId: "",
};
const oauth = {
  ...context,
  authKind: "oauth" as const,
  user: { id: "user-1", email: "owner@example.com" } as any,
  scopes: ["esp:read", "esp:write"],
};
const tools = new Map(espTools().map((tool) => [tool.name, tool]));
const call = (name: string, args: Record<string, unknown> = {}, ctx: any = context) =>
  tools.get(name)!.handler({ context: ctx, args, signal }) as Promise<any>;

beforeEach(() => {
  for (const fn of Object.values(mocks)) fn.mockReset();
  mocks.isTeamAdminOrKey.mockResolvedValue(true);
  mocks.canManageTeamEsp.mockResolvedValue(true);
});

describe("MCP ESP tools", () => {
  it("registers every ESP tool with a title, and confirm on destructive ones", () => {
    expect([...tools.keys()]).toEqual([
      "get_esp_config",
      "update_esp_config",
      "delete_esp_config",
      "send_test_email",
      "list_esps",
      "create_esp",
      "get_esp",
      "check_esp_domain_authentication",
      "update_esp",
      "delete_esp",
      "activate_esp",
      "retire_esp",
      "test_esp",
    ]);
    for (const tool of tools.values()) expect(tool.title).toBeTruthy();
    const retire = tools.get("retire_esp")!.inputSchema as any;
    expect(retire.shape.confirm).toBeDefined();
    expect((tools.get("get_esp")!.inputSchema as any).shape.confirm).toBeUndefined();
  });

  it("returns the public ESP shape and invalidates the transport on update", async () => {
    mocks.upsertEspConfig.mockResolvedValue({
      provider: "smtp",
      host: "smtp.example.com",
      port: 587,
      secure: false,
      username: "user",
      encryptedSecret: "secret",
    });
    const args = {
      provider: "smtp",
      host: "smtp.example.com",
      port: 587,
      secure: false,
    };
    const result = await call("update_esp_config", args);
    expect(mocks.upsertEspConfig).toHaveBeenCalledWith("team-1", args);
    expect(mocks.invalidateTeamTransport).toHaveBeenCalledWith("team-1");
    expect(result).toMatchObject({ provider: "smtp", hasPassword: true });
    expect(result).not.toHaveProperty("encryptedSecret");
  });

  it("requires an explicit destination for API-key test sends", async () => {
    mocks.getEspConfig.mockResolvedValue({ provider: "smtp" });
    mocks.testEspConfig.mockResolvedValue({
      success: false,
      error: "No destination email address available.",
    });
    await expect(call("send_test_email")).resolves.toEqual({
      success: false,
      error: "No destination email address available.",
    });
    expect(mocks.testEspConfig).toHaveBeenCalledWith(
      expect.objectContaining({ account: null, source: "mcp.send_test_email" }),
    );

    mocks.getEspConfig.mockResolvedValue(null);
    await expect(call("send_test_email")).resolves.toEqual({
      success: false,
      error: "No ESP configured for this team yet.",
    });
  });

  it("lists, creates and gets the team's ESPs", async () => {
    mocks.listEspConfigs.mockResolvedValue([
      { espId: "esp_1", name: "Primary" },
      { espId: "esp_2", name: "Backup" },
    ]);
    await expect(call("list_esps")).resolves.toMatchObject({
      items: [{ espId: "esp_1" }, { espId: "esp_2" }],
    });
    expect(mocks.listEspConfigs).toHaveBeenCalledWith("team-1");

    mocks.createEspConfig.mockResolvedValue({ espId: "esp_2", name: "Backup" });
    const args = {
      name: "Backup",
      provider: "smtp",
      host: "smtp.example.com",
      port: 587,
      secure: false,
    };
    await expect(call("create_esp", args)).resolves.toMatchObject({ espId: "esp_2" });
    expect(mocks.createEspConfig).toHaveBeenCalledWith("team-1", args);
    expect(mocks.invalidateTeamTransport).toHaveBeenCalledWith("team-1");

    mocks.getEspConfigByEspId.mockResolvedValue(null);
    await expect(call("get_esp", { espId: "esp_missing" })).resolves.toMatchObject({
      error: { code: "not_found" },
    });
  });

  it("updates an ESP and invalidates its transport, refusing a retired one", async () => {
    mocks.updateEspConfig.mockResolvedValue({ id: "internal-2", espId: "esp_2" });
    await expect(
      call("update_esp", { espId: "esp_2", provider: "smtp" }),
    ).resolves.toMatchObject({ espId: "esp_2" });
    expect(mocks.updateEspConfig).toHaveBeenCalledWith("team-1", "esp_2", {
      provider: "smtp",
    });
    expect(mocks.invalidateEspTransport).toHaveBeenCalledWith("team-1", "internal-2");

    mocks.updateEspConfig.mockRejectedValue(new Error("invalid_lifecycle_transition"));
    await expect(call("update_esp", { espId: "esp_2" })).resolves.toMatchObject({
      error: {
        code: "conflict",
        safeDetails: { reason: "invalid_lifecycle_transition" },
      },
    });

    mocks.updateEspConfig.mockRejectedValue(new Error("connection reset"));
    await expect(call("update_esp", { espId: "esp_2" })).rejects.toThrow(
      "connection reset",
    );
  });

  it("explains why an ESP can't be deleted", async () => {
    mocks.getEspConfigByEspId.mockResolvedValue({ id: "internal-2", espId: "esp_2" });
    mocks.deleteEspConfig.mockRejectedValue(new Error("delivery_source_in_use"));
    const inUse = await call("delete_esp", { espId: "esp_2", confirm: true });
    expect(inUse.error).toMatchObject({
      code: "conflict",
      safeDetails: { reason: "delivery_source_in_use" },
    });
    expect(inUse.error.safeDetails.message).toContain("queued email");

    mocks.deleteEspConfig.mockRejectedValue(new Error("esp_is_default"));
    const isDefault = await call("delete_esp", { espId: "esp_2", confirm: true });
    expect(isDefault.error.safeDetails.message).toContain("default delivery source");
    expect(mocks.invalidateEspTransport).not.toHaveBeenCalled();

    mocks.deleteEspConfig.mockRejectedValue(new Error("esp_has_delivery_history"));
    await expect(call("delete_esp_config", { confirm: true })).resolves.toMatchObject({
      error: { code: "conflict", safeDetails: { reason: "esp_has_delivery_history" } },
    });

    mocks.deleteEspConfig.mockResolvedValue(undefined);
    await expect(
      call("delete_esp", { espId: "esp_2", confirm: true }),
    ).resolves.toEqual({
      message: "ESP configuration removed.",
    });
    expect(mocks.invalidateEspTransport).toHaveBeenCalledWith("team-1", "internal-2");
  });

  it("retires an ESP so it stops sending, and explains a refused retirement", async () => {
    const config = { id: "internal-2", espId: "esp_2", status: "active" };
    mocks.getEspConfigByEspId.mockResolvedValue(config);
    mocks.transitionEspConfig.mockResolvedValue({ ...config, status: "retired" });
    await expect(
      call("retire_esp", { espId: "esp_2", confirm: true }),
    ).resolves.toMatchObject({
      espId: "esp_2",
      status: "retired",
    });
    expect(mocks.transitionEspConfig).toHaveBeenCalledWith(config, "retire", {
      cancel: true,
    });
    expect(mocks.invalidateEspTransport).toHaveBeenCalledWith("team-1", "internal-2");

    mocks.transitionEspConfig.mockRejectedValue(
      new Error("invalid_lifecycle_transition"),
    );
    const refused = await call("retire_esp", { espId: "esp_2", confirm: true });
    expect(refused.error).toMatchObject({
      code: "conflict",
      safeDetails: { reason: "invalid_lifecycle_transition" },
    });
    expect(refused.error.safeDetails.message).toContain("Delete a draft ESP instead");
  });

  it("activates a verified ESP and explains the verification it needs", async () => {
    const config = { id: "internal-2", espId: "esp_2", status: "draft" };
    mocks.getEspConfigByEspId.mockResolvedValue(config);
    mocks.transitionEspConfig.mockResolvedValue({ ...config, status: "active" });
    await expect(call("activate_esp", { espId: "esp_2" })).resolves.toMatchObject({
      status: "active",
    });
    expect(mocks.transitionEspConfig).toHaveBeenCalledWith(config, "activate");

    mocks.transitionEspConfig.mockRejectedValue(new Error("esp_verification_required"));
    await expect(call("activate_esp", { espId: "esp_2" })).resolves.toMatchObject({
      error: {
        code: "validation_failed",
        safeDetails: { reason: "esp_verification_required" },
      },
    });
  });

  it("tests an ESP, sending to the signed-in person by default", async () => {
    mocks.getEspConfigByEspId.mockResolvedValue({ id: "internal-2", espId: "esp_2" });
    mocks.testEspConfig.mockResolvedValue({ success: true });
    await expect(call("test_esp", { espId: "esp_2" }, oauth)).resolves.toEqual({
      success: true,
      error: undefined,
    });
    expect(mocks.getEspConfigByEspId).toHaveBeenCalledWith("team-1", "esp_2");
    expect(mocks.testEspConfig).toHaveBeenCalledWith(
      expect.objectContaining({ account: oauth.user, source: "mcp.test_esp" }),
    );
  });

  it("checks domain authentication and asks for a From address first", async () => {
    mocks.getEspConfigByEspId.mockResolvedValue({ id: "internal-2", espId: "esp_2" });
    mocks.checkAndRememberDomainAuthentication.mockResolvedValue(null);
    await expect(
      call("check_esp_domain_authentication", { espId: "esp_2" }),
    ).resolves.toMatchObject({
      error: {
        code: "validation_failed",
        safeDetails: { reason: "from_email_missing" },
      },
    });
  });

  it("needs the esp:write scope to change an ESP over OAuth", async () => {
    const readOnly = { ...oauth, scopes: ["esp:read"] };
    await expect(call("create_esp", { name: "x" }, readOnly)).resolves.toMatchObject({
      error: {
        code: "forbidden",
        safeDetails: { reason: "insufficient_scope", requiredScope: "esp:write" },
      },
    });
    expect(mocks.createEspConfig).not.toHaveBeenCalled();
  });

  it("keeps ESP changes from a team member, as REST does", async () => {
    mocks.canManageTeamEsp.mockResolvedValue(false);
    mocks.isTeamAdminOrKey.mockResolvedValue(false);
    for (const [name, args] of [
      ["update_esp", { espId: "esp-1", host: "attacker.example" }],
      ["update_esp_config", { host: "attacker.example" }],
      ["test_esp", { espId: "esp-1", to: "me@example.com" }],
      ["create_esp", { name: "x" }],
      ["delete_esp", { espId: "esp-1", confirm: true }],
      ["activate_esp", { espId: "esp-1" }],
      ["retire_esp", { espId: "esp-1", confirm: true }],
    ] as const) {
      await expect(call(name, { ...args }, oauth)).resolves.toMatchObject({
        error: { code: "forbidden", safeDetails: { reason: "team_esp_disabled" } },
      });
    }
    expect(mocks.updateEspConfig).not.toHaveBeenCalled();
    expect(mocks.testEspConfig).not.toHaveBeenCalled();
    expect(mocks.createEspConfig).not.toHaveBeenCalled();
    expect(mocks.canManageTeamEsp).toHaveBeenCalledWith({
      authKind: "oauth",
      teamId: "team-1",
      userId: "user-1",
    });
  });

  it("leaves reading ESPs open to any team member", async () => {
    mocks.canManageTeamEsp.mockResolvedValue(false);
    mocks.listEspConfigs.mockResolvedValue([]);
    await expect(call("list_esps", {}, oauth)).resolves.not.toHaveProperty("error");
  });
});
