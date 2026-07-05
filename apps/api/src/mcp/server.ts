import crypto from "crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { registerContactTools } from "./tools/contacts";
import { registerTemplateTools } from "./tools/templates";
import { registerSequenceTools } from "./tools/sequences";
import { registerEspTools } from "./tools/esp";
import { registerTeamTools } from "./tools/teams";

function registerAllTools(server: McpServer): void {
    registerContactTools(server);
    registerTemplateTools(server);
    registerSequenceTools(server);
    registerEspTools(server);
    registerTeamTools(server);
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
            "SendLit MCP server — compose, send and automate email for a SendLit account. Supports managing contacts and segmentation, reusable email templates, broadcasts/sequences (create, edit, start/pause, and inspect delivery stats), and the account's ESP (SMTP) sending configuration.",
    });
    registerAllTools(server);
    server.connect(transport);
    return transport;
}
