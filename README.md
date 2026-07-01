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

## Running everything locally

1. Start Postgres and Redis (e.g. via Docker).
2. `apps/api`: copy `.env.example` to `.env`, fill in the values, then
   `pnpm --filter @sendlit/api db:push` and `pnpm --filter @sendlit/api dev`.
3. `apps/web`: copy `.env.example` to `.env.local` (`API_URL` pointing at the
   API above), then `pnpm --filter @sendlit/web dev`.
4. Build the two shared packages at least once so `apps/web` has something to
   import: `pnpm --filter @sendlit/email-editor build && pnpm --filter @sendlit/email-blocks build`
   (re-run, or use their `dev` scripts, after changing either package).
