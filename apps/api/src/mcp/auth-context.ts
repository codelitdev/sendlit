import type { AuthInfo, ServerContext } from "@modelcontextprotocol/server";
import type { User } from "../user/queries";

export type SendLitMcpAuthExtra = {
    authKind: "oauth" | "team_key";
    teamId: string;
    user: User | null;
};

export type SendLitMcpAuthInfo = AuthInfo & {
    extra: SendLitMcpAuthExtra;
};

type McpAuthRequest = {
    authKind?: unknown;
    teamId?: unknown;
    oauthToken?: unknown;
    clientId?: unknown;
    scopes?: unknown;
    apiKeyId?: unknown;
    user?: User | null;
};

export function createSendLitMcpAuthInfo(
    input: unknown,
): SendLitMcpAuthInfo | null {
    if (!input || typeof input !== "object") return null;
    const req = input as McpAuthRequest;
    const teamId = typeof req.teamId === "string" ? req.teamId : null;
    if (!teamId) return null;

    if (req.authKind === "oauth") {
        if (
            typeof req.oauthToken !== "string" ||
            typeof req.clientId !== "string"
        ) {
            return null;
        }
        return {
            token: req.oauthToken,
            clientId: req.clientId,
            scopes: Array.isArray(req.scopes) ? req.scopes : [],
            extra: {
                authKind: "oauth",
                teamId,
                user: req.user ?? null,
            },
        };
    }

    if (req.authKind === "team_key" && typeof req.apiKeyId === "string") {
        return {
            // The SDK requires a token field for AuthInfo pass-through. Use the
            // stable public key id, never the API-key secret.
            token: req.apiKeyId,
            clientId: `team-key:${req.apiKeyId}`,
            scopes: [],
            extra: {
                authKind: "team_key",
                teamId,
                user: null,
            },
        };
    }

    return null;
}

export function getSendLitMcpAuthInfo(
    ctx: ServerContext,
): SendLitMcpAuthInfo | null {
    const authInfo = ctx.http?.authInfo;
    const extra = authInfo?.extra as SendLitMcpAuthExtra | undefined;
    if (
        !authInfo ||
        !extra ||
        (extra.authKind !== "oauth" && extra.authKind !== "team_key") ||
        typeof extra.teamId !== "string"
    ) {
        return null;
    }
    return authInfo as SendLitMcpAuthInfo;
}
