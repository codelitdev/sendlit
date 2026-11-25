import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";

mock.module("../db/client", async () => {
  const { makeTestDb } = await import("../test/db");
  return { db: await makeTestDb() };
});

const { db } = await import("../db/client");
const schema = await import("../db/schema");
const { and, eq } = await import("drizzle-orm");
const notifications = await import("../billing/notifications");
const { seedTeamAndContact, truncateAll } = await import("../test/db");
const {
  assertSharedEspAllowsMarketing,
  evaluateAllSharedEsps,
  evaluateSharedEsp,
  evaluateSharedEspSoon,
  releaseSharedEspControl,
  stopSharedEspGuard,
} = await import("./shared-esp-guard");
const { runBillingCli } = await import("../billing/operator-cli");
type TestDb = import("../test/db").TestDb;

const tdb = db as unknown as TestDb;
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

let notify: ReturnType<typeof spyOn>;

beforeEach(async () => {
  await truncateAll(tdb);
  process.env.SHARED_ESP_GUARD = "on";
  notify = spyOn(notifications, "notifyOrganizationOwners").mockResolvedValue(
    undefined,
  );
});

afterEach(() => {
  delete process.env.SHARED_ESP_GUARD;
  notify.mockRestore();
});

/** An organization with one shared ESP and three teams granted to it. */
async function setup() {
  const { organization, team, account } = await seedTeamAndContact(tdb);
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
  const others = await tdb
    .insert(schema.teams)
    .values([
      { name: "School B", organizationId: organization.id },
      { name: "School C", organizationId: organization.id },
    ])
    .returning();
  const teams = [team, ...others];
  const grants = new Map<string, string>();
  for (const t of teams) {
    const [grant] = await tdb
      .insert(schema.espConfigTeamGrants)
      .values({
        organizationId: organization.id,
        espConfigId: esp.id,
        teamId: t.id,
        createdByType: "user",
      })
      .returning();
    grants.set(t.id, grant.id);
  }
  return { organization, esp, teams, grants, account };
}

async function sent(
  ctx: Awaited<ReturnType<typeof setup>>,
  teamId: string,
  count: number,
  options: { bounced?: number; complained?: number; acceptedAt?: Date } = {},
) {
  const acceptedAt = options.acceptedAt ?? new Date(Date.now() - HOUR);
  const rows = Array.from({ length: count }, (_, i) => ({
    teamId,
    deliverySourceType: "organization",
    espConfigId: ctx.esp.id,
    espGrantId: ctx.grants.get(teamId)!,
    sourceType: "campaign",
    recipientEmail: `r${i}-${crypto.randomUUID()}@example.com`,
    normalizedRecipient: `r${i}@example.com`,
    provider: "smtp",
    deliveryStatus: i < (options.bounced ?? 0) ? "bounced" : "delivered",
    feedbackStatus: i < (options.complained ?? 0) ? "complained" : "none",
    acceptedAt,
  }));
  await tdb.insert(schema.outboundMessages).values(rows as any);
}

async function controls(espConfigId: string) {
  return tdb
    .select()
    .from(schema.sharedEspSendingControls)
    .where(eq(schema.sharedEspSendingControls.espConfigId, espConfigId));
}

describe("shared ESP guard (integration)", () => {
  it("pauses marketing only for the team with the bad list", async () => {
    const ctx = await setup();
    const [bad, b, c] = ctx.teams;
    await sent(ctx, bad.id, 100, { bounced: 20 });
    await sent(ctx, b.id, 1000, { bounced: 2 });
    await sent(ctx, c.id, 1000);

    await evaluateSharedEsp(ctx.esp.id);

    const rows = await controls(ctx.esp.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      teamId: bad.id,
      status: "marketing_paused",
      reasonCode: "shared_esp_team_breach",
    });
    await expect(
      assertSharedEspAllowsMarketing(bad.id, ctx.esp.id),
    ).rejects.toMatchObject({
      code: "sending_paused",
      details: { reason: "shared_esp_team_breach", scope: "team" },
    });
    await assertSharedEspAllowsMarketing(b.id, ctx.esp.id);
    await assertSharedEspAllowsMarketing(c.id, ctx.esp.id);

    const audit = await tdb
      .select()
      .from(schema.organizationAuditEvents)
      .where(eq(schema.organizationAuditEvents.action, "shared_esp_marketing_paused"));
    expect(audit).toHaveLength(1);
    expect(audit[0].teamId).toBe(bad.id);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(String(notify.mock.calls[0][1])).toBe(
      "Marketing email paused for Test team",
    );
  });

  it("is idempotent when evaluated again", async () => {
    const ctx = await setup();
    await sent(ctx, ctx.teams[0].id, 100, { bounced: 20 });
    await evaluateSharedEsp(ctx.esp.id);
    await evaluateSharedEsp(ctx.esp.id);
    expect(await controls(ctx.esp.id)).toHaveLength(1);
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it("pauses the whole ESP when many teams each send a little bad mail", async () => {
    const ctx = await setup();
    for (const t of ctx.teams) await sent(ctx, t.id, 80, { bounced: 4 });

    await evaluateSharedEsp(ctx.esp.id);

    const [esp] = (await controls(ctx.esp.id)).filter((row) => row.teamId === null);
    expect(esp).toMatchObject({
      status: "marketing_paused",
      reasonCode: "shared_esp_breach",
    });
    await expect(
      assertSharedEspAllowsMarketing(ctx.teams[1].id, ctx.esp.id),
    ).rejects.toMatchObject({ details: { scope: "shared_mailbox" } });
  });

  it("recovers after the hold and three clean days", async () => {
    const ctx = await setup();
    const bad = ctx.teams[0];
    const start = new Date();
    await sent(ctx, bad.id, 100, {
      bounced: 20,
      acceptedAt: new Date(start.getTime() - HOUR),
    });
    await evaluateSharedEsp(ctx.esp.id, start);

    // The bad sends leave the 7-day window, then three clean daily checks.
    for (const days of [8, 9]) {
      await evaluateSharedEsp(ctx.esp.id, new Date(start.getTime() + days * DAY));
      const [row] = await controls(ctx.esp.id);
      expect(row.status).toBe("marketing_paused");
    }
    await evaluateSharedEsp(ctx.esp.id, new Date(start.getTime() + 10 * DAY));
    const [row] = await controls(ctx.esp.id);
    expect(row).toMatchObject({ status: "normal", reasonCode: "shared_esp_recovered" });
    await assertSharedEspAllowsMarketing(bad.id, ctx.esp.id);
  });

  it("lets an operator release a team; old bounces don't re-pause it but new ones do", async () => {
    const ctx = await setup();
    const bad = ctx.teams[0];
    const start = new Date();
    await sent(ctx, bad.id, 100, {
      bounced: 20,
      acceptedAt: new Date(start.getTime() - HOUR),
    });
    await evaluateSharedEsp(ctx.esp.id, start);
    await Bun.sleep(50); // owners are emailed in the background
    notify.mockClear();

    const released = await releaseSharedEspControl({
      espConfigId: ctx.esp.id,
      teamId: bad.id,
      operatorUserId: ctx.account.id,
      operatorReason: "List cleaned with the school",
      now: start,
    });
    expect(released).toBe(true);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(String(notify.mock.calls[0][1])).toBe(
      "Marketing email resumed for Test team",
    );

    await evaluateSharedEsp(ctx.esp.id, new Date(start.getTime() + DAY));
    let [row] = await controls(ctx.esp.id);
    expect(row).toMatchObject({ status: "normal", source: "operator" });
    await assertSharedEspAllowsMarketing(bad.id, ctx.esp.id);

    // A new bad list during the grace still pauses the team.
    await sent(ctx, bad.id, 50, {
      bounced: 10,
      acceptedAt: new Date(start.getTime() + 2 * DAY),
    });
    await evaluateSharedEsp(ctx.esp.id, new Date(start.getTime() + 2 * DAY + HOUR));
    [row] = await controls(ctx.esp.id);
    expect(row).toMatchObject({
      status: "marketing_paused",
      reasonCode: "shared_esp_team_breach",
      source: "automatic",
    });
  });

  it("evaluates bounces that arrive inside the throttle minute once it ends", async () => {
    const ctx = await setup();
    const bad = ctx.teams[0];
    const outbound = { espConfigId: ctx.esp.id, deliverySourceType: "organization" };
    await sent(ctx, bad.id, 100, { bounced: 1 });
    await evaluateSharedEspSoon(outbound);
    expect(await controls(ctx.esp.id)).toHaveLength(0);

    await sent(ctx, bad.id, 20, { bounced: 20 });
    const timers = spyOn(globalThis, "setTimeout");
    await evaluateSharedEspSoon(outbound);
    const throttled = timers.mock.calls.filter(
      (call) => Number(call[1]) > 50_000 && Number(call[1]) <= 60_000,
    );
    timers.mockRestore();
    expect(await controls(ctx.esp.id)).toHaveLength(0);
    expect(throttled).toHaveLength(1);
    const run = throttled[0][0] as () => void;
    await stopSharedEspGuard();
    run();
    await Bun.sleep(50);
    expect(await controls(ctx.esp.id)).toHaveLength(1);
  });

  it("never blocks sends over a bad threshold while the guard is off", async () => {
    const ctx = await setup();
    process.env.SHARED_ESP_GUARD = "off";
    process.env.SHARED_ESP_MIN_ACCEPTED = "0";
    try {
      await assertSharedEspAllowsMarketing(ctx.teams[0].id, ctx.esp.id);
      process.env.SHARED_ESP_GUARD = "on";
      await expect(
        assertSharedEspAllowsMarketing(ctx.teams[0].id, ctx.esp.id),
      ).rejects.toThrow("SHARED_ESP_MIN_ACCEPTED_invalid");
    } finally {
      delete process.env.SHARED_ESP_MIN_ACCEPTED;
    }
  });

  it("ignores team-owned ESPs and does nothing while the guard is off", async () => {
    const ctx = await setup();
    await sent(ctx, ctx.teams[0].id, 100, { bounced: 20 });
    process.env.SHARED_ESP_GUARD = "off";
    await evaluateAllSharedEsps();
    expect(await controls(ctx.esp.id)).toHaveLength(0);

    process.env.SHARED_ESP_GUARD = "on";
    const [teamEsp] = await tdb
      .select()
      .from(schema.espConfigs)
      .where(
        and(
          eq(schema.espConfigs.ownerScope, "team"),
          eq(schema.espConfigs.teamId, ctx.teams[0].id),
        ),
      );
    await evaluateSharedEsp(teamEsp.id);
    expect(await controls(teamEsp.id)).toHaveLength(0);

    await evaluateAllSharedEsps();
    expect(await controls(ctx.esp.id)).toHaveLength(1);
  });

  it("shows and releases pauses from the operator CLI", async () => {
    const ctx = await setup();
    const bad = ctx.teams[0];
    await sent(ctx, bad.id, 100, { bounced: 20 });
    await evaluateSharedEsp(ctx.esp.id);
    const out: string[] = [];
    const io = {
      out: (line: string) => out.push(line),
      err: (line: string) => out.push(line),
    };

    expect(await runBillingCli(["shared-esp-status", ctx.esp.espId], io)).toBe(0);
    const status = JSON.parse(out[0]);
    expect(status.controls).toEqual([
      expect.objectContaining({ team: bad.teamId, status: "marketing_paused" }),
    ]);
    expect(status.lastSevenDays).toContainEqual({
      team: bad.teamId,
      accepted: 100,
      bounced: 20,
      complained: 0,
    });

    const release = [
      "shared-esp-release",
      ctx.esp.espId,
      "--team",
      bad.teamId,
      "--operator",
      ctx.account.id,
      "--reason",
      "cleaned",
    ];
    expect(await runBillingCli(release, io)).toBe(0);
    expect(out.at(-1)).toBe("released");
    await assertSharedEspAllowsMarketing(bad.id, ctx.esp.id);
  });
});
