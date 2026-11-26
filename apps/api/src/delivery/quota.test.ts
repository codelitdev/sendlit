import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  mock,
  setSystemTime,
} from "bun:test";

mock.module("../db/client", async () => {
  const { makeTestDb } = await import("../test/db");
  return { db: await makeTestDb() };
});

const { db } = await import("../db/client");
const schema = await import("../db/schema");
const { eq } = await import("drizzle-orm");
const { seedTeamAndContact, truncateAll } = await import("../test/db");
const {
  commitQuotaForOutbound,
  getOrganizationQuotaUsage,
  getTeamQuotaUsage,
  releaseQuotaForOutbound,
  reserveOrganizationQuotaForOutbound,
} = await import("./quota");
type TestDb = import("../test/db").TestDb;

const tdb = db as unknown as TestDb;

beforeEach(async () => {
  await truncateAll(tdb);
});

afterEach(() => {
  setSystemTime();
});

async function setup() {
  const { organization, team } = await seedTeamAndContact(tdb);
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
  const [grant] = await tdb
    .insert(schema.espConfigTeamGrants)
    .values({
      organizationId: organization.id,
      espConfigId: esp.id,
      teamId: team.id,
      createdByType: "user",
    })
    .returning();
  return { organization, team, esp, grant };
}

async function reserveOne(ctx: Awaited<ReturnType<typeof setup>>) {
  const [outbound] = await tdb
    .insert(schema.outboundMessages)
    .values({
      teamId: ctx.team.id,
      deliverySourceType: "organization",
      espConfigId: ctx.esp.id,
      espGrantId: ctx.grant.id,
      sourceType: "campaign",
      submissionKey: `test-${crypto.randomUUID()}`,
      recipientEmail: "student@example.com",
      normalizedRecipient: "student@example.com",
      provider: "smtp",
      rfcMessageId: `<${crypto.randomUUID()}@example.com>`,
    })
    .returning();
  await reserveOrganizationQuotaForOutbound({
    outboundMessageId: outbound.id,
    grantId: ctx.grant.id,
  });
  return outbound;
}

describe("organization ESP quota", () => {
  // On the 1st the day and month buckets start at the same instant, so each
  // bucket must be matched by its period type as well as its start.
  it("counts a send once on the first day of the month", async () => {
    setSystemTime(new Date("2026-12-01T10:00:00Z"));
    const ctx = await setup();
    const committed = await reserveOne(ctx);
    const released = await reserveOne(ctx);

    await commitQuotaForOutbound(committed.id);
    await releaseQuotaForOutbound(released.id, "provider_rejected");

    const window = { accepted: 1, reserved: 0 };
    await expect(getTeamQuotaUsage(ctx.team.id)).resolves.toMatchObject({
      day: window,
      month: window,
    });
    await expect(getOrganizationQuotaUsage(ctx.organization.id)).resolves.toMatchObject(
      { day: window, month: window },
    );
    const buckets = await tdb
      .select()
      .from(schema.organizationEspUsageBuckets)
      .where(
        eq(schema.organizationEspUsageBuckets.organizationId, ctx.organization.id),
      );
    expect(buckets).toHaveLength(4);
    for (const bucket of buckets) {
      expect(bucket).toMatchObject({ acceptedCount: 1, reservedCount: 0 });
    }
  });
});
