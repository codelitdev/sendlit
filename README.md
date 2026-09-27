# SendLit

Open-source email marketing platform

## Tech stack

- TypeScript
- PostgreSQL
- Redis
- Bull MQ
- Nextjs
- Tailwind CSS
- shadcn/ui

## Status

SendLit is being bootstrapped by extracting the email composing/sending/
automation capabilities out of [CourseLit](https://github.com/codelitdev/courselit)
and reusing the OAuth2 implementation from
[MediaLit](https://github.com/codelitdev/medialit)'s API. See
[`ARCHITECTURE.md`](./ARCHITECTURE.md) for the full migration plan. `apps/api`
(including its MCP server), `packages/email-editor`, `packages/email-blocks`
and `apps/web` are built and have been validated end-to-end (OAuth login,
contacts, templates, broadcasts and sequences, including the automation/
delivery loop, and raw JSON-RPC calls against the MCP server). Account-wide
analytics, bounce handling and multi-user accounts are still on the roadmap.

## Packages

- `apps/api` — OAuth2-protected REST API: contacts, templates, broadcasts/
  sequences, mail sending and automation.
- `apps/web` — the dashboard UI (Next.js): sign in, manage contacts, compose
  templates/broadcasts/sequences, start/pause automations.
- `packages/email-editor` — the WYSIWYG email editor (`@sendlit/email-editor`).
- `packages/email-blocks` — headless composing blocks for broadcasts/
  sequences/templates (`@sendlit/email-blocks`), used by `apps/web`.

## Local development

Start the local dependencies with the dedicated Compose file, then run the API
and web app on the host:

```sh
docker compose -f docker-compose.local.yml up -d
docker compose -f docker-compose.local.yml ps
```

The local stack provides Postgres on `localhost:5434`, Redis on
`localhost:6380`, and Mailpit SMTP/UI on `localhost:1027`/`localhost:8027`.
Those defaults avoid collisions with the CourseLit local stack (Postgres
`5432`, Mailpit `1026`/`8026`) and the FrontLit local stack (Postgres `5433`,
Redis `6379`, Mailpit `1025`/`8025`). You can override the SendLit host ports
with `SENDLIT_LOCAL_POSTGRES_PORT`, `SENDLIT_LOCAL_REDIS_PORT`,
`SENDLIT_LOCAL_MAILPIT_SMTP_PORT`, and `SENDLIT_LOCAL_MAILPIT_HTTP_PORT` in
the shell or root `.env`; if you override them, update the matching database,
Redis, and SMTP ports in `apps/api/.env` too.

The `apps/api/.env.example` database, Redis, and platform SMTP settings match
these local services. Mailpit captures platform emails such as sign-in OTPs;
campaign and ESP test emails use the ESP configured in SendLit. When testing an
SMTP ESP against local Mailpit from the host-run API, use `127.0.0.1:1027`.
Open the Mailpit UI at <http://localhost:8027>.

Then push the development schema and start the apps as described below. To stop
the dependencies without deleting local database/queue data:

```sh
docker compose -f docker-compose.local.yml down
```

To intentionally delete the local Postgres and Redis data as well, use
`docker compose -f docker-compose.local.yml down -v`.

Then:

1. `apps/api`: copy `.env.example` to `.env` and fill in the values, then
   `pnpm --filter @sendlit/api db:push`.
2. `apps/web`: copy `.env.example` to `.env.local` (`API_URL` pointing at the
   API above).
3. Build the two shared packages at least once so `apps/web` has something to
   import: `pnpm --filter @sendlit/email-editor build && pnpm --filter @sendlit/email-blocks build`
   (re-run, or use their `dev` scripts, after changing either package).
4. From the repo root, start the apps you need:

    ```sh
    pnpm dev:api
    pnpm dev:web
    pnpm dev:docs
    ```

## Operator billing CLI

Cloud billing recovery is a CLI, not the dashboard. From the repo root it
loads `apps/api/.env` and talks to that API's database:

```sh
pnpm --filter @sendlit/api billing catalog-status
pnpm --filter @sendlit/api billing catalog-verify
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

## Self-hosting with Docker Compose

The root Compose stack runs PostgreSQL, Redis, the API, and the web dashboard.
It also uses a one-shot `init` service to apply database migrations and create
or find the initial organization owner, their default team, and any configured
organization API keys.

```sh
cp .env.example .env
# Set the required secrets in .env (commands are included as comments there).
docker compose up --build -d
docker compose logs init
```

`BOOTSTRAP_ORGANIZATION_OWNER_EMAIL` selects an ordinary initial organization
owner; it does not create a special global-admin role. To integrate
headlessly, set `BOOTSTRAP_DELIVERY_SETUP_API_KEY` and `BOOTSTRAP_TEAM_PROVISIONING_API_KEY` in
`.env`. Bootstrap hashes both keys and never logs them.
See the [Headless organization setup](./apps/docs/content/docs/developers/headless-provisioning.mdx)
for the complete REST sequence, scopes, rotation, and migration from the old
log-generated key. The plain Markdown guide is at
[`apps/docs/integrations/headless-provisioning.md`](./apps/docs/integrations/headless-provisioning.md).

Open the dashboard at `WEB_CLIENT` (by default,
`http://localhost:3000`) and API documentation at `API_PUBLIC_URL/docs`.

For an internet-facing deployment, set `API_PUBLIC_URL`, `WEB_CLIENT`,
`PROTOCOL=https`, and `DOMAIN` to the public values before the first start.
Put the API and web ports behind a TLS reverse proxy; set `ENABLE_TRUST_PROXY=true`
when that proxy forwards client IPs. Back up the `postgres-data` volume and
keep the `.env` secrets stable: changing the ESP encryption key makes stored
team SMTP credentials unreadable.
