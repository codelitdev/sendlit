import { beforeEach, describe, expect, it, mock } from "bun:test";
import { eq } from "drizzle-orm";
import express from "express";

const authState = {
  userId: "",
  authKind: "session",
};

mock.module("../db/client", async () => {
  const { makeTestDb } = await import("../test/db");
  return { db: await makeTestDb() };
});
mock.module("../auth/middleware", () => ({
  requireAuth: (req: any, _res: any, next: () => void) => {
    req.userId = authState.userId;
    req.authKind = authState.authKind;
    next();
  },
}));

const { createApiKey } = await import("../apikey/queries");
const { db } = await import("../db/client");
const { teamApiKeys, teamMembers, teams } = await import("../db/schema");
const { seedTeamAndContact, truncateAll } = await import("../test/db");
type TestDb = import("../test/db").TestDb;
const { requestApp } = await import("../test/http");
const { default: teamRoutes } = await import("./routes");

const tdb = db as unknown as TestDb;

function app() {
  const instance = express();
  instance.use(express.json());
  instance.use(teamRoutes);
  return instance;
}

beforeEach(async () => {
  await truncateAll(tdb);
  authState.userId = "";
  authState.authKind = "session";
});

describe("team management route authorization", () => {
  it("rejects team management through a team API key", async () => {
    authState.authKind = "team_key";

    const response = await requestApp(app(), "/teams");

    expect(response.status).toBe(403);
    expect(response.json()).toMatchObject({ error: "user_auth_required" });
  });

  it("does not reveal another user's team or API keys", async () => {
    const first = await seedTeamAndContact(tdb);
    const second = await seedTeamAndContact(tdb);
    await createApiKey(second.team.id, "Private integration");
    authState.userId = first.account.id;

    const response = await requestApp(app(), `/teams/${second.team.teamId}/keys`);

    expect(response.status).toBe(404);
    expect(response.body).not.toContain("Private integration");
  });

  it("prevents a non-organization-admin member from deleting a team", async () => {
    const organizationOwner = await seedTeamAndContact(tdb);
    const member = await seedTeamAndContact(tdb);
    await tdb.insert(teamMembers).values({
      teamId: organizationOwner.team.id,
      userId: member.account.id,
      role: "member",
    });
    authState.userId = member.account.id;

    const response = await requestApp(
      app(),
      `/teams/${organizationOwner.team.teamId}`,
      { method: "DELETE" },
    );

    expect(response.status).toBe(403);
    const [stillPresent] = await tdb
      .select()
      .from(teams)
      .where(eq(teams.id, organizationOwner.team.id));
    expect(stillPresent).toBeTruthy();
  });

  it("returns a new API key once without exposing hashes or internal ids", async () => {
    const owner = await seedTeamAndContact(tdb);
    authState.userId = owner.account.id;

    const created = await requestApp(app(), `/teams/${owner.team.teamId}/keys`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Automation" }),
    });

    expect(created.status).toBe(201);
    expect(created.json()).toMatchObject({
      name: "Automation",
      key: expect.stringMatching(/^sl_live_/),
    });
    expect(created.body).not.toContain("keyHash");
    expect(created.body).not.toContain(owner.team.id);
    expect(await tdb.select().from(teamApiKeys)).toHaveLength(1);
  });
});
