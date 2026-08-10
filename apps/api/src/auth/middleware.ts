import type { NextFunction, Request, Response } from "express";
import {
    type AuthInput,
    type AuthResult,
    resolveAuth,
    sendAuthError,
} from "./resolve-auth";
import { mcpProtectedResourceMetadataUrl } from "./better-auth";

type AuthResolver = (input: AuthInput) => Promise<AuthResult>;

type AuthMiddlewareMode = "rest" | "mcp";

function applyAuthToRequest(
    req: any,
    auth: AuthResult,
    mode: AuthMiddlewareMode,
) {
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

            applyAuthToRequest(req, auth, mode);
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
