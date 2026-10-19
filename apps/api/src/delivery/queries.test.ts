import { beforeEach, describe, expect, it, mock } from "bun:test";

mock.module("../db/client", async () => {
  const { makeTestDb } = await import("../test/db");
  return { db: await makeTestDb() };
});

const { db } = await import("../db/client");
const {
  createEspConfig,
  getEspConfigByEspId,
  recordEspTestResult,
  transitionEspConfig,
} = await import("../settings/esp/queries");
const { seedTeamAndContact, truncateAll } = await import("../test/db");
const { updateTeamDeliverySource } = await import("./queries");
type TestDb = import("../test/db").TestDb;

const tdb = db as unknown as TestDb;

beforeEach(async () => {
  await truncateAll(tdb);
});

describe("updateTeamDeliverySource", () => {
  it("distinguishes an inactive team ESP from an ESP outside the team", async () => {
    const { team } = await seedTeamAndContact(tdb);
    const draft = await createEspConfig(team.id, {
      name: "Marketing",
      provider: "smtp",
      host: "smtp.example.com",
      port: 587,
      secure: false,
      fromEmail: "marketing@example.com",
    });

    await expect(
      updateTeamDeliverySource(team.id, {
        type: "team",
        espId: draft.espId,
      }),
    ).rejects.toThrow("esp_not_active");

    await recordEspTestResult(team.id, "success", undefined, draft.espId);
    const verified = await transitionEspConfig(
      (await getEspConfigByEspId(team.id, draft.espId))!,
      "activate",
    );

    await expect(
      updateTeamDeliverySource(team.id, {
        type: "team",
        espId: verified.espId,
      }),
    ).resolves.toMatchObject({
      defaultTeamEspId: verified.espId,
    });
  });
});
