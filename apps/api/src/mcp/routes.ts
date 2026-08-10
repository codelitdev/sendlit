import {
    Router,
    type NextFunction,
    type Request,
    type Response,
} from "express";
import rateLimit from "express-rate-limit";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { toNodeHandler } from "@modelcontextprotocol/node";
import { createMcpOAuthDiscoveryRoutes } from "@codelitdev/oauth-server-kit/mcp";
import { mcpAuth } from "../auth/middleware";
import { requireTeam } from "../auth/require-team";
import { auth, mcpResourceUrl, oauthResourceClient } from "../auth/better-auth";
import logger from "../services/log";
import { createSendLitMcpAuthInfo } from "./auth-context";
import { MCP_SCOPES_SUPPORTED } from "./policy";
import { buildMcpServer } from "./server";

const router = Router();

router.use(
    createMcpOAuthDiscoveryRoutes({
        auth,
        resourceUrl: mcpResourceUrl,
        oauthResourceClient,
        scopesSupported: [...MCP_SCOPES_SUPPORTED],
        allowedOrigins: "*",
    }),
);

const highImpactTools = new Set([
    "send_email",
    "send_test_email",
    "test_esp",
    "start_sequence",
    "create_api_key",
    "delete_api_key",
    "delete_team",
    "release_suppression",
]);

const mcpLimiter = rateLimit({
    windowMs: 60_000,
    max: (req) =>
        highImpactTools.has(String(req.headers["mcp-name"] || "")) ? 20 : 60,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
        error: "too_many_requests",
        error_description: "Too many MCP requests.",
    },
    handler(req, res, _next, options) {
        logger.warn(
            {
                method: req.headers["mcp-method"],
                tool: req.headers["mcp-name"],
                authKind: (req as any).authKind,
            },
            "MCP rate limit exceeded",
        );
        res.status(options.statusCode).json(options.message);
    },
});

function mcpCors(req: Request, res: Response, next: NextFunction) {
    const origin = req.headers.origin || "*";
    res.header("Access-Control-Allow-Origin", origin);
    res.header("Vary", "Origin");
    res.header("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.header(
        "Access-Control-Allow-Headers",
        "Content-Type, Accept, MCP-Protocol-Version, Mcp-Method, Mcp-Name, x-sendlit-apikey, Authorization",
    );
    if (req.method === "OPTIONS") {
        res.status(204).end();
        return;
    }
    next();
}

function attachMcpAuthInfo(req: Request, res: Response, next: NextFunction) {
    const authInfo = createSendLitMcpAuthInfo(req);
    if (!authInfo) {
        res.status(401).json({
            error: "unauthorized",
            error_description: "MCP authentication context is incomplete.",
        });
        return;
    }
    (req as any).auth = authInfo;
    next();
}

function observeMcpRequest(req: Request, res: Response, next: NextFunction) {
    const startedAt = performance.now();
    res.once("finish", () => {
        // Deliberately exclude arguments, credentials, message content, and
        // results. These low-cardinality fields are safe to aggregate into
        // latency/error dashboards at the logging layer.
        logger.info(
            {
                method: req.headers["mcp-method"],
                tool: req.headers["mcp-name"],
                statusCode: res.statusCode,
                durationMs: Math.round(performance.now() - startedAt),
                authKind: (req as any).authKind,
            },
            "MCP request completed",
        );
    });
    next();
}

export const mcpHandler = createMcpHandler(
    // One request-local server instance works for both supported eras. Modern
    // clients use stateless 2026 request envelopes; existing MCP clients such
    // as VS Code still begin with the 2025 `initialize` handshake.
    () => buildMcpServer(),
    {
        // Keep 2025 traffic stateless too: no session IDs or retained
        // transports are introduced, while clients that have not upgraded to
        // the 2026 wire revision can complete their Streamable HTTP handshake.
        legacy: "stateless",
        onerror(error) {
            logger.error({ errorType: error.name }, "MCP protocol error");
        },
    },
);

const nodeMcpHandler = toNodeHandler(mcpHandler, {
    onerror(error) {
        logger.error({ errorType: error.name }, "MCP Node adapter error");
    },
});

router.post(
    "/mcp",
    mcpCors,
    mcpLimiter,
    mcpAuth,
    requireTeam,
    attachMcpAuthInfo,
    observeMcpRequest,
    async (req: Request, res: Response, next: NextFunction) => {
        try {
            // This router is mounted before Express body parsing. The official
            // adapter owns JSON parsing/content-type validation so protocol
            // parse errors and 415 responses remain MCP-compliant.
            await nodeMcpHandler(req as any, res);
        } catch (error) {
            next(error);
        }
    },
);

router.options("/mcp", mcpCors);

export default router;
