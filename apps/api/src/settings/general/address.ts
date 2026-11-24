import type { PostalAddress } from "@sendlit/api-contract";
import {
  formatPostalAddress,
  isPostalCountryCode,
} from "@sendlit/email-blocks/postal-address";
import { POSTAL_COUNTRY_INVALID } from "./constants";

export { POSTAL_COUNTRY_INVALID } from "./constants";

/**
 * The address to store: throws `POSTAL_COUNTRY_INVALID` for a country that
 * isn't a current ISO 3166-1 alpha-2 code, trims every field and drops blank
 * optional ones.
 */
export function normalizePostalAddress(address: PostalAddress): PostalAddress {
  if (!isPostalCountryCode(address.country)) {
    throw new Error(POSTAL_COUNTRY_INVALID);
  }
  const normalized: PostalAddress = {
    line1: address.line1.trim(),
    country: address.country,
  };
  for (const key of ["line2", "city", "region", "postalCode"] as const) {
    const value = address[key]?.trim();
    if (value) normalized[key] = value;
  }
  return normalized;
}

/** The footer text for a team's address (`{{ address }}`), or `null` when
 * the team has none. */
export function mailingAddressText(
  postalAddress: PostalAddress | null | undefined,
): string | null {
  return postalAddress ? formatPostalAddress(postalAddress) || null : null;
}
