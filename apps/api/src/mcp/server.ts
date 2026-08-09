import { McpServer } from "@modelcontextprotocol/server";
import { registerContactTools } from "./tools/contacts";
import { registerSegmentTools } from "./tools/segments";
import { registerTemplateTools } from "./tools/templates";
import { registerSequenceTools } from "./tools/sequences";
import { registerTransactionalTools } from "./tools/transactional";
import { registerEspTools } from "./tools/esp";
import { registerGeneralSettingsTools } from "./tools/general-settings";
import { registerTeamTools } from "./tools/teams";
import { registerMediaTools } from "./tools/media";
import { registerDeliveryFeedbackTools } from "./tools/delivery-feedback";
import { createMcpToolRegistrar } from "./tool-registry";

export const SENDLIT_MCP_VERSION = "2.0.0";

/**
 * Build one request-local MCP server for both the existing 2025 and modern
 * 2026 protocol eras. This factory is deliberately pure: tenant/principal
 * state arrives through the SDK request context and all durable state lives in
 * SendLit's existing database/queue services.
 */
export function buildMcpServer(): McpServer {
    const server = new McpServer(
        {
            name: "SendLit",
            version: SENDLIT_MCP_VERSION,
            description:
                "SendLit MCP server — compose, send and automate email for a SendLit team. Manage contacts and segments, templates and media, broadcasts and sequences, transactional email, sending providers, settings, API keys, and delivery feedback.",
        },
        {
            instructions:
                "Use read tools to inspect existing state before mutations. Sending, activation, deletion, key management, and suppression-release tools have external or destructive effects; confirm the requested target and inputs before calling them.",
            cacheHints: {
                "server/discover": {
                    ttlMs: 300_000,
                    cacheScope: "private",
                },
                "tools/list": {
                    ttlMs: 300_000,
                    cacheScope: "private",
                },
            },
        },
    );
    const tools = createMcpToolRegistrar(server);

    // Registration order is stable so catalog caching and upstream prompt
    // caches receive deterministic tool lists.
    registerContactTools(tools);
    registerSegmentTools(tools);
    registerTemplateTools(tools);
    registerMediaTools(tools);
    registerSequenceTools(tools);
    registerTransactionalTools(tools);
    registerGeneralSettingsTools(tools);
    registerEspTools(tools);
    registerTeamTools(tools);
    registerDeliveryFeedbackTools(tools);

    return server;
}
