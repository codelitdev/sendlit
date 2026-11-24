---
"sendlit": minor
"@sendlit/email-blocks": minor
---

Save a team's mailing address as separate fields:

- `@sendlit/email-blocks/postal-address`, a React-free entry point: the `PostalAddress` type, `POSTAL_COUNTRY_CODES` (the 249 current ISO 3166-1 alpha-2 codes), `postalCountryName(code, locale?)`, `isPostalCountryCode(code)` and `formatPostalAddress(address)`, which turns an address into the footer text SendLit stores.
- SDK: `settings.general.get()` returns `postalAddress` alongside `mailingAddress`, and `settings.general.update()` accepts `postalAddress` (SendLit formats `mailingAddress` from it; `null` clears the address) as an alternative to free-text `mailingAddress`, which clears it. New `PostalAddress` type.
