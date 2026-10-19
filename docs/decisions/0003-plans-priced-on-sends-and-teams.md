# ADR 0003: Price hosted plans on sends and teams, not contacts

Status: accepted
Date: 2026-10-19

## Context

The hosted plans capped subscribed contacts (Free 1,000, Pro 10,000) and had
no send cap on Pro and Business (fair use only). That contradicts the pitch
SendLit leads with, "pay for the emails you send, not a growing list", and
put Pro next to per-subscriber tools such as Loops, Kit and beehiiv. Issue #60
proposed a new ladder; #66 tracks shipping it. People switching from beehiiv
(#79) need to be able to buy what is advertised.

## Decision

- Plans: Free, Starter, Pro, Business (Enterprise by arrangement). Starter is
  a new paid plan id across the billing config, catalog (`starter_month`,
  `starter_year`, `BILLING_STARTER_*`, `<PROVIDER>_STARTER_*_PRODUCT_ID`), API
  contract, MCP and dashboard. The list of paid plans lives once, in
  `@sendlit/api-contract` (`paidPlans`).
- Limits (`apps/api/src/billing/policies.ts`), all org-wide per month:

  |                    | Free  | Starter | Pro     | Business |
  | ------------------ | ----- | ------- | ------- | -------- |
  | Emails a month     | 3,000 | 25,000  | 125,000 | 600,000  |
  | Teams              | 1     | 1       | 3       | 15       |
  | Contacts           | unlimited | unlimited | unlimited | unlimited |
  | SendLit footer     | on    | on      | off     | off      |
  | Shared mailbox     | no    | no      | yes     | yes      |
  | Provisioning, org API keys | no | no | no | yes |

- Send caps are hard caps. Going over asks the customer to upgrade
  (`plan_limit_reached` names the next plan up). Overage blocks and extra
  teams (#60's $10 per 50k, $5 or $3 per team) are not built yet; they would
  need a send-limit override and provider add-on products.
- `fairUse` now means "cloud safeguards apply" (the new-account marketing
  ramp and automatic bounce/complaint reputation controls) and is on for
  every cloud plan, Free and Starter included; it no longer stands in for a
  missing send cap. Contact-limit enforcement and `contacts_limit_override`
  stay so an operator can still cap contacts for one organization and the
  schema stays compatible with the previous release.
- Organizations already on Pro or Business with more teams than the new
  limits keep them: migration `0016_grandfather_team_limits` sets
  `teams_limit_override` to their current team count. Existing Pro
  customers move to the new Pro (#60 decision 4).
- Prices are not in code. They come from the deployment's billing catalog
  (Dodo products), and the public catalog now also returns each paid plan's
  limits so the dashboard never hard-codes them.

The open choices in #60 were taken as recommended there: Pro at 125,000
emails (the $29 option), Business with 15 teams (the $99 option), and a fixed
footer on Starter. Changing any of them is a change to `planPolicies` and the
pricing page.

## Consequences

- Dodo needs monthly and yearly products for Starter before checkout works
  in cloud; the catalog refuses to activate without all six offers.
- Pro and Business organizations that sent more than 125,000 / 600,000 emails
  a month will be refused past those numbers.
- `docs/pricing-plans-and-payments-integration.md` describes the earlier
  ladder; this ADR supersedes its plan table.
