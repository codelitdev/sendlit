# ADR 0005: SendLit is a marketing platform on top of the customer's ESP

Status: accepted
Date: 2026-10-21

## Context

SendLit doesn't deliver email itself. Each team connects its own sending
provider (SES, Postmark, Mailgun, SendGrid and so on) and SendLit sends
through it. The earlier guidance said to push back on "features meant for
ESPs", and that was too vague: providers like SendGrid Marketing Campaigns,
Resend Broadcasts and Postmark broadcast streams also offer contacts,
broadcasts and analytics. Read broadly, the rule would block the features
customers pay for.

"ESP" covers two kinds of product:

- Sending infrastructure (SES, Postmark, Mailgun, the SendGrid API, Resend):
  they accept a message and deliver it.
- Marketing platforms (Mailchimp, Klaviyo, Brevo, ActiveCampaign): they own
  the audience, the composer, segmentation, automations and reporting, and
  bundle the sending into the price.

SendLit competes with the second kind. It doesn't sell sending on top of the
first. Its advantages over them are lower cost at scale (provider pricing
instead of per-contact pricing), owning the sending reputation and avoiding
lock-in, team-scoped multi-tenancy, API, MCP and embeddable-editor access, and
self-hosting.

## Decision

- Out of scope (sending infrastructure): running MTAs, managing IP pools or
  dedicated IPs, SMTP relay for third parties, and handling bounces or
  feedback loops at the network level. Bounces, complaints and delivery
  events are read from the provider.
- In scope, even when an ESP also offers it: contacts, segmentation,
  templates, broadcasts, sequences, forms, tracking, analytics, suppression,
  and deliverability guidance such as warm-up and reputation monitoring.
  Overlapping with an ESP's feature set is not a reason to decline work.
- Stay provider-neutral. A feature that works only with some providers must
  be gated by the provider capabilities in
  `apps/api/src/settings/esp/provider-capabilities.ts`, and SendLit must keep
  working for providers that don't support it.

## Consequences

- Deliverability problems that need control over the sending infrastructure
  (IP allocation, MTA tuning) get advice and links to the provider, not
  features.
- Provider-neutrality is how SendLit stays different from sending providers
  that add marketing tools. Single-provider shortcuts weaken it and need a
  capability check.
- Reviewers and agents can point to this ADR when deciding whether a feature
  request belongs to SendLit or to the customer's provider.
