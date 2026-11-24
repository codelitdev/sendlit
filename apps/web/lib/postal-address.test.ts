import { describe, expect, it } from "bun:test";
import {
  defaultPostalCountry,
  EMPTY_POSTAL_ADDRESS_FORM,
  isPostalAddressFormEmpty,
  postalAddressFromForm,
  postalAddressToForm,
  postalCountryOptions,
} from "./postal-address";

describe("postal address form", () => {
  it("round-trips a saved address", () => {
    const address = { line1: "18 Harbour Lane", city: "Bristol", country: "GB" };
    const form = postalAddressToForm(address);
    expect(form).toEqual({ ...EMPTY_POSTAL_ADDRESS_FORM, ...address });
    expect(postalAddressFromForm(form)).toEqual(address);
  });

  it("needs a street address and a country, and drops blank fields", () => {
    expect(
      postalAddressFromForm({ ...EMPTY_POSTAL_ADDRESS_FORM, line1: "x" }),
    ).toBeNull();
    expect(
      postalAddressFromForm({ ...EMPTY_POSTAL_ADDRESS_FORM, country: "GB" }),
    ).toBeNull();
    expect(
      postalAddressFromForm({
        ...EMPTY_POSTAL_ADDRESS_FORM,
        line1: " 1 Main St ",
        line2: "  ",
        postalCode: " 62701 ",
        country: "US",
      }),
    ).toEqual({ line1: "1 Main St", postalCode: "62701", country: "US" });
  });

  it("starts an empty form in the browser's country", () => {
    expect(postalAddressToForm(null)).toEqual({
      ...EMPTY_POSTAL_ADDRESS_FORM,
      country: defaultPostalCountry(),
    });
    expect(defaultPostalCountry("en-GB")).toBe("GB");
    expect(defaultPostalCountry("de")).toBe("DE");
    expect(defaultPostalCountry("en-001")).toBe("");
    expect(defaultPostalCountry("not a locale!")).toBe("");
    expect(defaultPostalCountry("")).toBe("");
  });

  it("knows an empty form", () => {
    expect(isPostalAddressFormEmpty(EMPTY_POSTAL_ADDRESS_FORM)).toBe(true);
    expect(isPostalAddressFormEmpty({ ...EMPTY_POSTAL_ADDRESS_FORM, city: " " })).toBe(
      true,
    );
    expect(isPostalAddressFormEmpty({ ...EMPTY_POSTAL_ADDRESS_FORM, city: "x" })).toBe(
      false,
    );
  });

  it("lists every country sorted by name", () => {
    const options = postalCountryOptions();
    expect(options).toHaveLength(249);
    const names = options.map((option) => option.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
    expect(options).toContainEqual({ code: "GB", name: "United Kingdom" });
  });
});
