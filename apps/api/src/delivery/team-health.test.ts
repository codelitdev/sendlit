import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";

mock.module("../db/client", async () => {
  const { makeTestDb } = await import("../test/db");
  return { db: await makeTestDb() };
});

const { db } = await import("../db/client");
const schema = await import("../db/schema");
const { seedTeamAndContact, truncateAll } = await import("../test/db");
const { getTeamsHealth } = await import("./team-health");
type TestDb = import("../test/db").TestDb;

const tdb = db as unknown as TestDb;

beforeEach(async () => {
  await truncateAll(tdb);
  process.env.SHARED_ESP_GUARD = "on";
});

afterEach(() => {
  delete process.env.SHARED_ESP_GUARD;
});

async function setup() {
  const { organization, team } = await seedTeamAndContact(tdb);
  const [other] = await tdb
    .insert(schema.teams)
    .values({ name: "School B", organizationId: organization.id })
    .returning();
  const [esp] = await tdb
    .insert(schema.espConfigs)
    .values({
      ownerScope: "organization",
      organizationId: organization.id,
      name: "District mailbox",
      host: "smtp.example.net",
      fromEmail: "news@district.example.org",
      status: "active",
    })
    .returning();
  for (const t of [team, other]) {
    await tdb.insert(schema.espConfigTeamGrants).values({
      organizationId: organization.id,
      espConfigId: esp.id,
      teamId: t.id,
      createdByType: "user",
    });
  }
  const espControl = (status: string, reasonCode: string) =>
    tdb.insert(schema.sharedEspSendingControls).values({
      organizationId: organization.id,
      espConfigId: esp.id,
      status,
      reasonCode,
    });
  return { team, other, espControl };
}

describe("team health", () => {
  it("reports a mailbox-wide pause on every team on the mailbox", async () => {
    const { team, other, espControl } = await setup();
    await espControl("marketing_paused", "shared_esp_breach");

    const health = await getTeamsHealth([team.id, other.id]);

    for (const id of [team.id, other.id]) {
      expect(health.get(id)).toMatchObject({
        status: "marketing_paused",
        reason: "shared_esp_breach",
        scope: "shared_mailbox",
      });
    }
  });

  it("ignores a mailbox-wide warning, which no single team caused", async () => {
    const { team, espControl } = await setup();
    await espControl("warned", "shared_esp_warning");

    expect((await getTeamsHealth([team.id])).get(team.id)?.status).toBe("normal");
  });

  it("reports the strictest of the team's own and the mailbox's controls", async () => {
    const { team, other, espControl } = await setup();
    await espControl("marketing_paused", "shared_esp_breach");
    await tdb.insert(schema.teamSendingControls).values({
      teamId: team.id,
      status: "all_paused",
      reasonCode: "complaint_rate_critical",
    });

    const health = await getTeamsHealth([team.id, other.id]);

    expect(health.get(team.id)).toMatchObject({
      status: "all_paused",
      reason: "complaint_rate_critical",
      scope: "team",
    });
    expect(health.get(other.id)?.scope).toBe("shared_mailbox");
  });
});
