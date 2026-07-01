import { NextFunction, Response } from "express";
import { AuthResult, resolveAuth, sendAuthError } from "./resolve-auth";

type AuthResolver = (input: {
  authorization?: unknown;
  apiKeyHeader?: unknown;
  bodyApiKey?: unknown;
}) => Promise<AuthResult>;

type AuthMiddlewareMode = "rest" | "mcp";

function applyAuthToRequest(
  req: any,
  auth: AuthResult,
  mode: AuthMiddlewareMode,
) {
  if (auth.status !== "authenticated") return;

  req.authKind = auth.kind;
  req.account = auth.account;

  if (auth.kind === "apikey") {
    req.apikey = auth.apiKey;
    // A key authenticates as exactly one, fixed team — no further
    // resolution needed (see `require-team.ts`).
    req.teamId = auth.teamId;
  } else {
    req.accountId = auth.accountId;
  }

  if (mode === "mcp" && auth.kind === "oauth") {
    req.clientId = auth.clientId;
    req.scopes = auth.scopes;
  }
}

export function createAuthMiddleware(
  mode: AuthMiddlewareMode,
  authResolver: AuthResolver = resolveAuth,
) {
  return async function authMiddleware(
    req: any,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    const auth = await authResolver({
      authorization: req.headers.authorization,
      apiKeyHeader: req.headers["x-sendlit-apikey"],
      bodyApiKey: req.body?.apikey,
    });

    if (sendAuthError(res, auth)) return;
    if (auth.status !== "authenticated") return;

    applyAuthToRequest(req, auth, mode);
    next();
  };
}

export const requireAuth = createAuthMiddleware("rest");
export const mcpAuth = createAuthMiddleware("mcp");
