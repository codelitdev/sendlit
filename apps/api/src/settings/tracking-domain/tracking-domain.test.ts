import { beforeEach, describe, expect, it, mock } from "bun:test";
import { eq } from "drizzle-orm";
import express from "express";

mock.module("../../db/client", async () => {
  const { makeTestDb } = await import("../../test/db.js");
  return { db: await makeTestDb() };
});

const { db } = await import("../../db/client");
const { settings } = await import("../../db/schema");
const { seedTeamAndContact, truncateAll } = await import("../../test/db");
type TestDb = import("../../test/db").TestDb;
const { requestApp } = await import("../../test/http");
const {
  checkTrackingDomain,
  getTrackingDomain,
  normalizeTrackingDomain,
  recheckTrackingDomains,
  setTrackingDomain,
  trackingOrigin,
} = await import("./queries");
const { default: publicRoutes, trackingHostGuard } = await import("./public-routes");

const tdb = db as unknown as TestDb;

beforeEach(async () => {
  await truncateAll(tdb);
});

/** Marks the team's domain verified, as a passing check would. */
async function markVerified(teamId: string, checkedAt = new Date()) {
  await tdb
    .update(settings)
    .set({
      trackingDomainStatus: "verified",
      trackingDomainVerifiedAt: checkedAt,
      trackingDomainCheckedAt: checkedAt,
    })
    .where(eq(settings.teamId, teamId));
}

describe("normalizeTrackingDomain", () => {
  it("accepts a subdomain and cleans it up", () => {
    expect(normalizeTrackingDomain(" https://Track.Example.com./ ")).toBe(
      "track.example.com",
    );
  });

  it("rejects root domains, junk and SendLit's own host", () => {
    for (const input of ["example.com", "not a domain", "1.2.3.4", "x.sendlit.test"]) {
      expect(() => normalizeTrackingDomain(input)).toThrow("tracking_domain_invalid");
    }
  });
});

describe("setTrackingDomain", () => {
  it("starts pending, can't be shared, and keeps a verified domain as retired", async () => {
    const { team } = await seedTeamAndContact(tdb);
    const other = await seedTeamAndContact(tdb);

    const set = await setTrackingDomain(team.id, "track.example.com");
    expect(set).toMatchObject({
      domain: "track.example.com",
      status: "pending",
      cnameTarget: "sendlit.test",
    });
    await expect(setTrackingDomain(other.team.id, "TRACK.example.com")).rejects.toThrow(
      "tracking_domain_taken",
    );

    await markVerified(team.id);
    await setTrackingDomain(team.id, "links.example.com");
    const [row] = await tdb.select().from(settings).where(eq(settings.teamId, team.id));
    expect(row.retiredTrackingDomains).toEqual(["track.example.com"]);

    expect(await setTrackingDomain(team.id, null)).toMatchObject({
      domain: null,
      status: null,
    });
  });
});

describe("checkTrackingDomain", () => {
  const probe = (body: unknown, ok = true) =>
    (async () =>
      ({
        ok,
        json: async () => body,
      }) as unknown as Response) as unknown as typeof fetch;

  it("needs the CNAME and an HTTPS answer from SendLit", async () => {
    const cname = async () => ["SENDLIT.TEST."];
    expect(
      await checkTrackingDomain("t.example.com", {
        resolveCname: cname,
        fetch: probe({ service: "sendlit-tracking" }),
      }),
    ).toBeNull();
    expect(
      await checkTrackingDomain("t.example.com", {
        resolveCname: async () => ["elsewhere.example.net"],
        fetch: probe({ service: "sendlit-tracking" }),
      }),
    ).toBe("cname_mismatch");
    expect(
      await checkTrackingDomain("t.example.com", {
        resolveCname: async () => {
          throw Object.assign(new Error("nope"), { code: "ENOTFOUND" });
        },
      }),
    ).toBe("cname_missing");
    expect(
      await checkTrackingDomain("t.example.com", {
        resolveCname: cname,
        fetch: probe({ hello: "world" }),
      }),
    ).toBe("unreachable");
  });
});

describe("recheckTrackingDomains", () => {
  it("falls back to SendLit's host after three failed daily checks", async () => {
    const { team } = await seedTeamAndContact(tdb);
    await setTrackingDomain(team.id, "track.example.com");
    const day = 24 * 60 * 60 * 1000;
    const start = Date.now() - 10 * day;
    await markVerified(team.id, new Date(start));
    const row = async () =>
      (await tdb.select().from(settings).where(eq(settings.teamId, team.id)))[0];
    expect(trackingOrigin(await row())).toBe("https://track.example.com");

    // The CNAME was removed: every recheck fails.
    const gone = {
      resolveCname: async () => {
        throw Object.assign(new Error("gone"), { code: "ENOTFOUND" });
      },
    };
    for (let i = 1; i <= 3; i++) {
      expect(
        await recheckTrackingDomains(new Date(start + i * (day + 1000)), gone),
      ).toBe(1);
      expect((await row()).trackingDomainStatus).toBe(i < 3 ? "verified" : "failed");
    }
    expect(trackingOrigin(await row())).toBeUndefined();
    expect((await getTrackingDomain(team.id)).error).not.toBeNull();
    // Not due again until tomorrow.
    expect(
      await recheckTrackingDomains(new Date(start + 3 * (day + 1000) + 1000), gone),
    ).toBe(0);
  });
});

describe("tracking domain host", () => {
  function app() {
    const instance = express();
    instance.use(trackingHostGuard);
    instance.use(publicRoutes);
    instance.get(["/track/open", "/api/auth/session"], (_req, res) => {
      res.send("ok");
    });
    return instance;
  }

  it("serves only tracking routes on a team's current or retired domain", async () => {
    const { team } = await seedTeamAndContact(tdb);
    await setTrackingDomain(team.id, "track.example.com");
    await markVerified(team.id);
    await setTrackingDomain(team.id, "links.example.com");
    const on = (host: string, path: string) =>
      requestApp(app(), path, { headers: { host } });

    for (const host of ["links.example.com", "track.example.com"]) {
      expect((await on(host, "/track/open")).status).toBe(200);
      expect((await on(host, "/api/auth/session")).status).toBe(404);
    }
    expect((await on("api.sendlit.test", "/api/auth/session")).status).toBe(200);
    expect(
      (await on("links.example.com", "/.well-known/sendlit-tracking")).json(),
    ).toEqual({ service: "sendlit-tracking" });
  });

  it("allows certificates only for teams' domains", async () => {
    const { team } = await seedTeamAndContact(tdb);
    await setTrackingDomain(team.id, "track.example.com");
    expect((await requestApp(app(), "/tls/ask?domain=track.example.com")).status).toBe(
      200,
    );
    expect((await requestApp(app(), "/tls/ask?domain=evil.example.com")).status).toBe(
      404,
    );
    expect((await requestApp(app(), "/tls/ask")).status).toBe(404);
  });
});
