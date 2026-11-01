# ADR 0010: MCP on the Platform kit, with dedicated and generic tools

Status: accepted
Date: 2026-11-01

## Context

SendLit served MCP with its own server on the MCP SDK 2: one dedicated tool
per REST operation, 118 tools in all. A client loads every tool's name,
description and schemas into the model's context before the first call, so
the catalog was large and most of it was rarely used (ESP lifecycle,
reputation sources, tracking domain, web settings, API keys).

`@codelitdev/mcp-server-kit` (ADR 0001) now serves MCP 2026-07-28 and 2025-era
Streamable HTTP statelessly, with platform tool errors, risk annotations and
`confirm: true` for destructive tools. CourseLit runs on it with a few
dedicated tools for its main flows and generic `api.*` tools that run any
other REST operation through its REST dispatcher.

## Decision

- `/mcp` runs on `createMcpServerKit`. SendLit keeps its own credential and
  team resolution (`resolveAuth`, `resolveUserTeam`, shared with REST), the
  OAuth discovery routes, the `WWW-Authenticate` challenge on 401, per-tool
  rate limits and request logs. `x-sendlit-apikey` keeps working beside the
  kit's `X-API-Key`.
- 29 dedicated tools cover the everyday flows: contacts and their tags and
  imports, segments, templates, sequences and broadcasts (including test
  sends, start, pause and stats), transactional email, event tracking,
  delivery events and plan usage. Their names and schemas are unchanged.
- Every other team-scoped REST operation is reached through
  `api.list_operations`, `api.describe_operation`, `api.read`, `api.write` and
  `api.delete`, the names CourseLit uses. A call is injected in-process into
  SendLit's Express app with the caller's own credential, IP and request id,
  so validation, plan limits, errors and REST's own refusals are exactly the
  REST API's. Operation schemas come from `/openapi.json`.
- The parity manifest decides what MCP can reach: an operation maps either to
  its dedicated tool or to the `api.*` tool for its risk. REST-only
  operations (billing, account deletion, organization administration,
  provisioning) stay unreachable.
- Authorization is per operation: `apps/api/src/mcp/policy.ts` maps each
  MCP-reachable operation to its OAuth scope, and both dedicated and generic
  tools check it, so an operation needs the same scope however it is reached.
  Team API keys still can't manage API keys.
- Tool failures are platform errors (`not_found`, `conflict`,
  `validation_failed`, `forbidden`, …) whose `details.reason` keeps SendLit's
  error code (`plan_limit_reached`, `template_not_transactional`, …) and
  `details.message` the explanation.

## Consequences

- The catalog drops from 118 tools to 34. Prompts or agents that call a
  removed tool by name (for example `get_esp_config`, `delete_contact` or
  `retire_esp`) must switch to the `api.*` tools; deletes now need
  `confirm: true`. This is a breaking change for MCP clients, so the server
  version moves to 3.0.0.
- MCP-only aliases over the team's default ESP (`get_esp_config`,
  `update_esp_config`, `delete_esp_config`, `send_test_email`) are gone; the
  per-ESP operations cover them.
- A new REST operation is reachable over MCP as soon as the parity manifest
  routes it to an `api.*` tool and `policy.ts` gives it a scope; a dedicated
  tool is only worth adding for a common flow.
