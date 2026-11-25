---
title: Acceptable use and deliverability
description: What you may send through SendLit cloud, and the controls that protect shared deliverability.
nav_order: 30
---

SendLit cloud shares sending infrastructure, domains and provider standing
across its customers, so one abusive account can hurt everyone. These rules
and controls apply to SendLit cloud. Self-hosted OSS installations run their
own infrastructure and none of the controls below apply to them.

## What you may send

Send only to people who asked to hear from you, and make it easy for them to
stop. You may not use SendLit for:

- purchased, rented, scraped or harvested lists, or lists of people who never
  opted in;
- phishing, credential harvesting, malware, or links that hide where they go;
- impersonating another person, company or brand;
- deceptive offers, scams, illegal goods, or content that is illegal where it
  is sent or received;
- getting around these controls, for example by spreading sends over several
  accounts.

SendLit may review accounts, imports and email content for these purposes,
hold emails for review, pause a team's sending, and suspend or close
organizations that break these rules, with or without notice. If we pause
something by mistake, reply to our email and a person will look at it.

## Signing up

Accounts are created with a one-time code sent to the email address, so every
account owns its mailbox. In addition, cloud signup:

- rejects disposable and temporary email domains;
- may flag accounts on free mail providers (Gmail, Outlook, ...) for review;
- limits how many accounts can be created from one network per day.

## Checks before sending

Before a broadcast or sequence starts, before a test is sent, and when a
running sequence's email is edited, SendLit checks the email for phishing,
malware and spam patterns (link text that hides the real destination,
account-verification lures, executable downloads, link shorteners, and
similar), optionally with an AI classifier.

- **Held for review:** the email can't be sent until a SendLit operator
  approves it, usually within a business day. You get an email.
- **Blocked:** clear phishing or malware. Sending for the team is paused while
  an operator reviews it.

Once approved, the same content isn't checked again.

## Large imports

Importing a large list in a short time, especially on a new account, alerts
SendLit's operators. On accounts younger than 30 days, campaigns can't start
until the import has been reviewed. Imports are recorded in the organization's
activity log.

## New accounts send gradually

For an organization's first 30 days, marketing mail is paced:

- the daily marketing allowance ramps up: 200 a day at first, then 1,000, then
  10,000, rising as the account stays free of bounce and complaint problems
  (the steps need 3, 4 and 7 clean days);
- through a shared mailbox (one your organization provides to its teams), each
  day's allowance is spread over about 12 hours, so a broadcast goes out over
  the day instead of in one burst. The broadcast page shows the pace and when
  it should finish.

Emails beyond the pace wait for the next hour or day; nothing fails.

Through your team's own ESP, broadcasts aren't spread out: your ESP's own
limits apply, and the reputation is yours. Instead, the first broadcast to
1,000 or more contacts is reviewed once before it starts. We email you, and
you start it again once it's approved, usually within a business day. If a
large import was already reviewed, that review counts: a new account is
reviewed once, not twice.

A SendLit operator can lift these limits early for a vetted organization.
Transactional mail is not paced. Each plan also has a monthly email allowance;
see [Pricing and billing](/docs/workspace/pricing).

## Reputation windows

After a team has at least 500 accepted messages in a rolling seven-day window,
SendLit evaluates bounce and complaint rates from the outbound ledger. Retries
and duplicate provider events count once.

| Signal                           | Action                                                                                 |
| -------------------------------- | -------------------------------------------------------------------------------------- |
| Bounce ≥ 2% or complaint ≥ 0.05% | Warn owners and admins                                                                 |
| Bounce ≥ 5% or complaint ≥ 0.1%  | Pause broadcasts and sequences; transactional mail continues at a degraded daily limit |
| Complaint ≥ 0.3%                 | Stop all new sends for that team                                                       |
| 10 complaints in seven days      | Stop all new sends for that team, regardless of list size                              |

`all_paused` does not auto-recover. A SendLit operator must review the list and
release the team, which starts at `warned`.

## Shared mailboxes

Teams that send through an organization's shared mailbox share its email
provider account, and providers can pause a whole account when its bounce or
complaint rate gets too high. SendLit checks each shared mailbox's last seven
days and acts before the provider does:

| Signal | Action |
| --- | --- |
| A team's own bounce ≥ 4% or complaint ≥ 0.08% (at least 5 bounces or 2 complaints) | Pause that team's broadcasts and sequences through the mailbox |
| The mailbox's combined bounce ≥ 2% or complaint ≥ 0.05% | Warn owners, and pause the teams over those rates themselves, worst first, until the rest is under them |
| The teams left are still at bounce ≥ 4% or complaint ≥ 0.08% | Pause broadcasts and sequences for every team on the mailbox |

There's no 500-message minimum here, so a small team with a bad list is caught
too, but a single complaint never pauses a team. Transactional mail keeps
sending, and teams' own ESPs aren't affected. A pause lasts at least 72 hours
and lifts after three clean daily checks; a SendLit operator can release it
earlier. Organization owners are emailed when a pause starts or lifts.

## Domain verification

Cloud sending requires a verified organization owner email. After about 100
accepted lifetime messages, the From domain must be verified with a DNS TXT
record at `_sendlit-verification.<domain>`. Plain SMTP can be used for tests
but cannot unlock volume without a healthy bounce/complaint feedback
connection.
