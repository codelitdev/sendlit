import { beforeEach, describe, expect, it, mock, vi } from "bun:test";

const mocks = {
  getTeam: vi.fn(),
  getTeamByTeamId: vi.fn(),
  getTeamMembership: vi.fn(),
  listTeamViewsForUser: vi.fn(),
  createTeam: vi.fn(),
  archiveTeam: vi.fn(),
  renameTeam: vi.fn(),
  getOrganizationMembership: vi.fn(),
  createApiKey: vi.fn(),
  deleteApiKey: vi.fn(),
  getApiKeysByTeamId: vi.fn(),
};
const usageForOrganization = vi.fn();
const getOrganizationEntitlements = vi.fn();
// bun shares module mocks across test files in a process: export everything
// any MCP tool test needs from these modules.
mock.module("../../team/queries", () => ({
  getTeam: mocks.getTeam,
  getTeamByTeamId: mocks.getTeamByTeamId,
  getTeamMembership: mocks.getTeamMembership,
  listTeamViewsForUser: mocks.listTeamViewsForUser,
  createTeam: mocks.createTeam,
  archiveTeam: mocks.archiveTeam,
  renameTeam: mocks.renameTeam,
}));
mock.module("../../organization/queries", () => ({
  getOrganizationMembership: mocks.getOrganizationMembership,
}));
mock.module("../../apikey/queries", () => ({
  createApiKey: mocks.createApiKey,
  deleteApiKey: mocks.deleteApiKey,
  getApiKeysByTeamId: mocks.getApiKeysByTeamId,
}));
mock.module("../../billing/usage.js", () => ({ usageForOrganization }));
mock.module("../../billing/entitlements.js", () => ({ getOrganizationEntitlements }));

const { teamTools } = await import("./teams");
const { PlanGateError } = await import("../../billing/errors");

const signal = new AbortController().signal;
const context = {
  authKind: "team_key" as const,
  teamId: "team-internal-1",
  user: null,
  scopes: [] as string[],
  requestId: "",
};
const owner = {
  id: "user-1",
  email: "owner@example.com",
  name: "Owner",
  defaultOrganizationId: "org-1",
};
const oauth = {
  ...context,
  authKind: "oauth" as const,
  user: owner as any,
  scopes: ["teams:read", "teams:write", "api_keys:read", "api_keys:write"],
};
const tools = new Map(teamTools().map((tool) => [tool.name, tool]));
const planTool = tools.get("get_plan_usage")!;
function call(name: string, args: unknown, ctx: any = oauth): Promise<any> {
  return tools.get(name)!.handler({ context: ctx, args, signal }) as Promise<any>;
}

beforeEach(() => {
  for (const fn of [
    ...Object.values(mocks),
    usageForOrganization,
    getOrganizationEntitlements,
  ]) {
    fn.mockReset();
  }
});

describe("MCP team and API key tools", () => {
  it("serves every team tool in order, each with a title", () => {
    expect([...tools.keys()]).toEqual([
      "list_teams",
      "get_plan_usage",
      "create_team",
      "rename_team",
      "delete_team",
      "list_api_keys",
      "create_api_key",
      "delete_api_key",
    ]);
    for (const tool of tools.values()) expect(tool.title).toBeTruthy();
    for (const name of ["delete_team", "delete_api_key"]) {
      expect(tools.get(name)!.risk).toBe("destructive");
      expect((tools.get(name)!.inputSchema as any).shape.confirm).toBeDefined();
    }
  });

  it("lists the signed-in person's teams, and needs a person", async () => {
    await expect(call("list_teams", {}, context)).resolves.toMatchObject({
      error: { code: "forbidden", safeDetails: { reason: "user_auth_required" } },
    });
    expect(mocks.listTeamViewsForUser).not.toHaveBeenCalled();

    mocks.listTeamViewsForUser.mockResolvedValue([
      {
        id: "team-1",
        teamId: "team-1",
        name: "Main",
        organizationPublicId: "org-1",
        organizationName: "Acme",
        ignored: true,
      },
    ]);
    await expect(call("list_teams", {})).resolves.toEqual({
      items: [
        {
          teamId: "team-1",
          name: "Main",
          organizationId: "org-1",
          organizationName: "Acme",
        },
      ],
    });
    expect(mocks.listTeamViewsForUser).toHaveBeenCalledWith("user-1");
  });

  it("needs the teams:write scope over OAuth", async () => {
    await expect(
      call("create_team", { name: "Second" }, { ...oauth, scopes: ["teams:read"] }),
    ).resolves.toMatchObject({
      error: {
        code: "forbidden",
        safeDetails: { reason: "insufficient_scope", requiredScope: "teams:write" },
      },
    });
    expect(mocks.createTeam).not.toHaveBeenCalled();
  });

  it("creates teams for an organization admin, keeping plan limits", async () => {
    mocks.getOrganizationMembership.mockResolvedValue({ role: "owner" });
    mocks.createTeam.mockResolvedValue({
      id: "internal-team-2",
      teamId: "team-2",
      name: "Second Team",
    });
    await expect(call("create_team", { name: "Second Team" })).resolves.toEqual({
      teamId: "team-2",
      name: "Second Team",
    });
    expect(mocks.createTeam).toHaveBeenCalledWith({
      organizationId: "org-1",
      creatorUserId: "user-1",
      name: "Second Team",
    });

    mocks.createTeam.mockRejectedValueOnce(
      new PlanGateError("plan_limit_reached", { limit: 1 }),
    );
    await expect(call("create_team", { name: "Third" })).resolves.toMatchObject({
      error: {
        code: "forbidden",
        safeDetails: { reason: "plan_limit_reached", limit: 1 },
      },
    });

    mocks.getOrganizationMembership.mockResolvedValue({ role: "member" });
    await expect(call("create_team", { name: "Fourth" })).resolves.toMatchObject({
      error: {
        code: "forbidden",
        safeDetails: { reason: "organization_admin_required" },
      },
    });
    await expect(
      call("create_team", { name: "Fifth" }, context),
    ).resolves.toMatchObject({
      error: { safeDetails: { reason: "user_auth_required" } },
    });
  });

  it("renames the current team", async () => {
    mocks.renameTeam.mockResolvedValue({ teamId: "team-1", name: "Renamed" });
    await expect(call("rename_team", { name: "Renamed" })).resolves.toEqual({
      teamId: "team-1",
      name: "Renamed",
    });
    expect(mocks.renameTeam).toHaveBeenCalledWith("team-internal-1", "Renamed");
    mocks.renameTeam.mockResolvedValue(null);
    await expect(call("rename_team", { name: "X" })).resolves.toMatchObject({
      error: { code: "not_found" },
    });
  });

  it("only lets organization admins delete teams", async () => {
    mocks.getTeamByTeamId.mockResolvedValue({
      id: "internal-team-2",
      teamId: "team-2",
      name: "Second Team",
      organizationId: "org-1",
    });
    mocks.getTeamMembership.mockResolvedValueOnce({ role: "member" });
    mocks.getOrganizationMembership.mockResolvedValueOnce({ role: "member" });
    await expect(
      call("delete_team", { teamId: "team-2", confirm: true }),
    ).resolves.toMatchObject({
      error: {
        code: "forbidden",
        safeDetails: { reason: "organization_admin_required" },
      },
    });
    expect(mocks.archiveTeam).not.toHaveBeenCalled();

    mocks.getTeamMembership.mockResolvedValueOnce({ role: "admin" });
    mocks.getOrganizationMembership.mockResolvedValueOnce({ role: "owner" });
    await expect(
      call("delete_team", { teamId: "team-2", confirm: true }),
    ).resolves.toEqual({
      message: "Team archived.",
    });
    expect(mocks.archiveTeam).toHaveBeenCalledWith("internal-team-2");

    mocks.getTeamMembership.mockResolvedValueOnce(null);
    await expect(
      call("delete_team", { teamId: "team-2", confirm: true }),
    ).resolves.toMatchObject({
      error: { code: "not_found" },
    });
  });

  it("manages API keys over OAuth, never for a team key", async () => {
    await expect(call("list_api_keys", {}, context)).resolves.toMatchObject({
      error: { code: "forbidden", safeDetails: { reason: "user_auth_required" } },
    });
    expect(mocks.getApiKeysByTeamId).not.toHaveBeenCalled();

    mocks.getApiKeysByTeamId.mockResolvedValue([
      {
        teamApiKeyId: "key_1",
        keyPrefix: "sl_live_ab",
        name: "CI",
        createdAt: new Date("2026-10-01T00:00:00.000Z"),
      },
    ]);
    await expect(call("list_api_keys", {})).resolves.toEqual({
      items: [
        {
          id: "key_1",
          keyPrefix: "sl_live_ab",
          name: "CI",
          createdAt: "2026-10-01T00:00:00.000Z",
        },
      ],
    });

    mocks.createApiKey.mockResolvedValue({
      apiKey: {
        teamApiKeyId: "key_2",
        keyPrefix: "sl_live_cd",
        name: "Zapier",
        createdAt: new Date("2026-10-02T00:00:00.000Z"),
      },
      secret: "sl_live_cdsecret",
    });
    await expect(call("create_api_key", { name: "Zapier" })).resolves.toMatchObject({
      id: "key_2",
      key: "sl_live_cdsecret",
    });
    expect(mocks.createApiKey).toHaveBeenCalledWith("team-internal-1", "Zapier", {
      createdByType: "user",
      createdById: "user-1",
    });

    await expect(
      call("delete_api_key", { keyId: "key_2", confirm: true }),
    ).resolves.toEqual({
      message: "API key deleted.",
    });
    expect(mocks.deleteApiKey).toHaveBeenCalledWith("team-internal-1", "key_2");
  });
});

describe("MCP get_plan_usage", () => {
  it("reports usage and limits for the team's organization", async () => {
    mocks.getTeam.mockResolvedValue({ id: "team-internal-1", organizationId: "org-1" });
    usageForOrganization.mockResolvedValue({
      teams: 1,
      subscribedContacts: 10,
      monthlySends: 5,
      monthlySendsReserved: 0,
      bucketStartsAt: "2026-11-01T00:00:00.000Z",
      bucketEndsAt: "2026-12-01T00:00:00.000Z",
    });
    getOrganizationEntitlements.mockResolvedValue({
      plan: "starter",
      paymentStatus: "active",
      cancelAtPeriodEnd: false,
      paidThroughAt: new Date("2026-12-01T00:00:00.000Z"),
      teamsLimit: 1,
      subscribedContactsLimit: 1000,
      monthlySendsLimit: 10000,
    });
    const result = await planTool.handler({ context, args: {}, signal });
    // The context carries the internal team id.
    expect(mocks.getTeam).toHaveBeenCalledWith("team-internal-1");
    expect(usageForOrganization).toHaveBeenCalledWith("org-1");
    expect(result).toMatchObject({
      plan: "starter",
      paidThroughAt: "2026-12-01T00:00:00.000Z",
      monthlySendsLimit: 10000,
    });
    expect(planTool.outputSchema!.safeParse(result).success).toBe(true);
  });

  it("returns not_found when the team is gone", async () => {
    mocks.getTeam.mockResolvedValue(null);
    await expect(
      planTool.handler({ context, args: {}, signal }),
    ).resolves.toMatchObject({
      error: { code: "not_found" },
    });
  });
});
