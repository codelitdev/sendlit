# MCP 2026-07-28 implementation record

## Status

This document describes the MCP implementation that is present in SendLit as
of 2026-08-09. It is an implementation record, not the original migration
proposal.

SendLit now uses the stable TypeScript SDK 2 packages and exposes one
authenticated Streamable HTTP endpoint at `POST /mcp`. The endpoint serves:

- modern MCP `2026-07-28` requests using the stateless protocol core; and
- existing 2025-era Streamable HTTP requests through SDK 2's built-in
  stateless legacy serving mode.

Both eras use the same request-local server factory, 68-tool catalog,
authorization policy, and domain services. There is no SDK v1 server, MCP
session store, `Mcp-Session-Id` response, or standalone HTTP+SSE endpoint.

The implementation has been manually connected from Claude.ai, Cloudflare's
AI Playground, and VS Code through an HTTPS Tailscale Funnel. These clients can
discover the tool catalog and invoke tools. Automated tests also pin an SDK 2
client to `2026-07-28` and assert that it negotiates the modern protocol era.

## Sources

- [MCP SDK documentation for 2026-07-28](https://modelcontextprotocol.io/docs/2026-07-28/sdk)
- [MCP 2026-07-28 release announcement](https://blog.modelcontextprotocol.io/posts/2026-07-28/)
- [TypeScript SDK v1 to v2 migration guide](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/migration/upgrade-to-v2.md)
- [TypeScript SDK 2026-07-28 support guide](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/migration/support-2026-07-28.md)
- [Better Auth CIMD documentation](https://better-auth.com/docs/beta/plugins/cimd)

## Protocol implementation

### Modern requests are genuinely stateless MCP 2026-07-28

The route constructs the official SDK handler as follows:

```ts
createMcpHandler(() => buildMcpServer(), {
    legacy: "stateless",
    onerror,
});
```

For a modern request, SDK 2:

1. classifies and validates the `2026-07-28` request envelope;
2. validates `MCP-Protocol-Version`, `Mcp-Method`, and `Mcp-Name` against the
   envelope;
3. calls the factory to create a fresh `McpServer`;
4. passes the request's verified `AuthInfo` into the handler context; and
5. closes the request-local server after the exchange.

There is no `initialize` exchange and no hidden transport session on the modern
path. Any modern request can be served by any API instance. Durable SendLit
state remains in Postgres, Redis/BullMQ, and the existing auth system; that is
application state, not MCP transport-session state.

The process-level schema cache in `mcp/tool-registry.ts` is also not client
state. It contains only immutable schema adapters keyed by tool name so the 68
Zod-to-JSON-Schema conversions are not repeated for every request. It contains
no credentials, client capabilities, team selection, or request data.

### Existing Streamable HTTP clients use SDK-provided compatibility

The same endpoint accepts a 2025-era `initialize` POST because
`legacy: "stateless"` is enabled. That option is implemented by
`@modelcontextprotocol/server`; SendLit does not classify, translate, or
dispatch protocol eras itself.

The explicit option currently matches SDK 2's default. It remains in the route
to document that support for existing Streamable HTTP clients is intentional.
Setting it to `legacy: "reject"` would make the endpoint strictly 2026-only.

The legacy path is stateless too: SDK 2 creates a fresh server and a fresh
Streamable HTTP transport for each POST with no session ID generator. SendLit
does not retain the transport after the request.

| Request form                        | Current behavior                            |
| ----------------------------------- | ------------------------------------------- |
| Modern `2026-07-28` request         | Served by the SDK 2 per-request modern path |
| 2025-era `initialize`/request POST  | Served by the SDK 2 stateless legacy path   |
| `GET /mcp`                          | Not routed; returns 404                     |
| `DELETE /mcp`                       | Not routed                                  |
| `Mcp-Session-Id` response           | Never emitted by the tested legacy flow     |
| Standalone legacy HTTP+SSE endpoint | Not implemented                             |

A 2025 Streamable HTTP POST may receive a `text/event-stream` response. That is
the response form used inside Streamable HTTP and is not the retired standalone
SSE transport, which required a separately opened GET stream.

### Server capabilities

`buildMcpServer()` creates one request-local `McpServer` identified as SendLit
version `2.0.0`. It registers tools in a fixed domain order and advertises
private five-minute cache hints for:

- `server/discover`; and
- `tools/list`.

SendLit currently exposes tools only. It does not register MCP prompts,
resources, tasks, MRTR approval flows, sampling, roots, or logging facilities.
Tool calls are ordinary request/response operations and do not depend on
server-to-client requests.

## HTTP and Express integration

The route is mounted before Express's global JSON body parser. The official
`@modelcontextprotocol/node` adapter owns body parsing, content-type validation,
and protocol error responses.

The actual request pipeline is:

```text
POST /mcp
  -> MCP CORS handling
  -> per-IP MCP rate limit
  -> OAuth bearer or team API-key authentication
  -> team resolution
  -> typed MCP AuthInfo construction
  -> request logging
  -> @modelcontextprotocol/node adapter
  -> @modelcontextprotocol/server createMcpHandler
  -> fresh buildMcpServer()
  -> centralized tool policy
  -> existing SendLit domain query/service
```

The CORS preflight allows `Content-Type`, `Accept`,
`MCP-Protocol-Version`, `Mcp-Method`, `Mcp-Name`, `Authorization`, and
`x-sendlit-apikey`. It deliberately does not advertise `Mcp-Session-Id`.

The endpoint has a 60-request-per-minute default limit per rate-limit key.
Requests whose `Mcp-Name` identifies one of the configured high-impact tools
use a 20-request limit. This header-aware lower limit applies naturally to
modern requests; a 2025 request without `Mcp-Name` receives the default limit.

## Authentication and tenant isolation

### Accepted credentials

Every MCP protocol request, including `server/discover`, is authenticated
before SDK dispatch. The endpoint accepts:

- an OAuth bearer access token; or
- `x-sendlit-apikey` for a fixed-team API key.

Better Auth browser-session cookies are rejected on `/mcp`. Browser sessions
remain valid for SendLit's first-party UI and OAuth login/consent pages, but do
not silently authenticate a remote MCP caller.

### Request-local AuthInfo

`createSendLitMcpAuthInfo()` keeps these concepts separate:

- the OAuth client identity in `AuthInfo.clientId`;
- the verified OAuth scopes in `AuthInfo.scopes`;
- the selected tenant in `AuthInfo.extra.teamId`;
- the authentication kind in `AuthInfo.extra.authKind`; and
- the optional human user in `AuthInfo.extra.user`.

For a team API key, `AuthInfo.token` and `clientId` use the stable public API-key
ID, never the API-key secret. The secret is not copied into the MCP context.

OAuth tokens carry the team selected during the authorization flow. A team API
key resolves directly to exactly one team. MCP therefore does not accept a
caller-supplied team selector as its source of tenant authority.

### Default-deny tool scopes

`mcp/policy.ts` is the central registry for both supported OAuth scopes and the
required scope of every tool. Registration calls `getRequiredScope(name)`,
which throws if a tool has no policy entry. Catalog tests assert that the 68
registered tools and policy entries are identical sets.

OAuth calls must contain the tool's required scope. Team API keys currently
have full access to their fixed team because scoped team keys are not yet a
SendLit API-key product feature.

The supported scope families are contacts, templates, media, sequences,
emails, settings, ESP configuration, teams, API keys, feedback, delivery
events, and suppressions, with read/write or read/send separation as
appropriate.

## OAuth discovery and client onboarding

OAuth support is not provided solely by the MCP SDK. SendLit combines:

- `@codelitdev/oauth-server-kit/mcp` for MCP protected-resource and
  authorization-server discovery integration;
- Better Auth's OAuth provider for authorization code, PKCE, consent, tokens,
  resources, and public Dynamic Client Registration (DCR); and
- Better Auth's CIMD plugin configured with the `mcp-2026-07-28` metadata
  profile.

The authorization-server metadata advertises:

- issuer information and authorization-response issuer support;
- Client ID Metadata Documents (CIMD);
- a public DCR endpoint; and
- the same supported scopes enforced by the MCP policy registry.

CIMD is preferred for modern clients. DCR remains enabled because clients such
as MCP Inspector still depend on it, even though DCR is deprecated by the
`2026-07-28` specification.

### Custom CIMD fetch and client compatibility

`auth/cimd-fetch.ts` is genuine compatibility code outside the MCP wire
protocol. It exists for two reasons:

1. Better Auth `1.7.0-rc.4`'s secure fetch helper is incompatible with Node
   24's `lookup(..., { all: true })` callback contract.
2. VS Code and Claude publish optional OAuth grant types that SendLit's OAuth
   provider does not implement, although both clients use Authorization Code
   with PKCE for this connection.

The custom fetcher:

- requires an HTTPS metadata URL;
- resolves all DNS answers and rejects private, loopback, link-local,
  documentation, multicast, and other non-public addresses;
- pins the outbound request to a validated DNS answer while retaining TLS SNI
  and the original Host header;
- performs no redirect following because it uses a direct Node HTTPS request;
- passes through an available abort signal;
- removes Device Authorization only from VS Code's canonical metadata URL;
- removes JWT Bearer only from Claude's canonical metadata URL; and
- leaves every other CIMD document unchanged for normal provider validation.

The implementation does not currently add its own response-size ceiling or
independent request deadline around this custom fetch. Those are production
hardening opportunities and must not be documented as already implemented.

VS Code serves its metadata with `Cache-Control: no-store`, so the CIMD plugin's
minimum refetch interval is set to zero. Its other concurrency and revalidation
controls remain enabled.

## Schema and result integration

SendLit's REST contract remains on Zod 3, while SDK 2 expects Standard Schema.
`mcp/schema.ts` is the single conversion boundary:

```text
Zod 3 schema
  -> zod-to-json-schema (JSON Schema draft-07 target)
  -> SDK 2 fromJsonSchema()
  -> StandardSchemaWithJSON
```

MCP tool schemas reuse shared `@sendlit/api-contract` schemas where practical,
including email content, contact filters, and custom fields. The MCP catalog
also contains MCP-specific output schemas in `mcp/tools/schemas.ts`; therefore
the current implementation should not be described as having no handwritten
MCP schemas.

Compiled schema adapters are cached once per process by the exhaustive tool
name. The actual server and request context remain per-request.

`jsonResult()` produces matching text and structured results. It recursively
converts JavaScript `Date` instances to ISO strings before assigning either
`content` or `structuredContent`. MCP timestamp output schemas advertise the
actual JSON wire type (`string`, optionally nullable) rather than accepting a
JavaScript-only `Date`. This prevents SDK/client structured-output validation
errors after otherwise successful mutations.

Tool handlers also pass returned rows through public-shape helpers such as
`omitInternal()` or domain-specific serializers so internal surrogate IDs and
stored secrets are not exposed.

## Compatibility and integration inventory

The implementation is not literally “only import `@modelcontextprotocol`,” but
there is no home-grown MCP protocol compatibility layer.

| Component                     | Implementation                             | Purpose                                                                     |
| ----------------------------- | ------------------------------------------ | --------------------------------------------------------------------------- |
| Modern `2026-07-28` serving   | `@modelcontextprotocol/server`             | Official per-request modern protocol implementation                         |
| 2025-era support              | SDK option `legacy: "stateless"`           | Official stateless fallback; no custom protocol translation                 |
| Node/Express bridge           | `@modelcontextprotocol/node`               | Official adapter from web-standard handler to Node request/response         |
| Tool registration wrapper     | SendLit `mcp/tool-registry.ts`             | Scope enforcement, logging, and schema reuse                                |
| Zod 3 bridge                  | SendLit `mcp/schema.ts`                    | Converts existing schemas to SDK 2 Standard Schema                          |
| OAuth discovery               | `@codelitdev/oauth-server-kit/mcp`         | Publishes MCP/OAuth discovery routes                                        |
| OAuth server                  | Better Auth OAuth provider and CIMD plugin | Authorization, PKCE, consent, tokens, CIMD, and DCR                         |
| Client metadata normalization | SendLit `auth/cimd-fetch.ts`               | Node 24 fetch correction and narrowly scoped VS Code/Claude grant filtering |
| JSON result normalization     | SendLit `mcp/tools/responses.ts`           | Keeps text and structured content JSON-equivalent                           |

The following compatibility mechanisms are not present:

- SDK v1 alongside SDK v2;
- a separate hand-written 2025 MCP server;
- a protocol-envelope translator;
- a legacy MCP session database or in-memory session map;
- sticky-session routing;
- `Mcp-Session-Id` generation; or
- a standalone legacy SSE route.

## Tool catalog and observability

The request-local server registers 68 tools in a deterministic order across:

1. contacts and segments;
2. templates and media;
3. sequences and broadcasts;
4. transactional email;
5. general settings and ESP configuration;
6. teams and API keys; and
7. delivery feedback, delivery events, and suppressions.

Every registration includes an output schema and policy. Tool annotations
describe read-only, destructive, idempotent, and open-world behavior where
applicable.

Request completion logs include method, tool name, status, duration, and auth
kind. Tool execution logs include tool name, required scope, scope decision,
outcome, duration, and auth kind. Arguments, credentials, message bodies, and
results are deliberately not logged by these MCP logging paths.

There are not yet dedicated MCP metrics or alert definitions. Existing log and
application observability infrastructure can consume these records, but the
original plan's proposed dashboards and alerts should not be treated as
implemented.

## Actual code map

| File/area                                   | Current responsibility                                                           |
| ------------------------------------------- | -------------------------------------------------------------------------------- |
| `apps/api/src/index.ts`                     | Mounts MCP before global Express body parsing                                    |
| `apps/api/src/mcp/routes.ts`                | Discovery routes, CORS, rate limit, auth pipeline, SDK 2 handler, and POST route |
| `apps/api/src/mcp/server.ts`                | Pure request-local server factory and deterministic domain registration          |
| `apps/api/src/mcp/auth-context.ts`          | Converts verified Express auth fields into typed MCP `AuthInfo`                  |
| `apps/api/src/mcp/policy.ts`                | Scope constants and exhaustive tool-to-scope policy                              |
| `apps/api/src/mcp/schema.ts`                | Zod 3 to JSON Schema to SDK Standard Schema adapter                              |
| `apps/api/src/mcp/tool-registry.ts`         | Schema cache, policy enforcement, registration wrapper, and safe logs            |
| `apps/api/src/mcp/tools/schemas.ts`         | MCP-specific output schemas                                                      |
| `apps/api/src/mcp/tools/responses.ts`       | Shared error, text, structured-content, and date serialization helpers           |
| `apps/api/src/mcp/tools/*.ts`               | Thin domain adapters over existing SendLit queries and services                  |
| `apps/api/src/auth/middleware.ts`           | Restricts MCP credentials and exposes verified request auth fields               |
| `apps/api/src/auth/resolve-auth.ts`         | Validates OAuth, API keys, and browser sessions before mode-specific filtering   |
| `apps/api/src/auth/better-auth.ts`          | OAuth provider, resource registration, team-selection hooks, CIMD, and DCR       |
| `apps/api/src/auth/cimd-fetch.ts`           | Secure pinned CIMD fetching and narrow client metadata normalization             |
| `apps/api/src/mcp/*.test.ts`                | Modern/legacy protocol, route, schema, auth-context, and catalog coverage        |
| `apps/api/src/mcp/tools/*.test.ts`          | Tool policy, tenant, serialization, and domain-adapter coverage                  |
| `apps/api/src/auth/*mcp*.test.ts`           | OAuth discovery/metadata and MCP auth coverage                                   |
| `apps/docs/content/docs/developers/mcp.mdx` | Public connection, auth, scope, and transport documentation                      |

## Dependencies actually in use

The installed API dependency set resolves to:

- `@modelcontextprotocol/server@2.0.0`;
- `@modelcontextprotocol/node@2.0.0`;
- `@modelcontextprotocol/client@2.0.0` as a development/test dependency;
- `zod@3.25.76`;
- `zod-to-json-schema@3.25.2`;
- `better-auth@1.7.0-rc.4`;
- `@better-auth/oauth-provider@1.7.0-rc.4`;
- `@better-auth/cimd@1.7.0-rc.4`; and
- `@codelitdev/oauth-server-kit@0.1.0-alpha.0`.

`apps/api/package.json` permits compatible SDK 2 patch/minor updates with
`^2.0.0`; the lockfile currently resolves the MCP packages to `2.0.0`. The
Better Auth packages are pinned to the same exact release candidate.

The API has no direct dependency on the v1 `@modelcontextprotocol/sdk` package.
A transitive dependency may still install SDK v1 for another library; it is not
used by SendLit's MCP server implementation.

## Verification currently present

### Protocol and HTTP

- an SDK 2 client pinned to `2026-07-28` connects and reports the modern era;
- `server/discover`, deterministic `tools/list`, cache hints, and catalog
  refresh are exercised;
- protocol envelope/header mismatches are rejected;
- a raw `2025-11-25` initialize POST succeeds without an
  `Mcp-Session-Id` response;
- `GET /mcp` returns 404, proving the retired standalone SSE route is absent;
- non-JSON content receives the SDK's 415 response; and
- browser preflight includes the modern protocol headers but excludes
  `Mcp-Session-Id`.

### Authentication and authorization

- OAuth client identity and tenant identity remain separate;
- API-key secrets do not enter `AuthInfo`;
- browser sessions are rejected by MCP mode;
- the catalog exactly matches the default-deny policy registry;
- OAuth scopes allow and deny representative tools;
- fixed-team API keys receive the documented full-team behavior;
- authorization metadata advertises issuer protection, CIMD, DCR, and the MCP
  scope set; and
- CIMD tests cover Node 24 address pinning, private/reserved address rejection,
  exact VS Code/Claude normalization, and no relaxation for other clients.

### Schemas and tools

- all 68 tools appear once with descriptions, schemas, and annotations;
- representative tools are checked for auth, tenant isolation, and domain-call
  behavior;
- date-valued database results are serialized consistently in text and
  `structuredContent`; and
- a `create_contact` result containing database `Date` values validates against
  its advertised MCP output schema.

The latest focused verification run completed successfully with:

```text
pnpm --filter @sendlit/api exec vitest run src/mcp
# 5 files, 49 tests passed

pnpm --filter @sendlit/api typecheck
# passed
```

This focused run does not replace the full API test suite, build, REST/OpenAPI
validation, or production load/security testing.

## Manual smoke-test procedure

With Postgres, Redis, and Mailpit running:

1. start the API with `pnpm dev:api`;
2. expose port 5000 through an HTTPS endpoint when the client requires HTTPS;
3. connect a modern SDK 2 client and confirm discovery, tool listing, and a safe
   tool invocation;
4. connect VS Code or another 2025-era Streamable HTTP client and confirm the
   same catalog and behavior;
5. test OAuth/CIMD and `x-sendlit-apikey` separately;
6. exercise safe contact/template/sequence reads and writes in a disposable
   team;
7. route any send/test operation to Mailpit and a disposable recipient;
8. verify an insufficient-scope call and a cross-team access attempt; and
9. request `GET /mcp` and confirm the retired standalone SSE route is absent.

Clients may cache tool schemas. Reconnect after changing advertised schemas or
the tool catalog.

## Known limitations and production follow-up

- Better Auth is still on `1.7.0-rc.4` and the OAuth server kit is on
  `0.1.0-alpha.0`; both need an explicit production-readiness review.
- Public DCR intentionally expands the OAuth attack surface for Inspector and
  other existing clients. PKCE, consent, resource binding, and scope checks
  still apply, but DCR should be removed when supported clients no longer need
  it.
- The custom CIMD fetcher needs an explicit response-size limit and independent
  deadline before production.
- The two client-specific grant filters should be re-evaluated after Better
  Auth or the clients change their metadata validation behavior.
- Team API keys are full-team credentials; independently scoped keys remain a
  separate product feature.
- Fresh server construction registers 68 tools per request. Schema compilation
  is cached, but construction and catalog performance have not been documented
  with a load benchmark.
- MCP-specific logs exist, but dedicated metrics, dashboards, and alert rules
  do not.
- MRTR approval/input flows are not implemented. High-impact operations rely on
  scopes, annotations, descriptions, client behavior, and rate limiting.

## Completion statement

The migration itself is implemented:

- SDK 2 is the direct MCP server implementation;
- modern requests use the stateless `2026-07-28` protocol;
- current 2025 Streamable HTTP clients use SDK 2's stateless legacy mode;
- both eras share one endpoint, server factory, tool catalog, auth context, and
  policy registry;
- no retired standalone SSE or MCP session implementation remains;
- OAuth supports CIMD and compatibility DCR;
- all 68 tools are registered and policy-bound; and
- structured tool results are normalized to their advertised JSON schemas.

The remaining items above are production-hardening work, not blockers to the
current development implementation.
