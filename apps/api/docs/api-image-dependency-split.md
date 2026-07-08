# PRD: Split API Email Runtime From UI Editor Dependencies

## Status

Proposed

## Objective

Reduce the SendLit API Docker image size by removing frontend/editor-only
dependencies from the API runtime dependency graph while preserving outgoing
email rendering behavior.

The immediate production symptom is that `codelit/sendlit-api:latest` is much
larger than expected. `docker history` shows the final runtime
`pnpm install --prod --frozen-lockfile --ignore-scripts` layer at roughly
1.14GB uncompressed. Inspecting `/app/node_modules/.pnpm` inside the image shows
large packages that do not belong in an API runtime image, including `next`,
`@next/swc-linux-x64-musl`, `lucide-react`, and build/test tooling.

## Problem

`apps/api` depends on `@sendlit/email-editor` because the API needs shared email
data types, default email content, and `renderEmailToHtml` for campaign
delivery.

`@sendlit/email-editor` is also the interactive browser editor package. Its
runtime dependencies include React UI libraries, icons, Radix components,
styling helpers, and React Email tooling. When the API image installs production
dependencies, those frontend-heavy packages are pulled into the API runtime even
though the API only needs a small server-safe subset.

The `.dockerignore` fix keeps Docker build contexts lean, but it does not solve
the image size issue because the oversized content is installed inside the
final image.

## Users

- Operators deploying SendLit on a single server or container platform.
- Developers maintaining SendLit Dockerfiles and deployment pipelines.
- API maintainers working on email automation, templates, sequences, and MCP
  tools.

## Goals

- Create a small server-safe package for email schema/types/default content and
  HTML rendering.
- Remove `@sendlit/email-editor` from `apps/api` production dependencies.
- Keep the existing public editor package behavior intact.
- Preserve current outgoing email HTML output unless intentionally changed and
  covered by tests.
- Reduce the API image size substantially, with a measurable before/after
  target.

## Non-Goals

- Redesigning the email editor UI.
- Changing the stored email JSON schema.
- Changing campaign, broadcast, sequence, tracking, or unsubscribe behavior.
- Replacing the Docker base image as the primary fix.
- Removing React from the web/editor packages.
- Replacing SMTP/ESP delivery logic.

## Proposed Solution

Introduce a server-safe package, tentatively named `@sendlit/email-core`, that
contains only the email primitives needed outside the browser editor:

- `Email`, `EmailBlock`, `EmailStyle`, `EmailMeta`, and related types.
- `defaultEmail`.
- `renderEmailToHtml`.
- Any renderer-only block metadata or helpers required to produce the same
  outgoing HTML.

Then update dependencies:

- `apps/api` depends on `@sendlit/email-core`.
- `@sendlit/email-editor` depends on `@sendlit/email-core` and keeps exporting
  the same editor-facing API where practical.
- `@sendlit/email-blocks` depends on `@sendlit/email-core` for types/rendering
  and on `@sendlit/email-editor` only for actual editor UI exports where
  needed.

## Desired Dependency Shape

```text
apps/api
  -> @sendlit/email-core

packages/email-editor
  -> @sendlit/email-core
  -> React/Radix/Lucide/editor UI dependencies

packages/email-blocks
  -> @sendlit/email-core
  -> @sendlit/email-editor only where UI editor exports are required

apps/web
  -> @sendlit/email-blocks
  -> @sendlit/email-editor
```

The API path must not pull `next`, `@next/swc-*`, `lucide-react`,
`@radix-ui/*`, or editor-only build dependencies into the final API image.

## Functional Requirements

1. API rendering must keep working for:
    - broadcasts;
    - sequences;
    - merge tags;
    - open pixel injection;
    - click tracking link rewriting;
    - unsubscribe links.
2. Templates and sequence email content must remain compatible with existing
   stored email JSON.
3. REST and MCP docs that mention email content types must point to the new
   shared/core package where appropriate.
4. Web/editor imports should remain source-compatible unless a deliberate
   breaking change is documented.
5. API tests should not import `@sendlit/email-editor` after the migration.

## Technical Requirements

- Add `packages/email-core`.
- Build output should be ESM-compatible, matching existing package conventions.
- Keep package exports explicit in `package.json`.
- Avoid browser-only APIs in `email-core`.
- Avoid React component/editor dependencies in `email-core` unless they are
  proven necessary for server rendering.
- Update Dockerfile build order so API builds `email-core` instead of
  `email-editor`.
- Prefer `pnpm deploy --filter @sendlit/api --prod` or another pruned runtime
  install only after the dependency graph is corrected.

## Commands

Baseline checks:

```sh
pnpm --filter @sendlit/api test
pnpm --filter @sendlit/api run typecheck
pnpm --filter @sendlit/email-editor build
pnpm --filter @sendlit/email-blocks build
pnpm --filter @sendlit/api-contract build
pnpm --filter @sendlit/api build
docker build -f apps/api/Dockerfile -t codelit/sendlit-api:local .
docker history codelit/sendlit-api:local
docker run --rm --entrypoint sh codelit/sendlit-api:local -c "du -sh /app /app/node_modules /app/node_modules/.pnpm 2>/dev/null"
```

Regression checks for unwanted API runtime packages:

```sh
docker run --rm --entrypoint sh codelit/sendlit-api:local -c "test ! -d /app/node_modules/.pnpm/next@*"
docker run --rm --entrypoint sh codelit/sendlit-api:local -c "test ! -d /app/node_modules/.pnpm/@next+swc-*"
docker run --rm --entrypoint sh codelit/sendlit-api:local -c "test ! -d /app/node_modules/.pnpm/lucide-react@*"
```

## Success Metrics

- API image compressed size is reduced from the observed ~328MB to under 180MB.
- API image uncompressed size is reduced from the observed ~1.64GB to under
  700MB.
- Final runtime `pnpm install` or equivalent runtime dependency layer is under
  400MB uncompressed.
- `next`, `@next/swc-*`, `lucide-react`, and `@radix-ui/*` are absent from the
  final API image.
- Full API test suite passes.
- Email rendering regression tests show no unintended HTML output changes.

## Implementation Plan

### Phase 1: Extract Core Package

- Create `packages/email-core`.
- Move or copy server-safe email types, `defaultEmail`, and
  `renderEmailToHtml`.
- Keep behavior identical to current `@sendlit/email-editor` exports.
- Add focused tests around renderer output for representative email blocks.

### Phase 2: Rewire API

- Replace API imports from `@sendlit/email-editor` with
  `@sendlit/email-core`.
- Update `apps/api/package.json`.
- Update API comments/docs/MCP descriptions that refer developers to
  `@sendlit/email-editor` for server-side content shape.
- Update `apps/api/Dockerfile` to build/copy `packages/email-core`.

### Phase 3: Preserve Editor/Web API

- Make `@sendlit/email-editor` import core primitives from
  `@sendlit/email-core`.
- Re-export core types and helpers from `@sendlit/email-editor` if needed to
  preserve existing package ergonomics.
- Update `@sendlit/email-blocks` imports to use `@sendlit/email-core` for
  rendering/types where that avoids dragging editor UI into non-editor paths.

### Phase 4: Prune Runtime Install

- Evaluate `pnpm deploy --filter @sendlit/api --prod` for the final Docker
  runtime stage.
- If adopted, update Dockerfile so the runner copies the deploy output instead
  of running a broad workspace-root production install.
- Confirm the final image contains only runtime files and production
  dependencies needed by `apps/api`.

### Phase 5: Validate Image Size

- Rebuild `codelit/sendlit-api:local`.
- Record `docker images`, `docker history`, and top `node_modules/.pnpm`
  directory sizes.
- Confirm success metrics.

## Testing Strategy

- Unit tests for `email-core` renderer output using representative blocks.
- Existing API tests for templates, sequences, broadcasts, validation, and MCP.
- Build tests for `email-core`, `email-editor`, `email-blocks`, and `apps/api`.
- Docker image inspection tests for unwanted frontend packages.

## Risks And Mitigations

- **Risk:** HTML rendering changes silently.
  **Mitigation:** Add renderer snapshot or structural output tests before
  switching imports.

- **Risk:** `email-core` still imports React/UI packages.
  **Mitigation:** Check package dependencies and Docker image contents as part
  of acceptance.

- **Risk:** Public `@sendlit/email-editor` consumers lose exports.
  **Mitigation:** Re-export core APIs from `email-editor` for compatibility.

- **Risk:** Build order in Docker becomes fragile.
  **Mitigation:** Keep explicit build steps and verify with
  `docker build -f apps/api/Dockerfile`.

## Acceptance Criteria

- `apps/api/package.json` no longer lists `@sendlit/email-editor`.
- `apps/api/src` has no runtime imports from `@sendlit/email-editor`.
- `apps/api/Dockerfile` does not copy or build `packages/email-editor`.
- API image does not contain `next`, `@next/swc-*`, `lucide-react`, or
  `@radix-ui/*`.
- API image meets the size targets in Success Metrics.
- Existing SendLit API tests pass.
- Existing web/editor packages build.
- REST/MCP/developer docs point server-side email content references at the
  new core package.

## Open Questions

- Should `@sendlit/email-core` be published publicly, or remain private
  workspace-only for now?
- Should `renderEmailToHtml` continue using React Email internally if it can be
  kept isolated, or should it move to a non-React renderer?
- Should Docker optimization with `pnpm deploy` be part of the same PR or a
  follow-up after the dependency split lands?
