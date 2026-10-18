import { beforeEach, describe, expect, it, mock } from "bun:test";

mock.module("../db/client", async () => {
  const { makeTestDb } = await import("../test/db");
  return { db: await makeTestDb() };
});

const { getApiKeysByTeamId } = await import("../apikey/queries");
const { db } = await import("../db/client");
const { seedTeamAndContact, truncateAll } = await import("../test/db");
type TestDb = import("../test/db").TestDb;
const {
  archiveTeam,
  createTeam,
  findOrCreateTeamByExternalId,
  getTeamMembership,
  listTeamsForUser,
} = await import("./queries");

const tdb = db as unknown as TestDb;

beforeEach(async () => {
  await truncateAll(tdb);
});

describe("team queries", () => {
  it("creates a team in an organization with an admin membership", async () => {
    const { account, organization } = await seedTeamAndContact(tdb);
    const team = await createTeam({
      organizationId: organization.id,
      creatorUserId: account.id,
      name: "Main",
    });

    await expect(getTeamMembership(team.id, account.id)).resolves.toEqual(
      expect.objectContaining({ role: "admin" }),
    );
    await expect(listTeamsForUser(account.id)).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: team.id, name: "Main" })]),
    );
    await expect(getApiKeysByTeamId(team.id)).resolves.toEqual([]);
  });

  it("mints a one-time team key only when the caller requests one", async () => {
    const { organization } = await seedTeamAndContact(tdb);
    const team = await createTeam({
      organizationId: organization.id,
      name: "Provisioned",
      withDefaultApiKey: true,
      createdBy: { type: "system" },
    });

    expect(team.defaultApiKeySecret).toMatch(/^sl_live_/);
    await expect(getApiKeysByTeamId(team.id)).resolves.toEqual([
      expect.objectContaining({ teamId: team.id, name: "Default" }),
    ]);
  });

  it("does not expose archived teams in user-facing team enumeration", async () => {
    const { account, organization } = await seedTeamAndContact(tdb);
    const archived = await createTeam({
      organizationId: organization.id,
      creatorUserId: account.id,
      name: "Archived",
    });
    await archiveTeam(archived.id);

    await expect(listTeamsForUser(account.id)).resolves.not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: archived.id })]),
    );
  });

  it("provisions idempotently within one organization", async () => {
    const { organization } = await seedTeamAndContact(tdb);
    const input = {
      organizationId: organization.id,
      externalId: "school:one",
      name: "School One",
      provisioningRequestHash: "request-hash",
      createdBy: { type: "system" as const },
    };

    const first = await findOrCreateTeamByExternalId(input);
    const again = await findOrCreateTeamByExternalId({
      ...input,
      name: "Renamed School",
    });

    expect(again.id).toBe(first.id);
    expect(again.name).toBe("School One");
  });
});
