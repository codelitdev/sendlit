import { createMcpServerKit, type McpServerKit } from "@codelitdev/mcp-server-kit";
import { captureError } from "../observability";
import {
  authenticateMcpRequest,
  resolveMcpContext,
  type SendLitMcpContext,
  type SendLitMcpTool,
} from "./context";
import { contactTools } from "./tools/contacts";
import { deliveryFeedbackTools } from "./tools/delivery-feedback";
import { espTools } from "./tools/esp";
import { eventTools } from "./tools/events";
import { formTools } from "./tools/forms";
import { generalSettingsTools } from "./tools/general-settings";
import { mediaTools } from "./tools/media";
import { reputationTools } from "./tools/reputation";
import { segmentTools } from "./tools/segments";
import { sequenceTools } from "./tools/sequences";
import { tagTools } from "./tools/tags";
import { teamTools } from "./tools/teams";
import { templateTools } from "./tools/templates";
import { trackingDomainTools } from "./tools/tracking-domain";
import { transactionalTools } from "./tools/transactional";
import { webTools } from "./tools/web";

export const SENDLIT_MCP_VERSION = "3.0.0";

/** Every SendLit MCP tool, one per operation, in a stable order so catalog
 * caches and upstream prompt caches see a deterministic tool list. */
export function sendLitMcpTools(): SendLitMcpTool[] {
  return [
    ...contactTools(),
    ...segmentTools(),
    ...tagTools(),
    ...formTools(),
    ...webTools(),
    ...reputationTools(),
    ...templateTools(),
    ...mediaTools(),
    ...sequenceTools(),
    ...transactionalTools(),
    ...eventTools(),
    ...generalSettingsTools(),
    ...trackingDomainTools(),
    ...espTools(),
    ...teamTools(),
    ...deliveryFeedbackTools(),
  ];
}

/**
 * SendLit's MCP endpoint on the CodeLit Platform kit (ADR 0010): stateless,
 * protocol 2026-07-28 plus 2025-era Streamable HTTP, with SendLit's own
 * credential and team resolution and one dedicated tool per operation.
 */
export function createSendLitMcp(): McpServerKit<SendLitMcpContext> {
  return createMcpServerKit<SendLitMcpContext>({
    name: "SendLit",
    version: SENDLIT_MCP_VERSION,
    description:
      "SendLit MCP server — compose, send and automate email for a SendLit team. Manage contacts and segments, templates and media, broadcasts and sequences, transactional email, sending providers, settings, team API keys, and delivery feedback. Organization bootstrap, shared-delivery policy, and team provisioning use the REST API, not MCP.",
    instructions:
      "Use read tools to inspect existing state before mutations. Sending, activation, deletion, key management, and suppression-release tools have external or destructive effects; confirm the requested target and inputs with the user before calling them, and pass confirm: true to destructive tools. MCP is team-scoped and does not accept organization API keys. Use the REST API and /openapi.json for organization discovery, headless shared-delivery setup, and team provisioning.",
    authenticate: authenticateMcpRequest,
    resolveContext: resolveMcpContext,
    onError: ({ error, source }) => captureError({ error, source }),
    tools: sendLitMcpTools(),
  });
}
