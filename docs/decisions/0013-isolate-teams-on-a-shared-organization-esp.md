# ADR 0013: Isolate teams on a shared organization ESP

Status: accepted
Date: 2026-11-25

## Context

An organization can grant its own ESP (a shared mailbox) to many teams. The
provisioning API makes this the default for platforms that create one team per
customer, such as one team per school on a course platform. Issue #220.

Bounces, complaints, suppressions, quotas and the fair-use reputation controls
are already per team. Two things are still shared by every team on the ESP:

1. **Mailbox-provider reputation.** Gmail and Microsoft score mail mostly by
   its DKIM signing domain. Every team sends from the ESP's one From address,
   so they share one reputation.
2. **ESP account standing.** ESPs enforce bounce and complaint limits on the
   whole account. Amazon SES reviews an account at about 5% bounces or 0.1%
   complaints and can pause it. One team's bad list can stop every team.

Per-team checks don't cover the second risk. They look at one team at a time,
only judge rates after 500 accepted sends a week, and only run in SendLit
Cloud. Ten small teams, each under every per-team line, can still put the
shared account over the ESP's limit.

## Decision

Isolation on a shared ESP comes in three tiers:

| Tier | Identity | What is isolated | Setup for a team |
| --- | --- | --- | --- |
| Shared ESP, shared domain (default) | Shared | Nothing beyond the guard below | None |
| Shared ESP, team's own domain | Per team | Mailbox-provider reputation | DNS records |
| Team's own ESP | Per team | Everything, including ESP account standing | An ESP account |

SendLit stays a marketing platform on the customer's ESP
([ADR 0005](0005-marketing-platform-not-esp.md)): no IP pools or dedicated IPs.

### 1. Shared-ESP guard (built)

- A rolling 7-day bounce and complaint count for each organization ESP and
  each team on it, read from the deduplicated outbound ledger.
- Thresholds sit below what ESPs enforce: warn at 2% bounces or 0.05%
  complaints, act at 4% or 0.08%. They are deployment configuration
  (`SHARED_ESP_*`).
- A team is judged on its own rates once it has 5 bounces or 2 complaints,
  however few emails it sent. There is no 500-send floor, and transactional
  sends count.
- The guard pauses **marketing for the teams causing the problem**, worst
  first. Clean teams never pause to improve the ratio, because their sends
  dilute it. Marketing pauses on the whole ESP only when the teams left are
  still over the pause rates, which means the problem is broad.
- A pause blocks broadcasts and sequences through that ESP only. The team's
  own ESPs and all transactional mail keep sending; team reputation controls
  still govern transactional mail.
- A pause holds for at least 72 hours and lifts after 3 clean daily checks.
  The 7-day window already makes a paused team wait for its bad sends to age
  out, so the fair-use controls' 7 clean days would double the wait.
- Organization owners get an email on every change, and each change is
  written to the organization audit log. Operators can inspect and release
  pauses with `billing shared-esp-status` and `billing shared-esp-release`.
  For 7 days after a release, the guard counts only sends made after it, so
  the bounces the operator reviewed can't pause it again but a new bad list
  still does.
- The guard is on by default in SendLit Cloud. Self-hosted operators turn it
  on with `SHARED_ESP_GUARD=on`.

### 2. A team's own domain on the shared ESP (planned)

- A provisioned team can send from its own verified domain or subdomain. The
  shared ESP signs its mail with DKIM for that domain.
- SendLit registers the domain with the ESP through the provider's domain
  API, using a management credential stored separately from the SMTP one.
  Amazon SES comes first.
- A team uses its own From address only while its domain passes DKIM and
  DMARC. If the domain later fails, the team gets a grace period, then its
  marketing pauses. **It never silently falls back to the shared domain**: a
  failing team is exactly the one that shouldn't land on everyone's
  reputation.
- Organization policy `requireTeamSendingDomain` (`off`, `marketing` or
  `all`) defaults to `off`, with an optional cap on how much a team can send
  through the shared domain.

## Consequences

- One team's bad list now costs that team its marketing sends through the
  shared ESP, usually for 10 days or more. Organization owners are told why.
- When the problem is spread across many small teams, every team on the ESP
  loses marketing sends until recent sends are clean. That is deliberate:
  losing the ESP account would stop transactional mail too.
- The guard only sees bounces and complaints the ESP reports back. A shared
  ESP without a feedback connection is protected only by synchronous SMTP
  rejections.
- The guard can't undo what the ESP has already counted. It keeps the shared
  account under the ESP's limits; it doesn't give teams separate reputations
  at Gmail and Microsoft. The team domains in part 2 do that.
