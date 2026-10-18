import { afterEach, beforeEach, describe, expect, it, mock, vi } from "bun:test";
import { stubEnv, unstubAllEnvs } from "@sendlit/test-utils";

const bootstrapMocks = {
  findUserByEmail: vi.fn(),
  registerConfiguredOrganizationApiKey: vi.fn(),
  ensureDefaultOrganization: vi.fn(),
  getOrganizationMembership: vi.fn(),
  insert: vi.fn(),
  info: vi.fn(),
  error: vi.fn(),
};

mock.module("./apikey/queries", () => ({
  registerConfiguredOrganizationApiKey:
    bootstrapMocks.registerConfiguredOrganizationApiKey,
}));
mock.module("./db/client", () => ({ db: { insert: bootstrapMocks.insert } }));
mock.module("./db/schema", () => ({ user: {} }));
mock.module("./organization/queries", () => ({
  ensureDefaultOrganization: bootstrapMocks.ensureDefaultOrganization,
  getOrganizationMembership: bootstrapMocks.getOrganizationMembership,
}));
mock.module("./services/log", () => ({
  default: { info: bootstrapMocks.info, error: bootstrapMocks.error },
}));
mock.module("./user/queries", () => ({
  findUserByEmail: bootstrapMocks.findUserByEmail,
}));

const { createInitialOrganizationOwnerIfMissing } = await import("./bootstrap");

beforeEach(() => {
  vi.resetAllMocks();
  bootstrapMocks.ensureDefaultOrganization.mockResolvedValue({
    id: "org-internal",
    organizationId: "org_public",
  });
  bootstrapMocks.getOrganizationMembership.mockResolvedValue({
    role: "owner",
  });
  bootstrapMocks.registerConfiguredOrganizationApiKey.mockResolvedValue({
    apiKey: { organizationApiKeyId: "key-id" },
    created: true,
  });
  bootstrapMocks.insert.mockReturnValue({
    values: vi.fn().mockReturnValue({
      returning: vi.fn().mockResolvedValue([
        {
          id: "new-user",
          email: "owner@example.com",
          name: "owner",
        },
      ]),
    }),
  });
});

afterEach(() => {
  unstubAllEnvs();
});

describe("initial organization owner bootstrap", () => {
  it("does not use the old SUPER_ADMIN_EMAIL setting", async () => {
    stubEnv("SUPER_ADMIN_EMAIL", "legacy@example.com");
    stubEnv("BOOTSTRAP_ORGANIZATION_OWNER_EMAIL", "");

    await createInitialOrganizationOwnerIfMissing();

    expect(bootstrapMocks.findUserByEmail).not.toHaveBeenCalled();
    expect(bootstrapMocks.ensureDefaultOrganization).not.toHaveBeenCalled();
  });

  it("ensures the organization for an existing owner on every bootstrap run", async () => {
    stubEnv("BOOTSTRAP_ORGANIZATION_OWNER_EMAIL", "Owner@Example.com");
    bootstrapMocks.findUserByEmail.mockResolvedValue({ id: "existing" });

    await createInitialOrganizationOwnerIfMissing();

    expect(bootstrapMocks.findUserByEmail).toHaveBeenCalledWith("owner@example.com");
    expect(bootstrapMocks.ensureDefaultOrganization).toHaveBeenCalledWith("existing");
    expect(bootstrapMocks.registerConfiguredOrganizationApiKey).not.toHaveBeenCalled();
  });

  it("registers both environment keys without logging their secrets", async () => {
    const setupSecret = `sl_org_live_${"a".repeat(43)}`;
    const runtimeSecret = `sl_org_live_${"b".repeat(43)}`;
    stubEnv("BOOTSTRAP_ORGANIZATION_OWNER_EMAIL", "owner@example.com");
    stubEnv("BOOTSTRAP_DELIVERY_SETUP_API_KEY", setupSecret);
    stubEnv("BOOTSTRAP_TEAM_PROVISIONING_API_KEY", runtimeSecret);
    bootstrapMocks.findUserByEmail.mockResolvedValue({ id: "existing" });

    await createInitialOrganizationOwnerIfMissing();

    expect(bootstrapMocks.registerConfiguredOrganizationApiKey).toHaveBeenNthCalledWith(
      1,
      "org-internal",
      "[Auto-generated] Delivery Setup",
      [
        "organization:read",
        "esps:read",
        "esps:manage",
        "delivery:read",
        "delivery:manage",
      ],
      setupSecret,
      "existing",
    );
    expect(bootstrapMocks.registerConfiguredOrganizationApiKey).toHaveBeenNthCalledWith(
      2,
      "org-internal",
      "[Auto-generated] Team Provisioning",
      ["organization:read", "teams:provision", "teams:read"],
      runtimeSecret,
      "existing",
    );
    const logged = JSON.stringify(bootstrapMocks.info.mock.calls);
    expect(logged).not.toContain(setupSecret);
    expect(logged).not.toContain(runtimeSecret);
  });

  it("fails closed instead of registering keys for a non-owner membership", async () => {
    stubEnv("BOOTSTRAP_ORGANIZATION_OWNER_EMAIL", "owner@example.com");
    stubEnv("BOOTSTRAP_TEAM_PROVISIONING_API_KEY", `sl_org_live_${"b".repeat(43)}`);
    bootstrapMocks.findUserByEmail.mockResolvedValue({ id: "existing" });
    bootstrapMocks.getOrganizationMembership.mockResolvedValue({
      role: "member",
    });

    await expect(createInitialOrganizationOwnerIfMissing()).rejects.toThrow(
      "initial_organization_owner_required",
    );
    expect(bootstrapMocks.registerConfiguredOrganizationApiKey).not.toHaveBeenCalled();
  });

  it("creates a missing initial owner before ensuring the organization", async () => {
    stubEnv("BOOTSTRAP_ORGANIZATION_OWNER_EMAIL", "Owner@Example.com");
    bootstrapMocks.findUserByEmail.mockResolvedValue(null);

    await createInitialOrganizationOwnerIfMissing();

    expect(bootstrapMocks.insert).toHaveBeenCalledTimes(1);
    expect(bootstrapMocks.ensureDefaultOrganization).toHaveBeenCalledWith("new-user");
  });

  it("requires an initial owner email when configured keys are supplied", async () => {
    stubEnv("BOOTSTRAP_ORGANIZATION_OWNER_EMAIL", "");
    stubEnv("BOOTSTRAP_DELIVERY_SETUP_API_KEY", `sl_org_live_${"a".repeat(43)}`);
    stubEnv("BOOTSTRAP_TEAM_PROVISIONING_API_KEY", `sl_org_live_${"b".repeat(43)}`);

    await expect(createInitialOrganizationOwnerIfMissing()).rejects.toThrow(
      "initial_organization_owner_email_required",
    );
  });
});
