# ADR 0010: MCP on the Platform kit, one tool per operation

Status: accepted
Date: 2026-11-01

## Context

SendLit served MCP with its own server on the MCP SDK 2. Each REST operation
reachable over MCP had a dedicated tool (115 tools), with SendLit's own
registration, scope checks, error results and transport wiring.

`@codelitdev/mcp-server-kit` (ADR 0001) now serves MCP 2026-07-28 and 2025-era
Streamable HTTP statelessly, with platform tool errors, risk annotations, tool
titles and output schemas, and `confirm: true` for destructive tools. CourseLit
runs on it with a few dedicated tools and generic `api.*` tools that run any
other REST operation after discovering it.

We tried CourseLit's generic tools for SendLit (`api.list_operations`,
`api.describe_operation`, `api.read`, `api.write`, `api.delete`) and dropped
them before release. The ChatGPT Plugins Directory requires each
model-callable operation to be its own tool and rejects "discovery, operation
selection, or schema fetching with a generic executor"
([plugin guidelines](https://developers.openai.com/apps-sdk/app-submission-guidelines)).
The Claude Connectors Directory accepts split read and write executors, but
SendLit wants to be listed in both
([pre-submission checklist](https://claude.com/docs/connectors/building/review-criteria)).

## Decision

- `/mcp` runs on `createMcpServerKit`. SendLit keeps its own credential and
  team resolution (`resolveAuth`, and `resolveUserTeam`, now shared with
  REST's `requireTeam`), the OAuth discovery routes, the `WWW-Authenticate`
  challenge on 401, per-tool rate limits and request logs.
  `x-sendlit-apikey` keeps working beside the kit's `X-API-Key`.
- Every MCP-reachable REST operation keeps its own tool, with the same names
  and schemas as before. `dedicatedTool()` (`apps/api/src/mcp/tool.ts`) builds
  each one from its REST operation id.
- Authorization is per operation: `apps/api/src/mcp/policy.ts` maps each
  MCP-reachable operation to its OAuth scope, and a tool is authorized through
  its operation. Team API keys still can't manage API keys.
- What both directories review is enforced in code and tests: every tool has a
  `title`, a name of at most 64 characters, an explicit `openWorldHint`, and
  `readOnlyHint`/`destructiveHint` from its risk. Destructive tools advertise
  `confirm`, which the kit requires.
- Tool failures are platform errors (`not_found`, `conflict`,
  `validation_failed`, `forbidden`, …). `details.reason` keeps SendLit's error
  code (`plan_limit_reached`, `template_not_transactional`, …), and
  `details.message` gives the explanation. Unexpected errors are reported and
  returned as `internal_error`, never with their raw message.

## Consequences

- Breaking for MCP clients, so the server version moves to 3.0.0. Tool names
  are unchanged, but destructive tools now need `confirm: true`, and error
  results have the platform shape instead of free text.
- A new REST operation reaches MCP through a new dedicated tool, a parity
  manifest entry and a scope in `policy.ts`. The parity and catalog tests fail
  until all three exist.
- The catalog stays large. Clients that defer or search large tool lists
  handle it; a smaller catalog would need the directories to accept generic
  executors.
