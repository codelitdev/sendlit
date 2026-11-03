import { beforeEach, describe, expect, it, mock, vi } from "bun:test";

const mocks = {
  getTeamMembership: vi.fn(),
  getTeamDeliverySetting: vi.fn(),
};

mock.module("./queries", () => ({ getTeamMembership: mocks.getTeamMembership }));
mock.module("../delivery/queries", () => ({
  getTeamDeliverySetting: mocks.getTeamDeliverySetting,
}));

const { canManageTeamEsp, isTeamAdminOrKey } = await import("./authority");

const user = { authKind: "oauth", teamId: "team-1", userId: "user-1" };

beforeEach(() => {
  for (const fn of Object.values(mocks)) fn.mockReset();
  mocks.getTeamDeliverySetting.mockResolvedValue({ teamEspEnabled: true });
});

describe("team authority", () => {
  it("lets team admins and team keys through, but not members or anonymous callers", async () => {
    mocks.getTeamMembership.mockResolvedValue({ role: "admin" });
    expect(await isTeamAdminOrKey(user)).toBe(true);
    mocks.getTeamMembership.mockResolvedValue({ role: "member" });
    expect(await isTeamAdminOrKey(user)).toBe(false);
    mocks.getTeamMembership.mockResolvedValue(null);
    expect(await isTeamAdminOrKey(user)).toBe(false);
    expect(await isTeamAdminOrKey({ authKind: "oauth", teamId: "team-1" })).toBe(false);
    expect(await isTeamAdminOrKey({ authKind: "team_key", teamId: "team-1" })).toBe(
      true,
    );
  });

  it("also needs the organization to allow team ESPs", async () => {
    mocks.getTeamMembership.mockResolvedValue({ role: "admin" });
    expect(await canManageTeamEsp(user)).toBe(true);
    mocks.getTeamDeliverySetting.mockResolvedValue({ teamEspEnabled: false });
    expect(await canManageTeamEsp(user)).toBe(false);
    expect(await canManageTeamEsp({ authKind: "team_key", teamId: "team-1" })).toBe(
      false,
    );
    mocks.getTeamDeliverySetting.mockResolvedValue(null);
    expect(await canManageTeamEsp(user)).toBe(false);
  });
});
