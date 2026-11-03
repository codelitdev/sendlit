import type { NextFunction, Request, Response } from "express";
import { mcpProtectedResourceMetadataUrl, mcpResourceUrl } from "./better-auth";
import { dashboardSessionBoundary } from "./csrf";
import {
  type AuthInput,
  type AuthResult,
  resolveAuth,
  sendAuthError,
} from "./resolve-auth";

type AuthResolver = (input: AuthInput) => Promise<AuthResult>;

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

type AuthMiddlewareMode = "rest" | "mcp";

function applyAuthToRequest(req: any, auth: AuthResult, mode: AuthMiddlewareMode) {
  if (auth.status !== "authenticated") return;

  req.authKind = auth.kind;
  req.user = auth.user;

  if (auth.kind === "team_key") {
    req.apiKeyId = auth.apiKeyId;
    // A key authenticates as exactly one, fixed team — no further
    // resolution needed (see `require-team.ts`).
    req.teamId = auth.teamId;
  } else if (auth.kind === "organization_key") {
    req.organizationId = auth.organizationId;
    req.organizationApiKeyId = auth.organizationApiKeyId;
    req.organizationScopes = auth.organizationScopes;
  } else {
    req.userId = auth.userId;
    // A multi-team user's OAuth token may already carry a verified
    // team (picked on `/oauth/select-team` — see `resolve-auth.ts`).
    // Leaving it unset here falls through to `require-team.ts`'s header
    // / sole-team resolution, same as before this existed.
    if (auth.kind === "oauth" && auth.teamId) {
      req.teamId = auth.teamId;
    }
  }

  if (mode === "mcp" && auth.kind === "oauth") {
    req.oauthToken = auth.token;
    req.clientId = auth.clientId;
    req.scopes = auth.scopes;
  }
}

export function createAuthMiddleware(
  mode: AuthMiddlewareMode,
  authResolver: AuthResolver = resolveAuth,
  resourceMetadataUrl?: string,
) {
  return async function authMiddleware(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const auth = await authResolver({
        authorization: req.headers.authorization,
        apiKeyHeader: req.headers["x-sendlit-apikey"],
        bodyApiKey: req.body?.apikey,
        headers: req.headers,
        transport: mode === "mcp" ? "mcp" : "http",
      });

      if (sendAuthError(res, auth, resourceMetadataUrl)) return;
      if (auth.status !== "authenticated") return;

      // Remote MCP authentication is intentionally limited to OAuth
      // bearer tokens and fixed-team API keys. Dashboard cookies are a
      // first-party web concern and must not silently authenticate MCP.
      if (mode === "mcp" && auth.kind === "session") {
        if (resourceMetadataUrl) {
          res.setHeader(
            "WWW-Authenticate",
            `Bearer resource_metadata="${resourceMetadataUrl}"`,
          );
        }
        res.status(401).json({
          error: "unauthorized",
          error_description:
            "MCP requires an OAuth bearer token or x-sendlit-apikey header.",
        });
        return;
      }

      // OAuth tokens are issued for the MCP resource only. REST has no scope
      // map, so honouring one there would turn a narrowly scoped MCP grant
      // into the user's full authority (including minting team API keys).
      if (
        mode === "rest" &&
        auth.kind === "oauth" &&
        !auth.identity.audiences?.some((audience) => audience !== mcpResourceUrl)
      ) {
        res.status(401).json({
          error: "invalid_token",
          error_description: "This token is only valid for the MCP resource.",
        });
        return;
      }

      applyAuthToRequest(req, auth, mode);

      // A session cookie is sent by the browser on any request to this origin,
      // including a form on a tenant-published page. State changes therefore
      // need the dashboard's Origin plus double-submit CSRF token.
      if (mode === "rest" && auth.kind === "session" && !SAFE_METHODS.has(req.method)) {
        const failure = dashboardSessionBoundary(req, res);
        if (failure) {
          res.status(failure.status).json(failure.body);
          return;
        }
      }
      if (auth.kind === "oauth" || auth.kind === "session") {
        req.auth = auth.identity;
      }
      next();
    } catch (error) {
      next(error);
    }
  };
}

export const requireAuth = createAuthMiddleware("rest");
// `/mcp` is the only OAuth-protected resource this API exposes today, so its
// metadata URL is threaded through unconditionally — see
// `mcpProtectedResourceMetadataUrl` in `./better-auth.ts` for why this is
// required for spec-compliant MCP/OAuth clients to work at all.
export const mcpAuth = createAuthMiddleware(
  "mcp",
  resolveAuth,
  mcpProtectedResourceMetadataUrl,
);
