import { beforeEach, describe, expect, it, mock } from "bun:test";
import express from "express";

const authState = {
  userId: "",
  authKind: "session" as string,
  organizationId: "",
  organizationApiKeyId: "",
  organizationScopes: [] as string[],
};

mock.module("../db/client", async () => {
  const { makeTestDb } = await import("../test/db");
  return { db: await makeTestDb() };
});
mock.module("../auth/middleware", () => ({
  requireAuth: (req: any, _res: any, next: () => void) => {
    req.userId = authState.userId;
    req.authKind = authState.authKind;
    req.organizationId = authState.organizationId;
    req.organizationApiKeyId = authState.organizationApiKeyId;
    req.organizationScopes = authState.organizationScopes;
    next();
  },
}));

const { db } = await import("../db/client");
const { espConfigs, espConfigTeamGrants, outboundMessages, teamSendingControls, user } =
  await import("../db/schema");
const { createTeam } = await import("../team/queries");
const { truncateAll } = await import("../test/db");
type TestDb = import("../test/db").TestDb;
const { requestApp } = await import("../test/http");
const { addOrganizationMemberByEmail, createOrganization } = await import("./queries");
const { default: organizationRoutes } = await import("./routes");

const tdb = db as unknown as TestDb;

function app() {
  const instance = express();
  instance.use(express.json());
  instance.use(organizationRoutes);
  return instance;
}

async function insertUser(name: string) {
  const [account] = await tdb
    .insert(user)
    .values({
      id: crypto.randomUUID(),
      name,
      email: `${name.toLowerCase().replace(/\s+/g, "-")}-${crypto.randomUUID()}@example.com`,
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .returning();
  return account;
}

async function attachTeamEsp(teamId: string) {
  const [esp] = await tdb
    .insert(espConfigs)
    .values({
      ownerScope: "team",
      teamId,
      name: "Default ESP",
      host: "smtp.example.com",
      fromName: "Test Sender",
      fromEmail: "sender@example.com",
      status: "active",
    })
    .returning();
  return esp;
}

async function insertOutbound(input: {
  teamId: string;
  espConfigId: string;
  deliveryStatus: string;
  feedbackStatus?: string;
  sourceType?: "campaign" | "transactional";
  createdAt?: Date;
}) {
  const createdAt = input.createdAt ?? new Date(Date.now() - 60_000);
  const accepted = !["queued", "prepared", "failed", "cancelled"].includes(
    input.deliveryStatus,
  );
  await tdb.insert(outboundMessages).values({
    teamId: input.teamId,
    deliverySourceType: "team",
    espConfigId: input.espConfigId,
    sourceType: input.sourceType ?? "transactional",
    recipientEmail: "recipient@example.com",
    normalizedRecipient: "recipient@example.com",
    provider: "smtp",
    deliveryStatus: input.deliveryStatus,
    feedbackStatus: input.feedbackStatus ?? "none",
    acceptedAt: accepted ? createdAt : null,
    createdAt,
  });
}

beforeEach(async () => {
  await truncateAll(tdb);
  authState.userId = "";
  authState.authKind = "session";
  authState.organizationId = "";
  authState.organizationApiKeyId = "";
  authState.organizationScopes = [];
});

describe("GET /organizations/:organizationId/mail-activity", () => {
  it("returns per-team and total transactional counts, including quiet teams", async () => {
    const owner = await insertUser("Owner");
    const organization = await createOrganization(owner.id, "Acme");
    const bravo = await createTeam({
      organizationId: organization.id,
      name: "Bravo",
    });
    const alpha = await createTeam({
      organizationId: organization.id,
      name: "Alpha",
      externalId: "school:alpha",
    });
    const alphaEsp = await attachTeamEsp(alpha.id);
    const send = (
      deliveryStatus: string,
      extra: Partial<Parameters<typeof insertOutbound>[0]> = {},
    ) =>
      insertOutbound({
        teamId: alpha.id,
        espConfigId: alphaEsp.id,
        deliveryStatus,
        ...extra,
      });
    await send("delivered");
    await send("accepted", { sourceType: "campaign" });
    await send("delivered", { sourceType: "campaign", feedbackStatus: "complained" });
    await send("queued");
    await send("failed");
    await send("bounced", { sourceType: "campaign" });
    await send("cancelled");
    await send("delivered", {
      createdAt: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000),
    });
    authState.userId = owner.id;

    const response = await requestApp(
      app(),
      `/organizations/${organization.organizationId}/mail-activity`,
    );

    expect(response.status).toBe(200);
    const body = response.json();
    expect(body.rangeDays).toBe(7);
    // Campaigns count too: sent is everything the ESP accepted.
    expect(body.totals).toEqual({
      sent: 4,
      queued: 1,
      failed: 1,
      bounced: 1,
      complained: 1,
    });
    expect(body.teams.map((team: { name: string }) => team.name)).toEqual([
      "Alpha",
      "Bravo",
    ]);
    expect(body.teams[0]).toMatchObject({
      teamId: alpha.teamId,
      name: "Alpha",
      status: "active",
      externalId: "school:alpha",
      mail: { sent: 4, queued: 1, failed: 1, bounced: 1, complained: 1 },
      health: {
        status: "normal",
        reason: null,
        scope: null,
        last7Days: { sent: 4, bounced: 1, complained: 1 },
      },
      quota: null,
    });
    expect(body.teams[1]).toMatchObject({
      teamId: bravo.teamId,
      name: "Bravo",
      mail: { sent: 0, queued: 0, failed: 0, bounced: 0, complained: 0 },
    });
    expect(response.body).not.toContain("recipient@example.com");
    expect(JSON.stringify(body)).not.toMatch(/html|subject|toEmail|recipient/);
  });

  it("honors rangeDays=1 and defaults to 7", async () => {
    const owner = await insertUser("Owner");
    const organization = await createOrganization(owner.id, "Acme");
    const team = await createTeam({
      organizationId: organization.id,
      name: "Alpha",
    });
    const esp = await attachTeamEsp(team.id);
    await insertOutbound({
      teamId: team.id,
      espConfigId: esp.id,
      deliveryStatus: "delivered",
      createdAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
    });
    authState.userId = owner.id;

    const defaulted = await requestApp(
      app(),
      `/organizations/${organization.organizationId}/mail-activity`,
    );
    expect(defaulted.json().rangeDays).toBe(7);
    expect(defaulted.json().totals.sent).toBe(1);

    const oneDay = await requestApp(
      app(),
      `/organizations/${organization.organizationId}/mail-activity?rangeDays=1`,
    );
    expect(oneDay.status).toBe(200);
    expect(oneDay.json()).toMatchObject({
      rangeDays: 1,
      totals: { sent: 0, queued: 0, failed: 0, bounced: 0, complained: 0 },
    });
  });

  it("rejects organization members and unknown organizations", async () => {
    const owner = await insertUser("Owner");
    const member = await insertUser("Member");
    const organization = await createOrganization(owner.id, "Acme");
    await addOrganizationMemberByEmail(organization.id, member.email, "member");
    authState.userId = member.id;

    const forbidden = await requestApp(
      app(),
      `/organizations/${organization.organizationId}/mail-activity`,
    );
    expect(forbidden.status).toBe(403);

    authState.userId = owner.id;
    const missing = await requestApp(
      app(),
      "/organizations/org_does-not-exist/mail-activity",
    );
    expect(missing.status).toBe(404);
  });

  it("allows an organization key with usage:read and leaves /usage as quota", async () => {
    const owner = await insertUser("Owner");
    const organization = await createOrganization(owner.id, "Acme");
    const team = await createTeam({
      organizationId: organization.id,
      name: "Alpha",
    });
    const esp = await attachTeamEsp(team.id);
    await insertOutbound({
      teamId: team.id,
      espConfigId: esp.id,
      deliveryStatus: "delivered",
    });
    authState.authKind = "organization_key";
    authState.organizationId = organization.id;
    authState.organizationApiKeyId = crypto.randomUUID();
    authState.organizationScopes = ["usage:read"];

    const activity = await requestApp(
      app(),
      `/organizations/${organization.organizationId}/mail-activity?rangeDays=30`,
    );
    expect(activity.status).toBe(200);
    expect(activity.json()).toMatchObject({
      rangeDays: 30,
      totals: { sent: 1, queued: 0, failed: 0, bounced: 0, complained: 0 },
    });

    const usage = await requestApp(
      app(),
      `/organizations/${organization.organizationId}/usage`,
    );
    expect(usage.status).toBe(200);
    expect(usage.json<unknown>()).toEqual(
      expect.objectContaining({
        day: expect.objectContaining({
          accepted: expect.any(Number),
          reserved: expect.any(Number),
        }),
        month: expect.objectContaining({
          accepted: expect.any(Number),
          reserved: expect.any(Number),
        }),
      }),
    );
    expect(usage.json()).not.toHaveProperty("totals");
    expect(usage.json()).not.toHaveProperty("teams");
    expect(usage.json()).not.toHaveProperty("rangeDays");
  });

  it("shows each team's health and shared-mailbox quota in one call", async () => {
    const owner = await insertUser("Owner");
    const organization = await createOrganization(owner.id, "Acme");
    const paused = await createTeam({ organizationId: organization.id, name: "Alpha" });
    const clean = await createTeam({ organizationId: organization.id, name: "Bravo" });
    const [shared] = await tdb
      .insert(espConfigs)
      .values({
        ownerScope: "organization",
        organizationId: organization.id,
        name: "District mailbox",
        host: "smtp.example.net",
        fromEmail: "news@district.example.org",
        status: "active",
      })
      .returning();
    for (const team of [paused, clean]) {
      await tdb.insert(espConfigTeamGrants).values({
        organizationId: organization.id,
        espConfigId: shared.id,
        teamId: team.id,
        dailyLimit: 500,
        createdByType: "user",
      });
    }
    await tdb.insert(teamSendingControls).values({
      teamId: paused.id,
      status: "marketing_paused",
      reasonCode: "bounce_rate_high",
    });
    authState.authKind = "organization_key";
    authState.organizationId = organization.id;
    authState.organizationApiKeyId = crypto.randomUUID();
    authState.organizationScopes = ["usage:read"];

    const response = await requestApp(
      app(),
      `/organizations/${organization.organizationId}/mail-activity`,
    );

    expect(response.status).toBe(200);
    const [alpha, bravo] = response.json().teams;
    expect(alpha.health).toMatchObject({
      status: "marketing_paused",
      reason: "bounce_rate_high",
      scope: "team",
    });
    expect(alpha.quota.day).toMatchObject({ limit: 500, accepted: 0, remaining: 500 });
    expect(alpha.quota.month).toMatchObject({ limit: null, remaining: null });
    expect(bravo.health).toMatchObject({ status: "normal", scope: null });
    expect(bravo.quota.day.limit).toBe(500);
  });
});
