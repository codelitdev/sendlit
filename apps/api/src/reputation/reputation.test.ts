import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";
import express from "express";

mock.module("../db/client", async () => {
  const { makeTestDb } = await import("../test/db");
  return { db: await makeTestDb() };
});
const notifyOrganizationOwners = mock(async (..._args: unknown[]) => undefined);
const realNotifications = { ...(await import("../billing/notifications")) };
mock.module("../billing/notifications", () => ({
  ...realNotifications,
  notifyOrganizationOwners,
}));

const { eq } = await import("drizzle-orm");
const { db } = await import("../db/client");
const { reputationConnections } = await import("../db/schema");
const { seedTeamAndContact, truncateAll } = await import("../test/db");
const { requestApp } = await import("../test/http");
const { parseSndsData, validateSndsUrl, SndsLinkError } = await import("./snds");
const { getReputation, saveConnection, alertsFor } = await import("./queries");
const { syncConnection, syncDueConnections } = await import("./sync");
const { startGoogleConnect } = await import("./google");
const { default: reputationRoutes } = await import("./routes");
type TestDb = import("../test/db").TestDb;

const tdb = db as unknown as TestDb;
const realFetch = globalThis.fetch;
const today = new Date();
const isoDay = (offset: number) =>
  new Date(today.getTime() - offset * 86_400_000).toISOString().slice(0, 10);
const gDate = (iso: string) => {
  const [year, month, day] = iso.split("-").map(Number);
  return { year, month, day };
};

/** A stand-in for Google's token and Postmaster endpoints, and SNDS. */
let google: {
  tokenError?: string;
  spamRate: number;
  unknownDomains: string[];
  compliance: Record<string, unknown>;
};
let sndsBody: string;
let sndsStatus: number;

function fakeFetch(input: string | URL | Request, init?: RequestInit) {
  const url = new URL(
    typeof input === "string" ? input : input instanceof URL ? input : input.url,
  );
  const json = (body: unknown, status = 200) =>
    Promise.resolve(new Response(JSON.stringify(body), { status }));
  if (url.host === "oauth.test") {
    const params = new URLSearchParams(String(init?.body));
    if (google.tokenError) return json({ error: google.tokenError }, 400);
    if (params.get("grant_type") === "authorization_code") {
      const idToken = `x.${Buffer.from(JSON.stringify({ email: "owner@gmail.com" })).toString("base64url")}.y`;
      return json({ access_token: "at", refresh_token: "rt-1", id_token: idToken });
    }
    return json({ access_token: "at" });
  }
  if (url.host === "postmaster.test") {
    const domain = decodeURIComponent(url.pathname.split("/")[3]);
    if (google.unknownDomains.includes(domain)) return json({ error: {} }, 404);
    if (url.pathname.endsWith("/complianceStatus")) {
      return json({ complianceData: google.compliance });
    }
    const metrics = (
      JSON.parse(String(init?.body)).metricDefinitions as { name: string }[]
    ).map((m) => m.name);
    const values: Record<string, number> = {
      spamRate: google.spamRate,
      spfRate: 1,
      dkimRate: 0.99,
      dmarcRate: 0.98,
      deliveryErrorRate: 0.01,
    };
    return json({
      domainStats: [1, 2].flatMap((offset) =>
        metrics.map((metric) => ({
          metric,
          date: gDate(isoDay(offset)),
          value: { doubleValue: offset === 1 ? values[metric] : 0 },
        })),
      ),
    });
  }
  if (url.host === "snds.test") {
    return Promise.resolve(new Response(sndsBody, { status: sndsStatus }));
  }
  return realFetch(input as any, init);
}

beforeEach(async () => {
  await truncateAll(tdb);
  notifyOrganizationOwners.mockClear();
  process.env.GOOGLE_POSTMASTER_CLIENT_ID = "client";
  process.env.GOOGLE_POSTMASTER_CLIENT_SECRET = "secret";
  process.env.GOOGLE_OAUTH_TOKEN_URL = "https://oauth.test/token";
  process.env.GOOGLE_OAUTH_AUTHORIZE_URL = "https://oauth.test/auth";
  process.env.GOOGLE_POSTMASTER_API_URL = "https://postmaster.test";
  process.env.SNDS_ALLOWED_HOSTS = "snds.test";
  google = { spamRate: 0.0005, unknownDomains: [], compliance: {} };
  const [m, d, y] = [
    today.getUTCMonth() + 1,
    today.getUTCDate() - 0,
    today.getUTCFullYear(),
  ];
  sndsBody = `192.0.2.10,${m}/${d}/${y} 12:00 AM,${m}/${d}/${y} 11:59 PM,120,118,118,RED,0.4%,,,3,mail.example.com,a@example.com,\n192.0.2.11,${m}/${d}/${y} 12:00 AM,${m}/${d}/${y} 11:59 PM,50,50,50,GREEN,< 0.1%,,,0,mail.example.com,a@example.com,\n`;
  sndsStatus = 200;
  globalThis.fetch = fakeFetch as typeof fetch;
});

afterAll(() => {
  globalThis.fetch = realFetch;
});

describe("SNDS data", () => {
  it("parses SNDS's header-less export and a header row", () => {
    const data = parseSndsData(sndsBody);
    const day = Object.keys(data["192.0.2.10"])[0];
    expect(data["192.0.2.10"][day]).toEqual({
      filterResult: "red",
      complaintRate: 0.004,
      complaintRateText: "0.4%",
      trapHits: 3,
      recipients: 118,
    });
    expect(data["192.0.2.11"][day]).toMatchObject({
      filterResult: "green",
      complaintRate: null,
    });

    const withHeader = parseSndsData(
      "IP Address,Activity start,Activity end,Message recipients,Filter result,Complaint rate,Trap hits\n192.0.2.12,2026-10-18,2026-10-18,10,YELLOW,0.2%,1\n",
    );
    expect(withHeader["192.0.2.12"]["2026-10-18"]).toMatchObject({
      filterResult: "yellow",
      recipients: 10,
      trapHits: 1,
    });
    expect(() => parseSndsData("<!DOCTYPE html><html>Sign in</html>")).toThrow(
      SndsLinkError,
    );
  });

  it("only fetches links on Microsoft's SNDS hosts", () => {
    process.env.SNDS_ALLOWED_HOSTS = "";
    expect(
      validateSndsUrl(
        "https://substrate.office.com/ip-domain-management-snds/SNDS/data.aspx?key=k",
      ),
    ).toContain("key=k");
    for (const bad of [
      "http://substrate.office.com/x",
      "https://evil.example.com/data.aspx",
      "https://user:pw@substrate.office.com/x",
      "http://169.254.169.254/latest",
      "not a url",
    ]) {
      expect(() => validateSndsUrl(bad)).toThrow(SndsLinkError);
    }
  });
});

describe("reputation sync", () => {
  it("syncs Google stats per sending domain and flags domains not in Postmaster Tools", async () => {
    const { team } = await seedTeamAndContact(tdb);
    await tdb.insert((await import("../db/schema")).espConfigs).values({
      ownerScope: "team",
      teamId: team.id,
      name: "Second",
      host: "smtp.example.com",
      fromEmail: "news@unverified.example",
    });
    google.unknownDomains = ["unverified.example"];
    google.compliance = {
      rowData: [{ requirement: "SPF", status: { status: "COMPLIANT" } }],
      deliverabilityStatusVerdict: { state: { status: "COMPLIANT" } },
    };
    const connection = await saveConnection(
      team.id,
      "google_postmaster",
      "rt",
      "o@gmail.com",
    );
    await syncConnection(connection);

    const reputation = await getReputation(team.id);
    expect(reputation.google.connection).toMatchObject({
      status: "active",
      accountLabel: "o@gmail.com",
    });
    const verified = reputation.google.domains.find((d) => d.domain === "example.com")!;
    expect(verified.status).toBe("ok");
    expect(verified.compliance).toEqual({ status: "compliant", needsWork: [] });
    expect(verified.days.at(-1)).toEqual({
      day: isoDay(1),
      spamRate: 0.0005,
      spfRate: 1,
      dkimRate: 0.99,
      dmarcRate: 0.98,
      deliveryErrorRate: 0.01,
    });
    expect(
      reputation.google.domains.find((d) => d.domain === "unverified.example"),
    ).toMatchObject({
      status: "not_in_postmaster",
      days: [],
    });
    expect(reputation.alerts).toEqual([]);
    expect(notifyOrganizationOwners).not.toHaveBeenCalled();
  });

  it("emails owners once per new or worse alert", async () => {
    const { team } = await seedTeamAndContact(tdb);
    const connection = await saveConnection(team.id, "google_postmaster", "rt", null);
    google.spamRate = 0.0015;
    await syncConnection(connection);
    expect(notifyOrganizationOwners).toHaveBeenCalledTimes(1);
    expect(String(notifyOrganizationOwners.mock.calls[0][2])).toContain("0.15%");

    // Same level again: no new email.
    const [same] = await tdb.select().from(reputationConnections);
    await syncConnection(same);
    expect(notifyOrganizationOwners).toHaveBeenCalledTimes(1);

    // Worse: above Google's 0.3% limit, with a compliance problem.
    google.spamRate = 0.004;
    google.compliance = {
      rowData: [
        { requirement: "USER_REPORTED_SPAM_RATE", status: { status: "NEEDS_WORK" } },
      ],
    };
    const [again] = await tdb.select().from(reputationConnections);
    await syncConnection(again);
    expect(notifyOrganizationOwners).toHaveBeenCalledTimes(2);
    expect(String(notifyOrganizationOwners.mock.calls[1][1])).toContain(
      "Action needed",
    );
    const { alerts } = await getReputation(team.id);
    expect(alerts.map((a) => [a.signal, a.level])).toEqual([
      ["spam_rate", "critical"],
      ["compliance", "warning"],
    ]);
  });

  it("asks to reconnect when Google access was revoked, and keeps the history", async () => {
    const { team } = await seedTeamAndContact(tdb);
    const connection = await saveConnection(team.id, "google_postmaster", "rt", null);
    await syncConnection(connection);
    google.tokenError = "invalid_grant";
    const [row] = await tdb.select().from(reputationConnections);
    await syncConnection(row);
    const reputation = await getReputation(team.id);
    expect(reputation.google.connection).toMatchObject({ status: "error" });
    expect(reputation.google.connection?.lastError).toContain(
      "Connect Postmaster Tools again",
    );
    expect(reputation.google.domains[0].days.length).toBeGreaterThan(0);
  });

  it("syncs SNDS, alerts on red IPs and reports expired links", async () => {
    const { team } = await seedTeamAndContact(tdb);
    const connection = await saveConnection(
      team.id,
      "microsoft_snds",
      "https://snds.test/data",
      null,
    );
    await syncConnection(connection);
    const reputation = await getReputation(team.id);
    expect(reputation.snds.ips.map((ip) => ip.ip)).toEqual([
      "192.0.2.10",
      "192.0.2.11",
    ]);
    expect(reputation.alerts).toEqual([
      expect.objectContaining({
        subject: "192.0.2.10",
        signal: "snds_filter",
        level: "critical",
      }),
    ]);
    expect(notifyOrganizationOwners).toHaveBeenCalledTimes(1);

    sndsBody = "<html>expired</html>";
    const [row] = await tdb.select().from(reputationConnections);
    await syncConnection(row);
    const after = await getReputation(team.id);
    expect(after.snds.connection?.lastError).toContain("SNDS links last 30 days");
  });

  it("the daily job claims each due connection once", async () => {
    const { team } = await seedTeamAndContact(tdb);
    await saveConnection(team.id, "microsoft_snds", "https://snds.test/data", null);
    const [first, second] = await Promise.all([
      syncDueConnections(),
      syncDueConnections(),
    ]);
    expect(first + second).toBe(1);
    const [row] = await tdb.select().from(reputationConnections);
    expect(row.nextSyncAt.getTime()).toBeGreaterThan(Date.now() + 23 * 3_600_000);
    expect(await syncDueConnections()).toBe(0);
  });

  it("warns at 0.1% and is critical at 0.3% spam", () => {
    const domain = (spamRate: number) => [
      {
        domain: "example.com",
        status: "ok" as const,
        compliance: null,
        days: [
          {
            day: "2026-10-18",
            spamRate,
            spfRate: null,
            dkimRate: null,
            dmarcRate: null,
            deliveryErrorRate: null,
          },
        ],
      },
    ];
    expect(alertsFor(domain(0.0009), [])).toEqual([]);
    expect(alertsFor(domain(0.001), [])[0].level).toBe("warning");
    expect(alertsFor(domain(0.003), [])[0].level).toBe("critical");
  });
});

describe("Google connect flow", () => {
  function app() {
    const instance = express();
    instance.use(reputationRoutes);
    return instance;
  }

  it("stores the refresh token for the team in the signed state", async () => {
    const { team, account } = await seedTeamAndContact(tdb);
    const authorizationUrl = startGoogleConnect(team.id, account.id)!;
    const params = new URL(authorizationUrl).searchParams;
    expect(params.get("scope")).toContain("postmaster.traffic.readonly");
    expect(params.get("access_type")).toBe("offline");

    const response = await requestApp(
      app(),
      `/integrations/google-postmaster/callback?code=c&state=${params.get("state")}`,
    );
    expect(response.status).toBe(303);
    expect(String(response.headers.location)).toEndWith(
      "/?reputation=google_connected",
    );
    const [row] = await tdb
      .select()
      .from(reputationConnections)
      .where(eq(reputationConnections.teamId, team.id));
    expect(row).toMatchObject({
      provider: "google_postmaster",
      accountLabel: "owner@gmail.com",
    });
    expect(row.encryptedSecret).not.toContain("rt-1");
  });

  it("rejects forged or missing state", async () => {
    const response = await requestApp(
      app(),
      "/integrations/google-postmaster/callback?code=c&state=forged",
    );
    expect(String(response.headers.location)).toEndWith("/?reputation=google_failed");
    expect(await tdb.select().from(reputationConnections)).toEqual([]);
  });
});
