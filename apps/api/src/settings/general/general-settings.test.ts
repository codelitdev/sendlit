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
const { seedTeamAndContact, TEST_POSTAL_ADDRESS, truncateAll } = await import(
  "../../test/db"
);
type TestDb = import("../../test/db").TestDb;
const { requestApp } = await import("../../test/http");
const { assertMailingAddressConfigured, mailingAddressText, normalizePostalAddress } =
  await import("./queries");
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

describe("postal address helpers", () => {
  it("trims fields and drops blank optional ones", () => {
    expect(
      normalizePostalAddress({
        ...bristol,
        line1: " 18 Harbour Lane ",
        line2: " ",
        region: "",
      }),
    ).toEqual(bristol);
  });

  it("rejects countries that aren't current ISO codes", () => {
    expect(() => normalizePostalAddress({ ...bristol, country: "UK" })).toThrow(
      "postal_country_invalid",
    );
  });

  it("formats the footer text, or null without an address", () => {
    expect(mailingAddressText(bristol)).toBe(
      "18 Harbour Lane\nBristol, BS1 4RN\nUnited Kingdom",
    );
    expect(mailingAddressText(null)).toBeNull();
  });
});

describe("general settings routes", () => {
  it("returns the seeded address", async () => {
    const response = await requestApp(app(), "/settings/general");
    expect(response.status).toBe(200);
    expect(response.json()).toMatchObject({ postalAddress: TEST_POSTAL_ADDRESS });
    expect(response.json()).not.toHaveProperty("mailingAddress");
  });

  it("stores a postal address", async () => {
    const response = await put({ postalAddress: { ...bristol, line2: "" } });
    expect(response.status).toBe(200);
    expect(response.json()).toMatchObject({ postalAddress: bristol });
    expect((await requestApp(app(), "/settings/general")).json()).toMatchObject({
      postalAddress: bristol,
    });
  });

  it("keeps the address when an update leaves it out", async () => {
    await put({ postalAddress: bristol });
    expect((await put({})).json()).toMatchObject({ postalAddress: bristol });
  });

  it("clears the address with null", async () => {
    await put({ postalAddress: bristol });
    expect((await put({ postalAddress: null })).json()).toMatchObject({
      postalAddress: null,
    });
    await expect(assertMailingAddressConfigured(requestContext.teamId)).rejects.toThrow(
      "mailing_address_required",
    );
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
      postalAddress: TEST_POSTAL_ADDRESS,
    });
  });
});
