import { Router } from "express";
import rateLimit from "express-rate-limit";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
    oauthProviderAuthServerMetadata,
    oauthProviderOpenIdConfigMetadata,
} from "@better-auth/oauth-provider";
import { mcpAuth } from "../auth/middleware";
import { requireTeam } from "../auth/require-team";
import { auth, oauthResourceClient } from "../auth/better-auth";
import { createMCPSession } from "./server";

const router = Router();

const mcpLimiter = rateLimit({
    windowMs: 60_000,
    max: 60,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
        error: "too_many_requests",
        error_description: "Too many requests.",
    },
});

const mcpSessions = new Map<string, StreamableHTTPServerTransport>();

const mcpCors = (req: any, res: any, next: any) => {
    const origin = req.headers.origin || "*";
    res.header("Access-Control-Allow-Origin", origin);
    res.header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
    res.header(
        "Access-Control-Allow-Headers",
        "Content-Type, Accept, Mcp-Session-Id, Mcp-Protocol-Version, x-sendlit-apikey, Authorization",
    );
    res.header("Access-Control-Expose-Headers", "Mcp-Session-Id");
    if (req.method === "OPTIONS") {
        return res.status(204).end();
    }
    next();
};

/** Some MCP clients omit `text/event-stream` or `application/json` from
 * `Accept`, which the SDK's transport requires. */
function patchMcpAcceptHeaders(req: any) {
    const accept = req.headers.accept || "";
    const needsJson = !accept.includes("application/json");
    const needsSSE = !accept.includes("text/event-stream");
    if (!needsJson && !needsSSE) return;

    const additions: string[] = [];
    if (needsJson) additions.push("application/json");
    if (needsSSE) additions.push("text/event-stream");
    const newAccept = accept
        ? `${accept}, ${additions.join(", ")}`
        : additions.join(", ");
    req.headers.accept = newAccept;

    const rawHeaders: string[] = req.rawHeaders;
    let found = false;
    for (let i = 0; i < rawHeaders.length; i += 2) {
        if (rawHeaders[i].toLowerCase() === "accept") {
            rawHeaders[i + 1] = newAccept;
            found = true;
            break;
        }
    }
    if (!found) rawHeaders.push("Accept", newAccept);
}

function getMcpAuth(req: any) {
    return {
        token: req.apikey || "",
        // "clientId" here is the resolved *team* id (see `auth/require-team.ts`) —
        // every MCP tool operates on team-scoped resources.
        clientId: String(req.teamId || ""),
        account: req.account,
        scopes: (req.scopes as string[] | undefined) || [],
    };
}

function sendFetchResponse(res: any, response: Response) {
    res.status(response.status);
    response.headers.forEach((value, key) => res.setHeader(key, value));
    return response.text().then((body) => res.send(body));
}

router.use(["/.well-known"], mcpCors);

router.get(
    "/.well-known/oauth-authorization-server",
    mcpCors,
    async (req, res) => {
        const response = await oauthProviderAuthServerMetadata(auth)(
            new Request(
                `${req.protocol}://${req.get("host")}${req.originalUrl}`,
                {
                    headers: req.headers as HeadersInit,
                },
            ),
        );
        await sendFetchResponse(res, response);
    },
);

router.get("/.well-known/openid-configuration", mcpCors, async (req, res) => {
    const response = await oauthProviderOpenIdConfigMetadata(auth)(
        new Request(`${req.protocol}://${req.get("host")}${req.originalUrl}`, {
            headers: req.headers as HeadersInit,
        }),
    );
    await sendFetchResponse(res, response);
});

router.get(
    "/.well-known/oauth-protected-resource",
    mcpCors,
    async (_req, res) => {
        const metadata = await oauthResourceClient
            .getActions()
            .getProtectedResourceMetadata(
                {
                    resource: `${
                        process.env.API_PUBLIC_URL ||
                        process.env.BETTER_AUTH_URL ||
                        "http://localhost:4000"
                    }/mcp`,
                    scopes_supported: [
                        "contacts:read",
                        "contacts:write",
                        "templates:read",
                        "templates:write",
                        "broadcasts:write",
                        "sequences:read",
                        "sequences:write",
                    ],
                    bearer_methods_supported: ["header"],
                },
                { silenceWarnings: { oidcScopes: true } },
            );
        res.json(metadata);
    },
);

router.post(
    "/mcp",
    mcpCors,
    mcpLimiter,
    mcpAuth,
    requireTeam,
    async (req: any, res: any) => {
        patchMcpAcceptHeaders(req);

        const auth = getMcpAuth(req);
        const sessionId = req.headers["mcp-session-id"] as string | undefined;

        if (sessionId) {
            const transport = mcpSessions.get(sessionId);
            if (!transport) {
                return res.status(404).json({
                    jsonrpc: "2.0",
                    error: { code: -32001, message: "Session not found" },
                    id: null,
                });
            }
            await transport.handleRequest(
                Object.assign(req, { auth }),
                res,
                req.body,
            );
        } else {
            const transport = createMCPSession(
                (id) => mcpSessions.set(id, transport),
                (id) => mcpSessions.delete(id),
            );
            await transport.handleRequest(
                Object.assign(req, { auth }),
                res,
                req.body,
            );
        }
    },
);

router.options("/mcp", mcpCors);

export default router;
