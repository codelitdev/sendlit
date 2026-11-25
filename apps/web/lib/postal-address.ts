import type { PostalAddress } from "@sendlit/api-contract";
import {
  isPostalCountryCode,
  POSTAL_COUNTRY_CODES,
  postalCountryName,
} from "@sendlit/email-blocks/postal-address";

/** The mailing address form's fields, all strings so inputs stay controlled. */
export type PostalAddressForm = {
  line1: string;
  line2: string;
  city: string;
  region: string;
  postalCode: string;
  country: string;
};

export const EMPTY_POSTAL_ADDRESS_FORM: PostalAddressForm = {
  line1: "",
  line2: "",
  city: "",
  region: "",
  postalCode: "",
  country: "",
};

/** The country of a locale such as `en-GB` (or the browser's), when it is
 * one SendLit accepts; `""` otherwise. */
export function defaultPostalCountry(
  locale = typeof navigator === "undefined" ? undefined : navigator.language,
): string {
  if (!locale) return "";
  try {
    const region = new Intl.Locale(locale).maximize().region ?? "";
    return isPostalCountryCode(region) ? region : "";
  } catch {
    return "";
  }
}

/** The form for a saved address, or an empty one with the browser's
 * country preselected. */
export function postalAddressToForm(address: PostalAddress | null): PostalAddressForm {
  return address
    ? { ...EMPTY_POSTAL_ADDRESS_FORM, ...address }
    : { ...EMPTY_POSTAL_ADDRESS_FORM, country: defaultPostalCountry() };
}

/** Whether no address field is filled in (a preselected country alone
 * doesn't count). */
export function isPostalAddressFormEmpty(form: PostalAddressForm): boolean {
  return [form.line1, form.line2, form.city, form.region, form.postalCode].every(
    (value) => !value.trim(),
  );
}

/** The address to save, or `null` when the street address or the country is
 * missing. Blank optional fields are left out. */
export function postalAddressFromForm(form: PostalAddressForm): PostalAddress | null {
  const line1 = form.line1.trim();
  if (!line1 || !form.country) return null;
  const address: PostalAddress = { line1, country: form.country };
  for (const key of ["line2", "city", "region", "postalCode"] as const) {
    const value = form[key].trim();
    if (value) address[key] = value;
  }
  return address;
}

/** Every country for the country picker, sorted by its English name. */
export function postalCountryOptions(): { code: string; name: string }[] {
  return POSTAL_COUNTRY_CODES.map((code) => ({
    code,
    name: postalCountryName(code),
  })).sort((a, b) => a.name.localeCompare(b.name));
}
