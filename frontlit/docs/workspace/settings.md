---
title: Settings
description: Configure sending identity and email service providers.
nav_order: 60
---

Settings has two team-scoped areas:

- **General** stores the team mailing address used in the managed marketing
  footer and required for broadcasts and sequences. Enter it as separate
  fields: street address, an optional second line, city, an optional state or
  region, postal code and country (preselected from your browser's language).
  SendLit formats them into the footer text.
- **ESP** configures team-owned email service providers and can make one the
  team's default.

SendLit supports custom SMTP, SendGrid, Mailgun, Postmark, Amazon SES, Resend, and other custom providers. Provider credentials are write-only: stored secrets are never returned by the API.

Use **Test connection** after adding a provider. A provider must be configured
before broadcasts or active sequences can deliver mail unless the team has an
active shared-mailbox grant from its organization. Shared mailbox setup lives
in [Organizations](/docs/workspace/organizations).
