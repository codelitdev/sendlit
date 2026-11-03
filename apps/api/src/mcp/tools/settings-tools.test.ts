import { beforeEach, describe, expect, it, mock, vi } from "bun:test";

const mocks = {
  getTrackingDomain: vi.fn(),
  setTrackingDomain: vi.fn(),
  verifyTrackingDomain: vi.fn(),
  startGoogleConnect: vi.fn(),
  deleteConnection: vi.fn(),
  getReputation: vi.fn(),
  connectSnds: vi.fn(),
  syncTeamNow: vi.fn(),
  consumeRateLimit: vi.fn(),
  isTeamAdminOrKey: vi.fn(),
  canManageTeamEsp: vi.fn(),
};

class FakeSndsLinkError extends Error {}

mock.module("../../settings/tracking-domain/queries", () => ({
  getTrackingDomain: mocks.getTrackingDomain,
  setTrackingDomain: mocks.setTrackingDomain,
  verifyTrackingDomain: mocks.verifyTrackingDomain,
  toPublicTrackingDomain: (domain: unknown) => domain,
}));
mock.module("../../team/authority", () => ({
  isTeamAdminOrKey: mocks.isTeamAdminOrKey,
  canManageTeamEsp: mocks.canManageTeamEsp,
}));
mock.module("../../reputation/google", () => ({
  startGoogleConnect: mocks.startGoogleConnect,
}));
mock.module("../../reputation/queries", () => ({
  deleteConnection: mocks.deleteConnection,
  getReputation: mocks.getReputation,
}));
mock.module("../../reputation/snds", () => ({ SndsLinkError: FakeSndsLinkError }));
mock.module("../../reputation/sync", () => ({
  connectSnds: mocks.connectSnds,
  syncTeamNow: mocks.syncTeamNow,
}));
mock.module("../../services/rate-counter", () => ({
  consumeRateLimit: mocks.consumeRateLimit,
}));

const { trackingDomainTools } = await import("./tracking-domain");
const { reputationTools } = await import("./reputation");

const signal = new AbortController().signal;
const context = {
  authKind: "team_key" as const,
  teamId: "team-1",
  user: null,
  scopes: [] as string[],
  requestId: "",
};
const tools = new Map(
  [...trackingDomainTools(), ...reputationTools()].map((tool) => [tool.name, tool]),
);
const call = (name: string, args: Record<string, unknown> = {}, ctx: any = context) =>
  tools.get(name)!.handler({ context: ctx, args, signal }) as Promise<any>;

beforeEach(() => {
  for (const fn of Object.values(mocks)) fn.mockReset();
  mocks.isTeamAdminOrKey.mockResolvedValue(true);
  mocks.canManageTeamEsp.mockResolvedValue(true);
});

describe("MCP tracking domain tools", () => {
  it("sets the domain for the team and maps REST's error codes", async () => {
    mocks.setTrackingDomain.mockResolvedValue({ domain: "track.example.com" });
    await expect(
      call("set_tracking_domain", { domain: "track.example.com" }),
    ).resolves.toEqual({ domain: "track.example.com" });
    expect(mocks.setTrackingDomain).toHaveBeenCalledWith("team-1", "track.example.com");

    for (const [reason, code] of [
      ["tracking_domain_invalid", "validation_failed"],
      ["tracking_domain_taken", "conflict"],
    ]) {
      mocks.setTrackingDomain.mockRejectedValueOnce(new Error(reason));
      await expect(call("set_tracking_domain", { domain: "x" })).resolves.toMatchObject(
        {
          error: { code, safeDetails: { reason } },
        },
      );
    }

    mocks.verifyTrackingDomain.mockRejectedValueOnce(
      new Error("tracking_domain_not_set"),
    );
    await expect(call("verify_tracking_domain")).resolves.toMatchObject({
      error: {
        code: "validation_failed",
        safeDetails: { reason: "tracking_domain_not_set" },
      },
    });

    mocks.verifyTrackingDomain.mockRejectedValueOnce(new Error("dns exploded"));
    await expect(call("verify_tracking_domain")).rejects.toThrow("dns exploded");
  });

  it("needs settings:write over OAuth", async () => {
    const oauth = { ...context, authKind: "oauth", scopes: ["settings:read"] };
    await expect(
      call("set_tracking_domain", { domain: null }, oauth),
    ).resolves.toMatchObject({
      error: { code: "forbidden", safeDetails: { reason: "insufficient_scope" } },
    });
  });
});

describe("MCP reputation tools", () => {
  it("keeps connecting and disconnecting accounts from a team member, as REST does", async () => {
    mocks.isTeamAdminOrKey.mockResolvedValue(false);
    const member = {
      ...context,
      authKind: "oauth" as const,
      user: { id: "user-1" },
      scopes: ["settings:read", "settings:write"],
    };
    for (const [name, args] of [
      ["connect_google_postmaster", {}],
      ["disconnect_google_postmaster", { confirm: true }],
      [
        "connect_snds",
        { dataUrl: "https://sendersupport.olc.protection.outlook.com/x" },
      ],
      ["disconnect_snds", { confirm: true }],
    ] as const) {
      await expect(call(name, { ...args }, member)).resolves.toMatchObject({
        error: { code: "forbidden", safeDetails: { reason: "team_admin_required" } },
      });
    }
    expect(mocks.startGoogleConnect).not.toHaveBeenCalled();
    expect(mocks.connectSnds).not.toHaveBeenCalled();
    expect(mocks.deleteConnection).not.toHaveBeenCalled();
  });

  it("returns the Google sign-in URL, or says Postmaster isn't configured", async () => {
    mocks.startGoogleConnect.mockReturnValue("https://accounts.google.com/x");
    await expect(call("connect_google_postmaster")).resolves.toEqual({
      authorizationUrl: "https://accounts.google.com/x",
    });
    expect(mocks.startGoogleConnect).toHaveBeenCalledWith("team-1", null);

    mocks.startGoogleConnect.mockReturnValue(null);
    await expect(call("connect_google_postmaster")).resolves.toMatchObject({
      error: {
        code: "conflict",
        safeDetails: { reason: "google_postmaster_not_configured" },
      },
    });
  });

  it("reports an invalid SNDS link and a missing connection", async () => {
    mocks.connectSnds.mockRejectedValueOnce(new FakeSndsLinkError("bad"));
    await expect(
      call("connect_snds", {
        dataUrl: "https://sendersupport.olc.protection.outlook.com/x",
      }),
    ).resolves.toMatchObject({
      error: {
        code: "validation_failed",
        safeDetails: { reason: "snds_link_invalid" },
      },
    });

    mocks.deleteConnection.mockResolvedValue(false);
    await expect(call("disconnect_snds", { confirm: true })).resolves.toMatchObject({
      error: { code: "not_found" },
    });
    mocks.deleteConnection.mockResolvedValue(true);
    await expect(
      call("disconnect_google_postmaster", { confirm: true }),
    ).resolves.toEqual({
      disconnected: true,
    });
    expect(mocks.deleteConnection).toHaveBeenCalledWith("team-1", "google_postmaster");
  });

  it("limits manual syncs to once every five minutes", async () => {
    mocks.consumeRateLimit.mockResolvedValue(false);
    await expect(call("sync_reputation")).resolves.toMatchObject({
      error: { code: "rate_limited", safeDetails: { reason: "too_many_requests" } },
    });
    expect(mocks.syncTeamNow).not.toHaveBeenCalled();

    mocks.consumeRateLimit.mockResolvedValue(true);
    mocks.getReputation.mockResolvedValue({ alerts: [] });
    await expect(call("sync_reputation")).resolves.toEqual({ alerts: [] });
    expect(mocks.syncTeamNow).toHaveBeenCalledWith("team-1");
  });
});
