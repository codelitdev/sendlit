/** Stable error code shared by REST, MCP, and delivery workers. */
export const MAILING_ADDRESS_REQUIRED = "mailing_address_required";
/** Both `mailingAddress` and `postalAddress` were sent in one update. */
export const POSTAL_ADDRESS_CONFLICT = "postal_address_conflict";
/** A `postalAddress.country` that isn't a current ISO 3166-1 alpha-2 code. */
export const POSTAL_COUNTRY_INVALID = "postal_country_invalid";
