import { describe, expect, it } from "bun:test";
import {
  formatPostalAddress,
  isPostalCountryCode,
  POSTAL_COUNTRY_CODES,
  postalCountryName,
} from ".";

describe("POSTAL_COUNTRY_CODES", () => {
  it("lists the 249 current ISO 3166-1 alpha-2 codes, once each", () => {
    expect(POSTAL_COUNTRY_CODES).toHaveLength(249);
    expect(new Set(POSTAL_COUNTRY_CODES).size).toBe(249);
    for (const code of POSTAL_COUNTRY_CODES) expect(code).toMatch(/^[A-Z]{2}$/);
  });

  it("leaves out reserved and withdrawn codes", () => {
    for (const code of [
      "AC",
      "CP",
      "DG",
      "EA",
      "EU",
      "IC",
      "TA",
      "UN",
      "XK",
      "ZZ",
      "UK",
      "AN",
      "CS",
      "YU",
    ]) {
      expect(POSTAL_COUNTRY_CODES).not.toContain(code);
    }
  });

  it("has a name for every code", () => {
    for (const code of POSTAL_COUNTRY_CODES) {
      expect(postalCountryName(code)).not.toBe(code);
    }
  });
});

describe("isPostalCountryCode", () => {
  it("accepts current uppercase codes only", () => {
    expect(isPostalCountryCode("GB")).toBe(true);
    expect(isPostalCountryCode("US")).toBe(true);
    expect(isPostalCountryCode("gb")).toBe(false);
    expect(isPostalCountryCode("UK")).toBe(false);
    expect(isPostalCountryCode("XK")).toBe(false);
    expect(isPostalCountryCode("")).toBe(false);
  });
});

describe("postalCountryName", () => {
  it("names the country in English by default and in other locales", () => {
    expect(postalCountryName("GB")).toBe("United Kingdom");
    expect(postalCountryName("DE")).toBe("Germany");
    expect(postalCountryName("DE", "de")).toBe("Deutschland");
  });

  it("falls back to the code", () => {
    expect(postalCountryName("AA")).toBe("AA");
    expect(postalCountryName("not a code")).toBe("not a code");
    expect(postalCountryName("GB", "not a locale!")).toBe("GB");
  });
});

describe("formatPostalAddress", () => {
  it("puts the street, the locality and the country on their own lines", () => {
    expect(
      formatPostalAddress({
        line1: "18 Harbour Lane",
        city: "Bristol",
        postalCode: "BS1 4RN",
        country: "GB",
      }),
    ).toBe("18 Harbour Lane\nBristol, BS1 4RN\nUnited Kingdom");
  });

  it("includes every part when given", () => {
    expect(
      formatPostalAddress({
        line1: "1 Main St",
        line2: "Suite 200",
        city: "Springfield",
        region: "IL",
        postalCode: "62701",
        country: "US",
      }),
    ).toBe("1 Main St\nSuite 200\nSpringfield, IL, 62701\nUnited States");
  });

  it("skips empty and blank parts and trims the rest", () => {
    expect(
      formatPostalAddress({
        line1: "  5 Rue Exemple ",
        line2: "   ",
        city: "",
        region: undefined,
        postalCode: " 75001 ",
        country: "FR",
      }),
    ).toBe("5 Rue Exemple\n75001\nFrance");
    expect(formatPostalAddress({ line1: "PO Box 1", country: "SG" })).toBe(
      "PO Box 1\nSingapore",
    );
  });
});
