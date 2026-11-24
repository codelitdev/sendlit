import { beforeEach, describe, expect, it, mock } from "bun:test";
import express from "express";

const requestContext = { teamId: "" };

mock.module("../../db/client", async () => {
  const { makeTestDb } = await import("../../test/db");
  return { db: await makeTestDb() };
});
mock.module("../../auth/middleware", () => ({
  requireAuth: (req: any, _res: any, next: () => void) => {
    req.authKind = "session";
    next();
  },
}));
mock.module("../../auth/require-team", () => ({
  requireTeam: (req: any, _res: any, next: () => void) => {
    req.teamId = requestContext.teamId;
    next();
  },
}));

const { db } = await import("../../db/client");
const { seedTeamAndContact, truncateAll } = await import("../../test/db");
type TestDb = import("../../test/db").TestDb;
const { requestApp } = await import("../../test/http");
const { resolveAddressUpdate } = await import("./queries");
const { default: generalRoutes } = await import("./routes");

const tdb = db as unknown as TestDb;

function app() {
  const instance = express();
  instance.use(express.json());
  instance.use(generalRoutes);
  return instance;
}

const put = (body: unknown) =>
  requestApp(app(), "/settings/general", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

const bristol = {
  line1: "18 Harbour Lane",
  city: "Bristol",
  postalCode: "BS1 4RN",
  country: "GB",
};

beforeEach(async () => {
  await truncateAll(tdb);
  const { team } = await seedTeamAndContact(tdb);
  requestContext.teamId = team.id;
});

describe("resolveAddressUpdate", () => {
  it("leaves the address alone when neither form is sent", () => {
    expect(resolveAddressUpdate({})).toBeUndefined();
  });

  it("formats a postal address and drops its blank fields", () => {
    expect(
      resolveAddressUpdate({
        postalAddress: {
          ...bristol,
          line1: " 18 Harbour Lane ",
          line2: " ",
          region: "",
        },
      }),
    ).toEqual({
      mailingAddress: "18 Harbour Lane\nBristol, BS1 4RN\nUnited Kingdom",
      postalAddress: bristol,
    });
  });

  it("rejects both forms at once and unknown countries", () => {
    expect(() =>
      resolveAddressUpdate({ mailingAddress: "x", postalAddress: bristol }),
    ).toThrow("postal_address_conflict");
    expect(() =>
      resolveAddressUpdate({ postalAddress: { ...bristol, country: "UK" } }),
    ).toThrow("postal_country_invalid");
  });
});

describe("general settings routes", () => {
  it("returns a free-text address without parts", async () => {
    const response = await requestApp(app(), "/settings/general");
    expect(response.status).toBe(200);
    expect(response.json()).toMatchObject({
      mailingAddress: "1 Test St, Testville",
      postalAddress: null,
    });
  });

  it("stores a postal address and its formatted text", async () => {
    const response = await put({ postalAddress: bristol });
    expect(response.status).toBe(200);
    expect(response.json()).toMatchObject({
      mailingAddress: "18 Harbour Lane\nBristol, BS1 4RN\nUnited Kingdom",
      postalAddress: bristol,
    });

    const read = await requestApp(app(), "/settings/general");
    expect(read.json()).toMatchObject({
      mailingAddress: "18 Harbour Lane\nBristol, BS1 4RN\nUnited Kingdom",
      postalAddress: bristol,
    });
  });

  it("keeps the address when an update leaves it out", async () => {
    await put({ postalAddress: bristol });
    const response = await put({});
    expect(response.json()).toMatchObject({ postalAddress: bristol });
  });

  it("clears the parts when free text replaces them", async () => {
    await put({ postalAddress: bristol });
    const response = await put({ mailingAddress: "PO Box 7, Bristol" });
    expect(response.status).toBe(200);
    expect(response.json()).toMatchObject({
      mailingAddress: "PO Box 7, Bristol",
      postalAddress: null,
    });
  });

  it("clears both with postalAddress: null or an empty mailingAddress", async () => {
    await put({ postalAddress: bristol });
    expect((await put({ postalAddress: null })).json()).toMatchObject({
      mailingAddress: null,
      postalAddress: null,
    });

    await put({ postalAddress: bristol });
    expect((await put({ mailingAddress: "" })).json()).toMatchObject({
      mailingAddress: null,
      postalAddress: null,
    });
  });

  it("rejects both forms in one update", async () => {
    await put({ postalAddress: bristol });
    const response = await put({ mailingAddress: "1 Main St", postalAddress: bristol });
    expect(response.status).toBe(400);
    expect((await requestApp(app(), "/settings/general")).json()).toMatchObject({
      postalAddress: bristol,
    });
  });

  it("rejects unknown countries and malformed addresses", async () => {
    const unknown = await put({ postalAddress: { ...bristol, country: "UK" } });
    expect(unknown.status).toBe(400);
    expect(unknown.json()).toEqual({ error: "postal_country_invalid" });

    for (const postalAddress of [
      { ...bristol, country: "gb" },
      { ...bristol, line1: "  " },
      { ...bristol, postalCode: "x".repeat(21) },
      { city: "Bristol", country: "GB" },
    ]) {
      expect((await put({ postalAddress })).status).toBe(400);
    }
    expect((await requestApp(app(), "/settings/general")).json()).toMatchObject({
      mailingAddress: "1 Test St, Testville",
      postalAddress: null,
    });
  });
});
