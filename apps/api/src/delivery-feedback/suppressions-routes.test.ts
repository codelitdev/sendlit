import { beforeEach, describe, expect, it, mock } from "bun:test";
import express from "express";

const requestContext = { teamId: "", accountId: "" };

mock.module("../db/client", async () => {
  const { makeTestDb } = await import("../test/db");
  return { db: await makeTestDb() };
});
mock.module("../auth/middleware", () => ({
  requireAuth: (req: any, _res: any, next: () => void) => {
    req.accountId = requestContext.accountId;
    next();
  },
}));
mock.module("../auth/require-team", () => ({
  requireTeam: (req: any, _res: any, next: () => void) => {
    req.teamId = requestContext.teamId;
    next();
  },
}));
mock.module("../observability", () => ({ captureEvent: mock() }));

const { db } = await import("../db/client");
const { seedTeamAndContact, truncateAll } = await import("../test/db");
const { requestApp } = await import("../test/http");
const { addOrStrengthenSuppression, getSuppressionBySuppressionId } = await import(
  "./suppression-queries"
);
const { default: suppressionRoutes } = await import("./suppressions-routes");
type TestDb = import("../test/db").TestDb;

const tdb = db as unknown as TestDb;

function app() {
  const instance = express();
  instance.use(express.json());
  instance.use(suppressionRoutes);
  return instance;
}

beforeEach(async () => {
  await truncateAll(tdb);
});

describe("suppression route tenant isolation", () => {
  it("lists only the current team's suppressions", async () => {
    const first = await seedTeamAndContact(tdb);
    const second = await seedTeamAndContact(tdb);
    await addOrStrengthenSuppression({
      teamId: first.team.id,
      recipientEmail: "first@example.com",
      reason: "hard_bounce",
      actorType: "system",
    });
    await addOrStrengthenSuppression({
      teamId: second.team.id,
      recipientEmail: "second@example.com",
      reason: "complaint",
      actorType: "system",
    });
    requestContext.teamId = first.team.id;
    requestContext.accountId = first.account.id;

    const response = await requestApp(app(), "/suppressions?offset=1&itemsPerPage=20");

    expect(response.status).toBe(200);
    expect(response.body).toContain("first@example.com");
    expect(response.body).not.toContain("second@example.com");
    expect(response.json()).toMatchObject({ total: 1 });
  });

  it("cannot read or release another team's suppression", async () => {
    const first = await seedTeamAndContact(tdb);
    const second = await seedTeamAndContact(tdb);
    const privateSuppression = await addOrStrengthenSuppression({
      teamId: second.team.id,
      recipientEmail: "private@example.com",
      reason: "hard_bounce",
      actorType: "system",
    });
    requestContext.teamId = first.team.id;
    requestContext.accountId = first.account.id;

    const read = await requestApp(
      app(),
      `/suppressions/${privateSuppression.suppressionId}`,
    );
    const release = await requestApp(
      app(),
      `/suppressions/${privateSuppression.suppressionId}/release`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ explanation: "not ours" }),
      },
    );

    expect(read.status).toBe(404);
    expect(release.status).toBe(404);
    expect(
      await getSuppressionBySuppressionId(
        second.team.id,
        privateSuppression.suppressionId,
      ),
    ).toMatchObject({ active: true });
  });

  it("maps a non-releasable complaint to 409", async () => {
    const owner = await seedTeamAndContact(tdb);
    const complaint = await addOrStrengthenSuppression({
      teamId: owner.team.id,
      recipientEmail: "complaint@example.com",
      reason: "complaint",
      actorType: "system",
    });
    requestContext.teamId = owner.team.id;
    requestContext.accountId = owner.account.id;

    const response = await requestApp(
      app(),
      `/suppressions/${complaint.suppressionId}/release`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ explanation: "false positive" }),
      },
    );

    expect(response.status).toBe(409);
    expect(response.json()).toMatchObject({
      error: "suppression_not_releasable",
    });
  });
});
