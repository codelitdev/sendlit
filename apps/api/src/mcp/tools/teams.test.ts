import { beforeEach, describe, expect, it, mock, vi } from "bun:test";

const getTeam = vi.fn();
const usageForOrganization = vi.fn();
const getOrganizationEntitlements = vi.fn();
mock.module("../../team/queries", () => ({ getTeam }));
mock.module("../../billing/usage.js", () => ({ usageForOrganization }));
mock.module("../../billing/entitlements.js", () => ({ getOrganizationEntitlements }));

const { teamTools } = await import("./teams");

const signal = new AbortController().signal;
const context = {
  authKind: "team_key" as const,
  teamId: "team-internal-1",
  user: null,
  scopes: [],
  requestId: "",
  clientIp: "",
  replayHeaders: {},
};
const [tool] = teamTools();

beforeEach(() => {
  for (const fn of [getTeam, usageForOrganization, getOrganizationEntitlements]) {
    fn.mockReset();
  }
});

describe("MCP get_plan_usage", () => {
  it("is the only dedicated team tool", () => {
    expect(teamTools().map((t) => t.name)).toEqual(["get_plan_usage"]);
  });

  it("reports usage and limits for the team's organization", async () => {
    getTeam.mockResolvedValue({ id: "team-internal-1", organizationId: "org-1" });
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
    const result = await tool!.handler({ context, args: {}, signal });
    // The context carries the internal team id.
    expect(getTeam).toHaveBeenCalledWith("team-internal-1");
    expect(usageForOrganization).toHaveBeenCalledWith("org-1");
    expect(result).toMatchObject({
      plan: "starter",
      paidThroughAt: "2026-12-01T00:00:00.000Z",
      monthlySendsLimit: 10000,
    });
    expect(tool!.outputSchema!.safeParse(result).success).toBe(true);
  });

  it("returns not_found when the team is gone", async () => {
    getTeam.mockResolvedValue(null);
    await expect(tool!.handler({ context, args: {}, signal })).resolves.toMatchObject({
      error: { code: "not_found" },
    });
  });
});
