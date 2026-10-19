# ADR 0004: Reputation data from Postmaster Tools v2 and SNDS data links

Status: accepted
Date: 2026-10-20

## Context

Issue #76 asked for Google Postmaster Tools and Microsoft SNDS data on the
dashboard: domain and IP reputation, spam rate, authentication pass rates and
SNDS filter results. Both services changed in 2026:

- Google retired the domain and IP reputation grades. The Postmaster Tools v2
  API (`gmailpostmastertools.googleapis.com/v2`) keeps spam rate, SPF/DKIM/DMARC
  pass rates and delivery errors (`domains.domainStats:query`), and adds a
  per-domain compliance verdict (`domains.getComplianceStatus`). Listing a
  user's domains needs the broader `postmaster.domain` scope.
- SNDS moved portal on 8 June 2026. Its new REST API is undocumented and its
  OAuth tokens last eight hours with no refresh token, so a daily background
  job can't use it. Automated data access links still work but now expire
  after 30 days.

## Decision

- Google: OAuth with only `postmaster.traffic.readonly` (+ `openid email` to
  label the connection). SendLit doesn't list the user's Postmaster domains; it
  queries the From domains of the team's ESPs and reports a domain Google
  doesn't know as "not in Postmaster Tools". Metrics: `SPAM_RATE`,
  `AUTH_SUCCESS_RATE` (spf, dkim, dmarc) and `DELIVERY_ERROR_RATE`, stored as
  fractions, plus the compliance verdict. "Needs work" replaces the old
  Low/Bad reputation alert.
- SNDS: the team pastes its automated data access link. SendLit stores it
  encrypted and fetches it only from Microsoft's SNDS hosts (no SSRF through a
  pasted URL). The CSV parser accepts the documented header-less layout and
  a header row. When the link stops returning data, the connection says the
  link expired and asks for a new one.
- Refresh tokens and SNDS links are encrypted with the ESP credential key.
  A five-minute loop claims connections whose `next_sync_at` has passed (one
  process per connection) and syncs them daily; outages retry after an hour.
- Alerts (spam rate ≥0.1% warning, ≥0.3% critical; compliance needs work;
  SNDS yellow/red) show on the dashboard and email owners when they start or
  get worse, not every day.

## Consequences

- Self-hosted deployments need their own Google OAuth client
  (`GOOGLE_POSTMASTER_CLIENT_ID`/`_SECRET`); without it the Connect button is
  hidden. Hosted SendLit needs a verified OAuth consent screen for the
  Postmaster scope before public use.
- SNDS users must renew the link monthly. If Microsoft documents the REST API
  with long-lived credentials, switch to it and drop the link.
- The rate units (fractions) and SNDS column layout are taken from the API
  reference and the SNDS export format; both are covered by tests with
  recorded shapes and should be checked against a live account before launch.
