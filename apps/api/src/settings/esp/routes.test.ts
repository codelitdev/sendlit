import { beforeEach, describe, expect, it, mock, vi } from "bun:test";
import { eq } from "drizzle-orm";
import express from "express";

const requestContext = { teamId: "", userId: "" };
const transportMocks = {
  invalidateEsp: vi.fn(),
  invalidateTeam: vi.fn(),
};

mock.module("../../mail/rate-limit", () => ({
  dailySendCount: async () => 0,
}));
mock.module("../../db/client", async () => {
  const { makeTestDb } = await import("../../test/db");
  return { db: await makeTestDb() };
});
mock.module("../../auth/middleware", () => ({
  requireAuth: (req: any, _res: any, next: () => void) => {
    req.authKind = "session";
    req.userId = requestContext.userId;
    next();
  },
}));
mock.module("../../auth/require-team", () => ({
  requireTeam: (req: any, _res: any, next: () => void) => {
    req.teamId = requestContext.teamId;
    next();
  },
}));
mock.module("../../mail/transport", () => ({
  invalidateEspTransport: transportMocks.invalidateEsp,
  invalidateTeamTransport: transportMocks.invalidateTeam,
}));
mock.module("./test", () => ({
  testEspConfig: vi.fn().mockResolvedValue({ success: true }),
}));
mock.module("../../observability", () => ({ captureEvent: vi.fn() }));

const { db } = await import("../../db/client");
const { espConfigs, outboundMessages } = await import("../../db/schema");
const { seedTeamAndContact, truncateAll } = await import("../../test/db");
type TestDb = import("../../test/db").TestDb;
const { seedSequence } = await import("../../test/fixtures");
const { requestApp } = await import("../../test/http");
const { createEspConfig, getEspConfigByEspId } = await import("./queries");
const { default: espRoutes } = await import("./routes");

const tdb = db as unknown as TestDb;

function app() {
  const instance = express();
  instance.use(express.json());
  instance.use(espRoutes);
  return instance;
}

beforeEach(async () => {
  await truncateAll(tdb);
  vi.clearAllMocks();
  requestContext.teamId = "";
  requestContext.userId = "";
});

describe("ESP settings routes", () => {
  it("does not expose another team's ESP or stored credentials", async () => {
    const first = await seedTeamAndContact(tdb);
    const second = await seedTeamAndContact(tdb);
    const [otherEsp] = await tdb
      .select()
      .from(espConfigs)
      .where(eq(espConfigs.teamId, second.team.id));
    requestContext.teamId = first.team.id;
    requestContext.userId = first.account.id;

    const response = await requestApp(app(), `/settings/esps/${otherEsp.espId}`);

    expect(response.status).toBe(404);
    expect(response.body).not.toContain("encryptedSecret");
  });

  it("returns credential presence but never encrypted credential material", async () => {
    const owner = await seedTeamAndContact(tdb);
    const config = await createEspConfig(owner.team.id, {
      name: "Marketing",
      provider: "smtp",
      host: "smtp.example.com",
      port: 587,
      secure: false,
      username: "mailer",
      password: "super-secret",
    });
    requestContext.teamId = owner.team.id;
    requestContext.userId = owner.account.id;

    const response = await requestApp(app(), `/settings/esps/${config.espId}`);

    expect(response.status).toBe(200);
    expect(response.json()).toMatchObject({ hasPassword: true });
    expect(response.body).not.toContain("super-secret");
    expect(response.body).not.toContain("encryptedSecret");
    expect(response.body).not.toContain(config.id);
  });

  it("invalidates the pinned cache when updating a team-owned ESP", async () => {
    const owner = await seedTeamAndContact(tdb);
    const config = await createEspConfig(owner.team.id, {
      name: "Marketing",
      provider: "smtp",
      host: "smtp.marketing.example.com",
      port: 587,
      secure: false,
    });
    requestContext.teamId = owner.team.id;
    requestContext.userId = owner.account.id;

    const response = await requestApp(app(), `/settings/esps/${config.espId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ host: "smtp.updated.example.com" }),
    });

    expect(response.status).toBe(200);
    expect(transportMocks.invalidateEsp).toHaveBeenCalledWith(owner.team.id, config.id);
    expect(transportMocks.invalidateTeam).not.toHaveBeenCalled();
  });

  it("refuses to delete a pinned ESP and retains its transport cache", async () => {
    const owner = await seedTeamAndContact(tdb);
    const config = await createEspConfig(owner.team.id, {
      name: "Pinned",
      provider: "smtp",
      host: "smtp.pinned.example.com",
      port: 587,
      secure: false,
    });
    await seedSequence(tdb, {
      teamId: owner.team.id,
      outboxId: config.id,
      emails: [{ emailId: "email_1" }],
    });
    requestContext.teamId = owner.team.id;
    requestContext.userId = owner.account.id;

    const response = await requestApp(app(), `/settings/esps/${config.espId}`, {
      method: "DELETE",
    });

    expect(response.status).toBe(409);
    expect(transportMocks.invalidateEsp).not.toHaveBeenCalled();
    const [stillPresent] = await tdb
      .select()
      .from(espConfigs)
      .where(eq(espConfigs.id, config.id));
    expect(stillPresent).toBeTruthy();
  });

  it("deletes an ESP used only by a completed broadcast", async () => {
    const owner = await seedTeamAndContact(tdb);
    const config = await createEspConfig(owner.team.id, {
      name: "Completed broadcast ESP",
      provider: "smtp",
      host: "smtp.completed.example.com",
      port: 587,
      secure: false,
    });
    await seedSequence(tdb, {
      teamId: owner.team.id,
      type: "broadcast",
      status: "completed",
      outboxId: config.id,
      emails: [{ emailId: "email_completed_broadcast" }],
    });
    await tdb.insert(outboundMessages).values({
      teamId: owner.team.id,
      deliverySourceType: "team",
      espConfigId: config.id,
      espGrantId: null,
      sourceType: "campaign",
      recipientEmail: "recipient@example.com",
      normalizedRecipient: "recipient@example.com",
      provider: "smtp",
      rfcMessageId: "<completed-broadcast@example.com>",
      deliveryStatus: "accepted",
    });
    requestContext.teamId = owner.team.id;
    requestContext.userId = owner.account.id;

    const response = await requestApp(app(), `/settings/esps/${config.espId}`, {
      method: "DELETE",
    });

    expect(response.status).toBe(204);
    await expect(getEspConfigByEspId(owner.team.id, config.espId)).resolves.toBeNull();
  });
});
