import { createMcpServerKit, type McpServerKit } from "@codelitdev/mcp-server-kit";
import { captureError } from "../observability";
import { type ApiToolDeps, apiTools } from "./api-tools";
import {
  authenticateMcpRequest,
  resolveMcpContext,
  type SendLitMcpContext,
  type SendLitMcpTool,
} from "./context";
import { contactTools } from "./tools/contacts";
import { deliveryEventTools } from "./tools/delivery-feedback";
import { eventTools } from "./tools/events";
import { segmentTools } from "./tools/segments";
import { sequenceTools } from "./tools/sequences";
import { teamTools } from "./tools/teams";
import { templateTools } from "./tools/templates";
import { transactionalTools } from "./tools/transactional";

export const SENDLIT_MCP_VERSION = "3.0.0";

/** Dedicated tools for the common flows, in a stable order so catalog caches
 * and upstream prompt caches see a deterministic tool list. */
export function dedicatedTools(): SendLitMcpTool[] {
  return [
    ...contactTools(),
    ...segmentTools(),
    ...templateTools(),
    ...sequenceTools(),
    ...transactionalTools(),
    ...eventTools(),
    ...deliveryEventTools(),
    ...teamTools(),
  ];
}

/**
 * SendLit's MCP endpoint on the CodeLit Platform kit (ADR 0010): stateless,
 * protocol 2026-07-28 plus 2025-era Streamable HTTP, with SendLit's own
 * credential and team resolution. Dedicated tools cover the everyday flows;
 * the generic api.* tools reach every other team REST operation.
 */
export function createSendLitMcp(deps: ApiToolDeps): McpServerKit<SendLitMcpContext> {
  return createMcpServerKit<SendLitMcpContext>({
    name: "SendLit",
    version: SENDLIT_MCP_VERSION,
    description:
      "SendLit MCP server: compose, send and automate email for a SendLit team. Dedicated tools manage contacts, segments, templates, broadcasts and sequences, transactional email, events and delivery events. Everything else the team REST API offers (sending providers, settings, reputation, signup forms, media, tags, suppressions, teams, API keys and deletes) is reachable through the api.* tools.",
    instructions:
      "Every call acts on the connected team. Use the dedicated tools for contacts, segments, templates, sequences and broadcasts, sending email and tracking events. For anything else, find the operation with api.list_operations, read its parameters and body with api.describe_operation, then run it with api.read, api.write or api.delete. Read before you write. Sending, activation, deletion, key management and suppression changes have external or destructive effects: confirm the target and inputs with the user first, and pass confirm: true to api.delete. MCP is team-scoped: organization administration, shared-delivery setup, team provisioning and billing use the REST API (see /openapi.json), not MCP.",
    authenticate: authenticateMcpRequest,
    resolveContext: resolveMcpContext,
    onError: ({ error, source }) => captureError({ error, source }),
    tools: [...dedicatedTools(), ...apiTools(deps)],
  });
}
