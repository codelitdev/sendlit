# ADR 0012: The mailing address is a structured postal address only

Status: accepted
Date: 2026-11-24

## Context

The marketing footer's mailing address was one free-text `mailingAddress`
setting. Consumers such as CourseLit ask for the address as separate fields
(street, city, region, postal code, country) and had to flatten them into that
text, so they couldn't show the fields again for editing, and every surface
formatted the address its own way.

## Decision

- A team's address is `settings.postal_address` (jsonb): `line1`, optional
  `line2`, `city`, `region` and `postalCode`, and an ISO 3166-1 alpha-2
  `country`. REST, MCP, the SDK and provisioning take and return
  `postalAddress`; an unknown country is `400 postal_country_invalid`.
- The footer text (`{{ address }}`) is derived where it is used with
  `formatPostalAddress` from `@sendlit/email-blocks/postal-address`, so every
  surface formats it identically. A team "has an address" when
  `postalAddress` is set.
- `mailingAddress` and the `mailing_address` column are removed in the same
  release (migration 0034), with no transition period.

## Consequences

This deliberately breaks the rule that schema changes stay compatible with
the previous release: SendLit has no outside customers yet, so we drop the
column instead of carrying two address formats. Existing free-text addresses
are discarded; affected teams re-enter their address before their next
broadcast or sequence (sending fails with `mailing_address_required` until
they do). API clients must switch from `mailingAddress` to `postalAddress`.
