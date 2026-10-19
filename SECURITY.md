# Security Policy

SendLit stores contact lists, email content and email service provider (ESP)
credentials, so we take security reports seriously. Thank you for helping keep
SendLit and its users safe.

## Supported versions

| Version                                                  | Supported |
| -------------------------------------------------------- | --------- |
| Hosted service (`sendlit.app`, `api.sendlit.app`)        | Yes       |
| Latest release (Docker images and `@sendlit/*` packages) | Yes       |
| `main` branch                                            | Yes       |
| Older releases                                           | No        |

Fixes are made on `main` and shipped in the next release. If you self-host,
please upgrade to the latest release before reporting.

## Reporting a vulnerability

**Please do not report security vulnerabilities through public GitHub issues,
discussions or pull requests.**

Report privately through GitHub's
[private vulnerability reporting](https://github.com/codelitdev/sendlit/security/advisories/new)
(the **Report a vulnerability** button under this repository's **Security**
tab). This opens a draft security advisory that only you and the maintainers
can see.

Please include:

- the affected component (for example the API, web app, MCP server or a
  package) and version or commit
- steps to reproduce, or a proof of concept
- the impact you think it has

## What to expect

- **Acknowledgement** within 3 business days.
- **Initial assessment** (whether we can reproduce it, and its severity) within
  7 business days.
- **Updates** as we work on a fix. We aim to fix critical and high-severity
  issues as quickly as possible, and will agree a disclosure date with you.
- **Disclosure:** once a fix is released, we publish a GitHub Security Advisory
  and credit you, unless you prefer to remain anonymous.

Please give us a reasonable chance to fix the issue before disclosing it
publicly.

## Scope

In scope:

- the code in this repository: the API (`apps/api`), including authentication,
  OAuth and the MCP server (`/mcp`); the web app (`apps/web`); and the published
  packages (`packages/*`)
- the hosted service at `sendlit.app` and `api.sendlit.app`
- the official Docker images (`codelit/sendlit`, `codelit/sendlit-web`)

Out of scope:

- vulnerabilities in third-party services or dependencies that are not caused
  by how SendLit uses them (please report those upstream)
- misconfiguration of your own self-hosted deployment
- denial of service through volumetric attacks, spam or social engineering
- automated scanner output without a demonstrated impact

When testing against the hosted service, only use accounts and data you own,
and do not degrade the service for other users.
