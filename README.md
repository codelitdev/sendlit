<div align="center">

<img src="assets/logo.svg" alt="SendLit logo" width="72" height="72" />

# SendLit

**Email marketing for teams, apps and agents.**

Manage contacts, design templates, send broadcasts and run automated sequences, through a dashboard,<br />
a REST API, an MCP server and an embeddable email editor. Bring your own SMTP provider.

[![License: AGPL-3.0](https://img.shields.io/badge/license-AGPL--3.0-blue)](https://www.gnu.org/licenses/agpl-3.0.html)
[![Docker](https://img.shields.io/docker/v/codelit/sendlit?label=docker&sort=semver)](https://hub.docker.com/r/codelit/sendlit)
[![Tests](https://github.com/codelitdev/sendlit/actions/workflows/test.yaml/badge.svg)](https://github.com/codelitdev/sendlit/actions/workflows/test.yaml)
[![Code quality](https://github.com/codelitdev/sendlit/actions/workflows/code-quality.yaml/badge.svg)](https://github.com/codelitdev/sendlit/actions/workflows/code-quality.yaml)

[Website](https://sendlit.app) · [Docs](./apps/docs/content/docs/index.mdx) · [Getting started](./apps/docs/content/docs/getting-started/overview.mdx) · [Self-hosting](#self-hosting)

</div>

---

## Why SendLit

Sending one email is easy. Running email marketing means you also need an audience database, a composer, segmentation, drip automations, unsubscribe handling, open and click tracking, suppression lists, and a way to give your app and your AI tools safe access to all of it. SendLit is that layer, in one open-source stack.

- **Broadcasts and sequences share one model.** A broadcast is a one-off sequence with a single email; a sequence is a multi-step automation enrolled by event triggers.
- **Team-scoped everything.** Each team owns its contacts, templates, sending provider, API keys and quota, so one deployment can serve many brands or clients.
- **Bring your own sending provider.** Plug in any SMTP service (SES, SendGrid, Postmark, Mailgun and so on). Credentials are stored encrypted.
- **Built for agents.** Claude, ChatGPT, Cursor and any MCP client can work with your audience and campaigns over OAuth.
- **Embeddable editor.** The WYSIWYG email editor and the composing blocks are published as React packages you can use in your own product.
- **Deliverability basics included.** Contact filters and tags, suppression lists, one-click unsubscribe, transactional sends and tracking.
- **Open source and portable.** Self-host the whole thing with one `docker compose up`.

## Quick start

The fastest way to try SendLit is the Docker Compose stack, which runs PostgreSQL, Redis, the API and the dashboard:

```bash
git clone https://github.com/codelitdev/sendlit.git
cd sendlit
cp .env.example .env
# Fill in the required secrets in .env (generation commands are included as comments).
docker compose up --build -d
docker compose logs init
```

Open the dashboard at <http://localhost:3000>, sign in with an email one-time code, and follow [Send your first broadcast](./apps/docs/content/docs/getting-started/first-broadcast.mdx).

`BOOTSTRAP_ORGANIZATION_OWNER_EMAIL` selects an ordinary initial organization
owner; it does not create a special global-admin role. To integrate
headlessly, set `BOOTSTRAP_DELIVERY_SETUP_API_KEY` and `BOOTSTRAP_TEAM_PROVISIONING_API_KEY` in
`.env`. Bootstrap hashes both keys and never logs them.
See the [Headless organization setup](./apps/docs/content/docs/developers/headless-provisioning.mdx)
for the complete REST sequence, scopes, rotation, and migration from the old
log-generated key. The plain Markdown guide is at
[`apps/docs/integrations/headless-provisioning.md`](./apps/docs/integrations/headless-provisioning.md).

Call the API with the key printed by the `init` service:

```bash
curl http://localhost:5000/contacts \
  -H "x-sendlit-apikey: sl_live_..."
```

Connect an AI agent: add `https://api.sendlit.app/mcp` (or `http://localhost:5000/mcp` for your own instance) as a remote MCP server in your client and sign in. See the [MCP guide](./apps/docs/content/docs/developers/mcp.mdx).

## Packages

| Package                                          | Description                                                       | License |
| ------------------------------------------------ | ----------------------------------------------------------------- | ------- |
| [`@sendlit/email-editor`](packages/email-editor) | WYSIWYG email editor                                              | MIT     |
| [`@sendlit/email-blocks`](packages/email-blocks) | Headless composing blocks for broadcasts, sequences and templates | MIT     |
| [`@sendlit/api-contract`](packages/api-contract) | Shared REST API contract (schemas and types)                      | MIT     |

The repository also contains the API (`apps/api`), which owns all product behavior including the MCP server; the dashboard (`apps/web`), a Next.js client over the API; and the docs site (`apps/docs`).

**Tech stack:** TypeScript, PostgreSQL, Redis, BullMQ, Next.js, Tailwind CSS and shadcn/ui.

## Self-hosting

The root Compose stack runs PostgreSQL, Redis, the API and the web dashboard, plus a one-shot `init` service that applies migrations and creates the first account, its default team and a team-scoped API key.

1. Set `BOOTSTRAP_ORGANIZATION_OWNER_EMAIL` and the required secrets in `.env` before the first start.
2. Run `docker compose up --build -d`. The `init` service applies migrations and creates the owner's organization and default team.
3. Open the dashboard at `WEB_CLIENT` (default `http://localhost:3000`) and the API documentation at `API_PUBLIC_URL/docs`.
4. Configure a sending provider for your team in the dashboard settings. Without one, SendLit won't send campaign mail.

For an internet-facing deployment:

- Set `API_PUBLIC_URL`, `WEB_CLIENT`, `PROTOCOL=https` and `DOMAIN` to the public values before the first start.
- Put the API and web ports behind a TLS reverse proxy, and set `ENABLE_TRUST_PROXY=true` when it forwards client IPs.
- Back up the `postgres-data` volume and keep the `.env` secrets stable. Changing the ESP encryption key makes stored team SMTP credentials unreadable.
- If you send through Amazon SES, follow [Amazon SES bounces and complaints](./apps/docs/content/docs/self-hosting/amazon-ses-feedback.mdx) so SendLit suppresses bounced and complaining addresses.

Prebuilt images are published on release tags: [`codelit/sendlit`](https://hub.docker.com/r/codelit/sendlit) (API) and [`codelit/sendlit-web`](https://hub.docker.com/r/codelit/sendlit-web) (dashboard).

## Development

**Requirements:** [Bun](https://bun.sh) 1.4.1 and Docker. We develop on Linux; on Windows, use WSL.

SendLit follows the [CodeLit Platform](https://github.com/codelitdev/platform) conventions: one Bun workspace, the API runs its TypeScript directly on Bun, and shared infrastructure comes from the published `@codelitdev/*` packages.

```bash
bun install

# 1. Start Postgres, Redis and Mailpit for local development.
docker compose -f docker-compose.local.yml up -d

# 2. Configure the API and create its tables.
cp apps/api/.env.example apps/api/.env
bun --filter @sendlit/api db:migrate

# 3. Build the shared packages once so the API and dashboard can import them.
bun run build:packages

# 4. Configure the dashboard (API_URL must point at the API).
cp apps/web/.env.example apps/web/.env.local

bun run dev:api    # API
bun run dev:web    # Dashboard on http://localhost:3000
bun run dev:docs   # Docs site
```

The local Compose file publishes Postgres on `5434`, Redis on `6380` and Mailpit on `1027` (SMTP) and `8027` (UI), so it can run next to the CourseLit and FrontLit local stacks. `apps/api/.env.example` already points at those ports. Bun loads `apps/api/.env` automatically.

Re-run `bun run build:packages` (or use the packages' `dev` scripts) after changing `@sendlit/email-editor` or `@sendlit/email-blocks`.

### Tests

```bash
bun run test       # API, web and package unit tests
bun run typecheck  # TypeScript in every workspace
bun run lint       # Biome lint
bun run format     # Biome format (bun run format:check in CI)
```

## Operator billing CLI

Cloud billing recovery is a CLI, not the dashboard. From the repo root it
loads `apps/api/.env` and talks to that API's database:

```sh
bun --filter @sendlit/api billing catalog-status
bun --filter @sendlit/api billing catalog-verify
```

Run it with no arguments for the full list. Subcommands:

- `catalog-status` / `catalog-verify` / `catalog-abandon <revision> --reason <text>`
- `reconcile-org <organization_public_id>`
- `webhook-retry <provider_event_id>` / `webhook-inspect <provider_event_id>`
- `set-override <organization_public_id> --teams <n>|none --contacts <n>|none --reason <text>`
- `reputation-apply <team_public_id> <warned|marketing_paused|all_paused> --operator <user_id> --reason <text>`
- `reputation-release <team_public_id> --operator <user_id> --reason <text>`
- `cancel-subscription <organization_public_id> --reason <text>`

OSS mode has nothing to verify. A new `BILLING_CATALOG_REVISION` is recorded on
API startup; `catalog-verify` checks it against Dodo and activates it.

## Documentation

Product, API and email-block docs live in [`apps/docs`](apps/docs). The REST reference is generated from the API contract, and the running API serves interactive documentation at `/docs`.

## Contributing

Contributions are welcome. For anything larger than a small fix, please open an issue first so we can agree on the approach.

1. Fork the repository and create a branch.
2. Make your change, with tests. If you change a published package, add a changeset with `bun run changeset`.
3. If you change `apps/api`, update the REST API documentation and the MCP server too.
4. Run `bun run lint`, `bun run format`, `bun run typecheck` and `bun run test`.
5. Open a pull request.

Questions and ideas are welcome in [GitHub issues](https://github.com/codelitdev/sendlit/issues).

## Security

Please don't report security issues in public issues. Report them privately through [GitHub's security advisories](https://github.com/codelitdev/sendlit/security/advisories/new).

## Licensing

SendLit is split into two licenses:

- **AGPL-3.0-or-later** covers the server (`apps/api`), the dashboard (`apps/web`), the docs site (`apps/docs`) and internal tooling. If you run a modified SendLit as a hosted service, you must share your changes under the same license. Self-hosting is free.
- **MIT** covers the packages you embed in your own products: `@sendlit/email-editor`, `@sendlit/email-blocks` and `@sendlit/api-contract`. Each published package declares MIT in its `package.json`.

The AGPL license text is in [LICENSE](./LICENSE).

SendLit grew out of the email capabilities of [CourseLit](https://courselit.app) and shares its OAuth2 foundations with [MediaLit](https://medialit.cloud).
