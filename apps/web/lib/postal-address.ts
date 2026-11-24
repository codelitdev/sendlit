import type { PostalAddress } from "@sendlit/api-contract";
import {
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

export function postalAddressToForm(address: PostalAddress | null): PostalAddressForm {
  return { ...EMPTY_POSTAL_ADDRESS_FORM, ...address };
}

export function isPostalAddressFormEmpty(form: PostalAddressForm): boolean {
  return Object.values(form).every((value) => !value.trim());
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
