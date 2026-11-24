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
  it("accepts a postal address and returns it with its formatted text", async () => {
    await expect(
      call("update_general_settings", { postalAddress: bristol }),
    ).resolves.toMatchObject({
      mailingAddress: "18 Harbour Lane\nBristol, BS1 4RN\nUnited Kingdom",
      postalAddress: bristol,
    });
    await expect(call("get_general_settings")).resolves.toMatchObject({
      postalAddress: bristol,
    });
    await expect(
      call("update_general_settings", { mailingAddress: "PO Box 7" }),
    ).resolves.toMatchObject({ mailingAddress: "PO Box 7", postalAddress: null });
  });

  it("maps REST's address errors to validation_failed", async () => {
    for (const [args, reason] of [
      [{ mailingAddress: "x", postalAddress: bristol }, "postal_address_conflict"],
      [{ postalAddress: { ...bristol, country: "UK" } }, "postal_country_invalid"],
    ] as const) {
      await expect(call("update_general_settings", args)).resolves.toMatchObject({
        error: { code: "validation_failed", safeDetails: { reason } },
      });
    }
  });
});
