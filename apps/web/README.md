# Introduction
This web application provides a user interface for managing email automation based on API and ready to use components from the `packages/` directory.

## Architecture
- Uses `shadcn/ui`-style components (vendored in `components/ui`, same primitives as `packages/email-editor`/`packages/email-blocks`).
- Authenticates against the API's OAuth2 (Authorization Code + PKCE) flow. A
  same-origin BFF (`app/api/auth/*`, `app/api/proxy/[...path]`) performs the
  token exchange/refresh and keeps the access/refresh tokens in httpOnly
  cookies — the browser never sees them and always talks to `/api/proxy/*`.
- Uses `packages/email-blocks` for composing broadcasts/sequences/templates,
  and `packages/email-editor` (via `email-blocks`) for the WYSIWYG editor.

## Pages

- `/login` — starts the OAuth flow (`/api/auth/login`)
- `/dashboard/contacts` (+ `/[contactId]`) — list/create/tag/unsubscribe contacts
- `/dashboard/templates` (+ `/[templateId]`) — list/create/edit reusable templates
- `/dashboard/broadcasts` (+ `/[sequenceId]`) — one-off sends: audience filter,
  sender, content, start/pause, delivery stats
- `/dashboard/sequences` (+ `/[sequenceId]`) — multi-step, event-triggered
  automations: trigger, per-email content/delay/tag-action, start/pause, stats

## Running

See the root [`README.md`](../../README.md#running-everything-locally).

## Status

Built and validated end-to-end (OAuth login, contacts, templates, broadcasts
and sequences, including the automation/delivery loop) — see the root
[`ARCHITECTURE.md`](../../ARCHITECTURE.md) for what's still on the roadmap
(the MCP server, richer analytics, drag-to-reorder for sequence emails).
