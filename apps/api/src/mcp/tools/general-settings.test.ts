import { beforeEach, describe, expect, it, mock } from "bun:test";

mock.module("../../db/client", async () => {
  const { makeTestDb } = await import("../../test/db");
  return { db: await makeTestDb() };
});

const { db } = await import("../../db/client");
const { seedTeamAndContact, truncateAll } = await import("../../test/db");
type TestDb = import("../../test/db").TestDb;
const { generalSettingsTools } = await import("./general-settings");

const tdb = db as unknown as TestDb;
const signal = new AbortController().signal;
const context = {
  authKind: "team_key" as const,
  teamId: "",
  user: null,
  scopes: [] as string[],
  requestId: "",
};
const tools = new Map(generalSettingsTools().map((tool) => [tool.name, tool]));
const call = (name: string, args: Record<string, unknown> = {}) =>
  tools.get(name)!.handler({ context, args, signal }) as Promise<any>;

const bristol = {
  line1: "18 Harbour Lane",
  city: "Bristol",
  postalCode: "BS1 4RN",
  country: "GB",
};

beforeEach(async () => {
  await truncateAll(tdb);
  const { team } = await seedTeamAndContact(tdb);
  context.teamId = team.id;
});

describe("MCP general settings tools", () => {
  it("sets, returns and clears the postal address", async () => {
    await expect(
      call("update_general_settings", { postalAddress: bristol }),
    ).resolves.toEqual({ postalAddress: bristol, updatedAt: expect.any(String) });
    await expect(call("get_general_settings")).resolves.toMatchObject({
      postalAddress: bristol,
    });
    await expect(
      call("update_general_settings", { postalAddress: null }),
    ).resolves.toMatchObject({ postalAddress: null });
  });

  it("maps an unknown country to validation_failed, as REST's 400", async () => {
    await expect(
      call("update_general_settings", { postalAddress: { ...bristol, country: "UK" } }),
    ).resolves.toMatchObject({
      error: {
        code: "validation_failed",
        safeDetails: { reason: "postal_country_invalid" },
      },
    });
  });
});
