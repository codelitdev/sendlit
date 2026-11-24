---
"sendlit": minor
"@sendlit/email-blocks": minor
---

A team's mailing address is now a structured postal address. **Breaking:** the free-text `mailingAddress` field is gone.

- `@sendlit/email-blocks/postal-address`, a React-free entry point: the `PostalAddress` type, `POSTAL_COUNTRY_CODES` (the 249 current ISO 3166-1 alpha-2 codes), `postalCountryName(code, locale?)`, `isPostalCountryCode(code)` and `formatPostalAddress(address)`, which turns an address into the footer text SendLit sends.
- `marketingPreviewContext()` takes `postalAddress` and shows it formatted as sent emails do.
- SDK: `settings.general.get()` returns `{ postalAddress, updatedAt }` and `settings.general.update()` takes `{ postalAddress }` (`null` clears it); `mailingAddress` is removed from both. Provisioning takes and returns `postalAddress` instead of `mailingAddress` in `provisionTeam`, `getTeam` and `updateTeam`. An unknown country is a 400 `postal_country_invalid`. New `PostalAddress` type.
