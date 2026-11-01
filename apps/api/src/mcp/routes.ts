import { createMcpOAuthDiscoveryRoutes } from "@codelitdev/oauth-server-kit/mcp";
import { createPlatformError, toPublicHttpError } from "@codelitdev/platform";
import express, {
  type NextFunction,
  type Request,
  type Response,
  Router,
} from "express";
import rateLimit from "express-rate-limit";
import { CLIENT_IP_HEADER } from "../abuse/signup";
import {
  auth,
  mcpProtectedResourceMetadataUrl,
  mcpResourceUrl,
  oauthResourceClient,
} from "../auth/better-auth";
import logger from "../services/log";
import type { ApiToolDeps } from "./api-tools";
import { runMcpRequest } from "./context";
import { MCP_SCOPES_SUPPORTED } from "./policy";
import { createSendLitMcp } from "./server";

/** SendLit's own headers, allowed on top of the kit's CORS list. */
const SENDLIT_CORS_HEADERS = "x-sendlit-apikey, X-Sendlit-Team-Id";

const highImpactTools = new Set([
  "send_email",
  "send_sequence_email_test",
  "track_event",
  "start_sequence",
  "api.write",
  "api.delete",
]);

const mcpLimiter = rateLimit({
  windowMs: 60_000,
  skip: (req) => req.method === "OPTIONS",
  max: (req) => (highImpactTools.has(String(req.headers["mcp-name"] || "")) ? 20 : 60),
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: "too_many_requests",
    error_description: "Too many MCP requests.",
  },
  handler(req, res, _next, options) {
    logger.warn(
      { method: req.headers["mcp-method"], tool: req.headers["mcp-name"] },
      "MCP rate limit exceeded",
    );
    res.status(options.statusCode).json(options.message);
  },
});

/** The kit owns protocol parsing errors as JSON-RPC, not Express HTML. */
const jsonBody = (req: Request, res: Response, next: NextFunction) => {
  if (req.method !== "POST") return next();
  if (!req.is("application/json")) {
    res.status(415).json({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Content-Type must be application/json" },
      id: null,
    });
    return;
  }
  express.json({ limit: "4mb" })(req, res, (error?: unknown) => {
    if (error) {
      res.status(400).json({
        jsonrpc: "2.0",
        error: { code: -32700, message: "Parse error" },
        id: null,
      });
      return;
    }
    next();
  });
};

export function createMcpRoutes(deps: ApiToolDeps): Router {
  const router = Router();
  const mcp = createSendLitMcp(deps);

  router.use(
    createMcpOAuthDiscoveryRoutes({
      auth,
      resourceUrl: mcpResourceUrl,
      oauthResourceClient,
      scopesSupported: [...MCP_SCOPES_SUPPORTED],
      allowedOrigins: "*",
    }),
  );

  router.all(
    "/mcp",
    mcpLimiter,
    jsonBody,
    async (req: Request, res: Response, next) => {
      const startedAt = performance.now();
      try {
        const headers: Record<string, string | string[] | undefined> = {
          ...req.headers,
        };
        // Existing SendLit clients send their team key as `x-sendlit-apikey`;
        // the kit reads `X-API-Key`. Both at once stay ambiguous.
        const sendlitKey = headers["x-sendlit-apikey"];
        delete headers["x-sendlit-apikey"];
        if (sendlitKey && headers["x-api-key"]) {
          const ambiguous = toPublicHttpError(
            createPlatformError("credential_ambiguous"),
          );
          res.status(ambiguous.status).json(ambiguous.body);
          return;
        }
        if (sendlitKey) headers["x-api-key"] = sendlitKey;
        headers[CLIENT_IP_HEADER] = req.ip ?? "";
        headers["x-request-id"] = String(res.locals.requestId ?? "");

        const controller = new AbortController();
        res.once("close", () => {
          if (!res.writableFinished) controller.abort();
        });
        const result = await runMcpRequest(() =>
          mcp.handle({
            method: req.method,
            headers,
            body: req.body,
            signal: controller.signal,
          }),
        );

        for (const [name, value] of Object.entries(result.headers))
          res.setHeader(name, value);
        const allowed = res.getHeader("Access-Control-Allow-Headers");
        if (allowed) {
          res.setHeader(
            "Access-Control-Allow-Headers",
            `${allowed}, ${SENDLIT_CORS_HEADERS}`,
          );
        }
        if (result.status === 401) {
          // Spec-compliant MCP clients discover OAuth from this challenge.
          res.setHeader(
            "WWW-Authenticate",
            `Bearer resource_metadata="${mcpProtectedResourceMetadataUrl}"`,
          );
        }
        res.status(result.status);
        if (result.body === null) res.end();
        else res.json(result.body);

        // Arguments, credentials, message content and results stay out of logs.
        logger.info(
          {
            method: req.headers["mcp-method"],
            tool: req.headers["mcp-name"],
            statusCode: result.status,
            durationMs: Math.round(performance.now() - startedAt),
          },
          "MCP request completed",
        );
      } catch (error) {
        next(error);
      }
    },
  );

  return router;
}
