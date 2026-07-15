import crypto from "crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { registerContactTools } from "./tools/contacts";
import { registerSegmentTools } from "./tools/segments";
import { registerTemplateTools } from "./tools/templates";
import { registerSequenceTools } from "./tools/sequences";
import { registerTransactionalTools } from "./tools/transactional";
import { registerEspTools } from "./tools/esp";
import { registerGeneralSettingsTools } from "./tools/general-settings";
import { registerTeamTools } from "./tools/teams";
import { registerMediaTools } from "./tools/media";

function registerAllTools(server: McpServer): void {
    registerContactTools(server);
    registerSegmentTools(server);
    registerTemplateTools(server);
    registerSequenceTools(server);
    registerTransactionalTools(server);
    registerEspTools(server);
    registerGeneralSettingsTools(server);
    registerTeamTools(server);
    registerMediaTools(server);
}

/**
 * Create a new MCP session (transport + server pair). Each connecting client
 * must get its own session — the StreamableHTTPServerTransport is
 * single-session by design. Ported from `medialit/apps/api/src/mcp/server.ts`.
 */
export function createMCPSession(
    onsessioninitialized: (sessionId: string) => void,
    onsessionclosed: (sessionId: string) => void,
): StreamableHTTPServerTransport {
    const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => crypto.randomUUID(),
        enableJsonResponse: true,
        onsessioninitialized,
        onsessionclosed,
    });
    const server = new McpServer({
        name: "SendLit",
        version: "1.0.0",
        description:
            "SendLit MCP server — compose, send and automate email for a SendLit account. Supports managing contacts and segmentation, reusable email templates, broadcasts/sequences (create, edit, start/pause, and inspect delivery stats), transactional emails (single API-triggered sends with delivery status polling), and the account's ESP (SMTP) sending configuration.",
    });
    registerAllTools(server);
    server.connect(transport);
    return transport;
}
