import { beforeEach, describe, expect, it, mock } from "bun:test";
import { eq } from "drizzle-orm";
import express from "express";

const requestTeam = { id: "" };

mock.module("../db/client", async () => {
  const { makeTestDb } = await import("../test/db");
  return { db: await makeTestDb() };
});
mock.module("../auth/middleware", () => ({
  requireAuth: (_req: any, _res: any, next: () => void) => next(),
}));
mock.module("../auth/require-team", () => ({
  requireTeam: (req: any, _res: any, next: () => void) => {
    req.teamId = requestTeam.id;
    next();
  },
}));

const { db } = await import("../db/client");
const { segments } = await import("../db/schema");
const { seedTeamAndContact, truncateAll } = await import("../test/db");
const { requestApp } = await import("../test/http");
const { createSegment } = await import("./segments-queries");
const { default: segmentRoutes } = await import("./segments-routes");
type TestDb = import("../test/db").TestDb;

const tdb = db as unknown as TestDb;
const emptyFilter = { aggregator: "and" as const, filters: [] };

function app() {
  const instance = express();
  instance.use(express.json());
  instance.use(segmentRoutes);
  return instance;
}

beforeEach(async () => {
  await truncateAll(tdb);
});

describe("segment route tenant isolation", () => {
  it("cannot read, update, or delete another team's segment", async () => {
    const first = await seedTeamAndContact(tdb);
    const second = await seedTeamAndContact(tdb);
    const privateSegment = await createSegment({
      teamId: second.team.id,
      name: "Second team customers",
      filter: emptyFilter,
    });
    requestTeam.id = first.team.id;

    const read = await requestApp(app(), `/segments/${privateSegment.segmentId}`);
    const update = await requestApp(app(), `/segments/${privateSegment.segmentId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Stolen" }),
    });
    const remove = await requestApp(app(), `/segments/${privateSegment.segmentId}`, {
      method: "DELETE",
    });

    expect(read.status).toBe(404);
    expect(update.status).toBe(404);
    expect(remove.status).toBe(204);
    const [unchanged] = await tdb
      .select()
      .from(segments)
      .where(eq(segments.id, privateSegment.id));
    expect(unchanged.name).toBe("Second team customers");
  });

  it("returns 409 for duplicate names within one team but permits them across teams", async () => {
    const first = await seedTeamAndContact(tdb);
    const second = await seedTeamAndContact(tdb);
    await createSegment({
      teamId: first.team.id,
      name: "Customers",
      filter: emptyFilter,
    });
    await createSegment({
      teamId: second.team.id,
      name: "Customers",
      filter: emptyFilter,
    });
    requestTeam.id = first.team.id;

    const response = await requestApp(app(), "/segments", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Customers", filter: emptyFilter }),
    });

    expect(response.status).toBe(409);
  });

  it("never serializes internal ids", async () => {
    const first = await seedTeamAndContact(tdb);
    const segment = await createSegment({
      teamId: first.team.id,
      name: "Customers",
      filter: emptyFilter,
    });
    requestTeam.id = first.team.id;

    const response = await requestApp(app(), "/segments");

    expect(response.status).toBe(200);
    expect(response.body).toContain(segment.segmentId);
    expect(response.body).not.toContain(segment.id);
    expect(response.body).not.toContain(first.team.id);
  });
});
