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

Start Postgres and Redis, then run the API and web app on the host.

```sh
docker run -d --name sendlit-postgres --restart unless-stopped \
  -e POSTGRES_DB=sendlit \
  -e POSTGRES_USER=sendlit \
  -e POSTGRES_PASSWORD=sendlit \
  -p 5432:5432 \
  postgres:17-alpine

docker run -d --name sendlit-redis --restart unless-stopped \
  -p 6379:6379 \
  redis:7-alpine redis-server --appendonly yes
```

These ports match `apps/api/.env.example` (`localhost:5432` and `localhost:6379`).
If a host port is already in use, change the left-hand side of `-p` and update
`DB_CONNECTION_STRING` or `REDIS_PORT` to match.

To wipe the local Postgres data and start over, remove the container (and its
volume) and run the `docker run` command again:

```sh
docker rm -fv sendlit-postgres
```

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
the first account, its default team, and a team-scoped API key.

```sh
cp .env.example .env
# Set the required secrets in .env (commands are included as comments there).
docker compose up --build -d
docker compose logs init
```

Set `SUPER_ADMIN_EMAIL` before the first start. The `init` logs contain the
initial API key exactly once; save it in a password manager and use it as the
`x-sendlit-apikey` header. If it is lost, create a replacement in the dashboard
or through the authenticated API. Open the dashboard at `WEB_CLIENT` (by
default, `http://localhost:3000`) and API documentation at `API_PUBLIC_URL/docs`.

For an internet-facing deployment, set `API_PUBLIC_URL`, `WEB_CLIENT`,
`PROTOCOL=https`, and `DOMAIN` to the public values before the first start.
Put the API and web ports behind a TLS reverse proxy; set `ENABLE_TRUST_PROXY=true`
when that proxy forwards client IPs. Back up the `postgres-data` volume and
keep the `.env` secrets stable: changing the ESP encryption key makes stored
team SMTP credentials unreadable.
