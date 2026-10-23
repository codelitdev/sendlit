## Development Tips

- Don't duplicate stuff over and over. Re-use existing code and libraries.
- While making changes to the `apps/api` directory, make sure the REST API documentation and MCP server are updated as well.
- For UI components, use shadcn/ui exclusively. Always use Shadcn CLI for installing components. Never hand roll standard Shadcn components. Prefer shadcn/ui components over browser-native components.
- When dealing with a large change, work through it in layers: money-path correctness first, then enforcement, then dashboard/self-serve, then ops and docs.
- If you are a Grok model, make sure you run the linter and tests before declaring any task done.
- SendLit is an email marketing platform on top of the customer's own ESP, not an ESP. Push back on sending-infrastructure work (MTAs, IP pools, SMTP relay), but don't refuse marketing features because an ESP also has them, and keep features provider-neutral. See [ADR 0005](docs/decisions/0005-marketing-platform-not-esp.md).
- Always send important events and errors to PostHog through `@codelitdev/observability`, via the API's `src/observability` wrappers (`captureEvent`, `captureError`). Add any new property name to `PROPERTY_ALLOWLIST` in `src/observability/instance.ts`, or it is dropped. Send codes and internal ids only, never email addresses, IPs or other personal data.

## Design Guidelines

- Loading states show only the animated SendLit mark, large and dead centre in the area that is loading (page, card or dialog body), with no "Loading…" text. Use the `Loading` component (`apps/web/components/dashboard/loading.tsx`); don't build your own spinner or loading text.
- Dialogs follow the domain authentication dialog (`apps/web/components/dashboard/domain-authentication-dialog.tsx`):
  - **Header**, separated by a rule: a title that names the object (code-like values such as a domain in monospace), one or two plain sentences on why it matters, and a progress summary when the dialog tracks several steps (for example "1 of 3 done" with what's left).
  - **Body** that scrolls on its own: one collapsible section per step or topic, each with a status icon, a name, a one-line summary, a status pill and a chevron. Sections that need attention start open; finished ones start folded.
  - **Inside a section**: one sentence saying exactly what to do, then the details. Technical values (DNS names, keys, IDs) are monospace with a copy button; values the user gets elsewhere link there with an external-link icon. Advanced or rarely needed options sit behind a collapsible question ("Using another provider's DKIM selector?").
  - **Footer**, separated by a rule: context on the left (when it was last checked, how long changes take), actions on the right: a secondary Close and one primary action with an icon.
  - **Status** is colour plus words, never colour alone: green for done, amber for needs attention, red for missing.

## CodeLit Platform

SendLit is built on the [CodeLit Platform](https://github.com/codelitdev/platform) (`~/dev/proj/platform`) and follows its conventions. Prefer a Platform package over SendLit code for shared infrastructure.

- Bun 1.4.1 is the package manager, runtime and test runner. Use `bun --filter <package> <script>` for one workspace. The API runs its TypeScript directly with `bun`; there is no emit step.
- Lint and format with Biome (`bun run lint`, `bun run format`). Tests use `bun test --parallel`; mock modules with `mock.module()` before loading the code under test with `await import()`. Shared helpers live in `@sendlit/test-utils`.
- `@codelitdev/*` packages all release under one version. Bump every one of them together, keep exact pins, and keep other dependencies at the versions in platform-cli's preset (`bunx @codelitdev/platform-cli@<version> doctor` must report no issues). Then run `bunx @codelitdev/platform-cli@<version> sync` on a clean tree to update the managed files listed in `.codelit-platform.json`. Never edit a managed file by hand.
- Request auth accepts exactly one credential (session cookie, `Authorization: Bearer`, or an API key in `X-API-Key`/`x-sendlit-apikey`); more than one is `credential_ambiguous`. Telemetry goes through `src/observability`, never a PostHog client directly.
- Billing runs on `@codelitdev/billing` and the `@codelitdev/platform/billing` adapters. Read paid state with `commercialState()`; never through `billing.store` or by querying billing tables.
- Database migrations follow Platform's product layout: drizzle-kit SQL in `apps/api/drizzle`, applied by `src/db/migrate.ts` before the API starts, never on boot. Keep schema changes compatible with the previous release.
- `bun run --filter "*/api" check:drift` (billing and Better Auth schema drift) and `bun run --filter "*/api" test:conformance` must pass; the Platform conformance workflow runs both.
- Record critical decisions as ADRs in `docs/decisions`.

## Architecture Tips

- Always lean towards industry standards in the bulk emailing services domain while working on features. You can consider Mailchimp, Klaviyo, SendGrid, ActiveCampaign, or other popular email marketing platforms.

## Branch management

- Never push on your own. Leave it to the human.

## Testing Tips

- From browser based smoke testing, boot up the API and Web app using `bun run dev:api` and `bun run dev:web` respectively.
- `docker compose -f docker-compose.local.yml up -d` starts Postgres, Redis and Mailpit for full integration testing.
- Prefer Chrome DevTools MCP for browser-based debugging, in the headful mode.
