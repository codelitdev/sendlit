/**
 * Structured postal addresses for the managed email footer (CAN-SPAM/GDPR).
 *
 * React-free on purpose: the API, the SDK's consumers and any dashboard can
 * import it to validate an address and turn it into the footer text, so
 * every surface formats an address identically.
 */

/** A team's physical postal address, as separate fields. */
export type PostalAddress = {
  /** Street address. */
  line1: string;
  /** Apartment, suite, building and so on. */
  line2?: string;
  city?: string;
  /** State, province or region. */
  region?: string;
  postalCode?: string;
  /** ISO 3166-1 alpha-2 code, uppercase (`GB`, `US`). */
  country: string;
};

/** Every currently assigned ISO 3166-1 alpha-2 country code (249). Reserved
 * and withdrawn codes (`UK`, `EU`, `XK`, `AN`, ...) are not included. */
export const POSTAL_COUNTRY_CODES: readonly string[] = Object.freeze([
  ..."AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ".split(" "),
  ..."BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ".split(" "),
  ..."CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ".split(" "),
  ..."DE DJ DK DM DO DZ".split(" "),
  ..."EC EE EG EH ER ES ET".split(" "),
  ..."FI FJ FK FM FO FR".split(" "),
  ..."GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY".split(" "),
  ..."HK HM HN HR HT HU".split(" "),
  ..."ID IE IL IM IN IO IQ IR IS IT".split(" "),
  ..."JE JM JO JP".split(" "),
  ..."KE KG KH KI KM KN KP KR KW KY KZ".split(" "),
  ..."LA LB LC LI LK LR LS LT LU LV LY".split(" "),
  ..."MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ".split(" "),
  ..."NA NC NE NF NG NI NL NO NP NR NU NZ".split(" "),
  "OM",
  ..."PA PE PF PG PH PK PL PM PN PR PS PT PW PY".split(" "),
  "QA",
  ..."RE RO RS RU RW".split(" "),
  ..."SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ".split(" "),
  ..."TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ".split(" "),
  ..."UA UG UM US UY UZ".split(" "),
  ..."VA VC VE VG VI VN VU".split(" "),
  ..."WF WS".split(" "),
  ..."YE YT".split(" "),
  ..."ZA ZM ZW".split(" "),
]);

const countryCodes = new Set(POSTAL_COUNTRY_CODES);

/** Whether `code` is a current ISO 3166-1 alpha-2 code (uppercase only). */
export function isPostalCountryCode(code: string): boolean {
  return countryCodes.has(code);
}

const displayNames = new Map<string, Intl.DisplayNames | null>();

function regionNames(locale: string): Intl.DisplayNames | null {
  if (!displayNames.has(locale)) {
    let names: Intl.DisplayNames | null = null;
    try {
      names = new Intl.DisplayNames([locale], { type: "region", fallback: "code" });
    } catch {
      names = null;
    }
    displayNames.set(locale, names);
  }
  return displayNames.get(locale) ?? null;
}

/** The country's name in `locale` (`GB` → "United Kingdom"), or the code
 * itself when the runtime can't name it. */
export function postalCountryName(code: string, locale = "en"): string {
  try {
    return regionNames(locale)?.of(code) || code;
  } catch {
    return code;
  }
}

/** The footer text for an address: one line each for the street lines,
 * "city, region, postal code" and the country name, skipping empty parts. */
export function formatPostalAddress(address: PostalAddress): string {
  const clean = (value?: string) => value?.trim() ?? "";
  const locality = [address.city, address.region, address.postalCode]
    .map(clean)
    .filter(Boolean)
    .join(", ");
  const country = clean(address.country);
  return [
    clean(address.line1),
    clean(address.line2),
    locality,
    country ? postalCountryName(country) : "",
  ]
    .filter(Boolean)
    .join("\n");
}
