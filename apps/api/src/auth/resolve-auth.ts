import { getAccount, Account } from "../account/queries";
import { getApiKeyBySecret, ApiKey } from "../apikey/queries";
import { getTeamMembership } from "../team/queries";
import {
    auth,
    authIssuer,
    ensureSendLitAccountForBetterAuthUserId,
    ensureSendLitAccountForUser,
    mcpResourceUrl,
    oauthResourceClient,
    validOAuthAudiences,
} from "./better-auth";
import { fromNodeHeaders } from "better-auth/node";

type BearerJwtPayload = {
    sub?: string;
    azp?: string;
    scope?: string;
    /** Set only when the token was minted after the user picked a team on
     * `/oauth/select-team` (multi-team accounts only — see
     * `customAccessTokenClaims` in `./better-auth.ts`). Re-validated as live
     * team membership below before being trusted. */
    team_id?: string;
};

export type AuthInput = {
    authorization?: unknown;
    apiKeyHeader?: unknown;
    bodyApiKey?: unknown;
    headers?: Record<string, string | string[] | undefined>;
};

export type AuthDependencies = {
    getAccount: (id: string) => Promise<Account | null>;
    getApiKeyBySecret: (secret: string) => Promise<ApiKey | null>;
    getBetterAuthSession: (
        headers: Record<string, string | string[] | undefined>,
    ) => Promise<{ user: { email: string; name?: string | null } } | null>;
    verifyBetterAuthBearerToken: (
        token: string,
    ) => Promise<BearerJwtPayload | null>;
    ensureAccountForBetterAuthUserId: (
        userId: string,
    ) => Promise<Account | null>;
    ensureAccountForUser: (user: {
        email: string;
        name?: string | null;
    }) => Promise<Account>;
    /** Live re-check for a bearer token's `team_id` claim — an access token
     * can outlive a membership change (removal from a team), so the claim is
     * trusted only once this confirms it still holds. */
    getTeamMembership: (
        teamId: string,
        accountId: string,
    ) => Promise<unknown | null>;
};

export type AuthResult =
    | {
          status: "authenticated";
          kind: "oauth";
          account: Account;
          accountId: string;
          clientId: string;
          scopes: string[];
          /** Resolved here only when the access token carries a `team_id`
           * claim (a multi-team account that went through
           * `/oauth/select-team`) *and* that membership still checks out.
           * Otherwise left undefined — see `auth/require-team.ts`, which
           * falls back to an explicit `X-Sendlit-Team-Id` header or the
           * account's sole team, if it only has one. */
          teamId?: string;
      }
    | {
          status: "authenticated";
          kind: "session";
          account: Account;
          accountId: string;
          clientId?: undefined;
          scopes: string[];
          teamId?: undefined;
      }
    | {
          status: "authenticated";
          kind: "apikey";
          /** A key has no single owning account any more (a team can have
           * several members) — `account` is only populated for user auth. */
          account: null;
          accountId?: undefined;
          apiKey: string;
          /** A key always authenticates as exactly one, fixed team. */
          teamId: string;
      }
    | { status: "invalid_token" }
    | { status: "unauthorized" }
    | { status: "missing" };

/** `resourceMetadataUrl`, when given, is sent back as a
 * `WWW-Authenticate: Bearer resource_metadata="..."` challenge (RFC 9728) so
 * spec-compliant OAuth/MCP clients can discover where to look up this
 * resource's metadata — and, in turn, learn to request a token with the
 * matching `resource` parameter instead of an unscoped (opaque) one. See
 * `mcpProtectedResourceMetadataUrl` in `./better-auth.ts`. */
export function sendAuthError(
    res: any,
    auth: AuthResult,
    resourceMetadataUrl?: string,
): boolean {
    if (
        resourceMetadataUrl &&
        (auth.status === "invalid_token" ||
            auth.status === "missing" ||
            auth.status === "unauthorized")
    ) {
        res.setHeader(
            "WWW-Authenticate",
            `Bearer resource_metadata="${resourceMetadataUrl}"`,
        );
    }

    if (auth.status === "invalid_token") {
        res.status(401).json({
            error: "invalid_token",
            error_description: "Access token is invalid or expired",
        });
        return true;
    }

    if (auth.status === "missing") {
        res.status(401).json({
            error: "unauthorized",
            error_description:
                "Missing authentication: provide Authorization: Bearer <token> or x-sendlit-apikey header",
        });
        return true;
    }

    if (auth.status === "unauthorized") {
        res.status(401).json({ error: "unauthorized" });
        return true;
    }

    return false;
}

const defaultDependencies: AuthDependencies = {
    getAccount,
    getApiKeyBySecret,
    async getBetterAuthSession(headers) {
        return auth.api.getSession({
            headers: fromNodeHeaders(headers),
        }) as Promise<{ user: { email: string; name?: string | null } } | null>;
    },
    async verifyBetterAuthBearerToken(token) {
        try {
            return await oauthResourceClient
                .getActions()
                .verifyAccessToken(token, {
                    verifyOptions: {
                        // Must match what the oauth-provider plugin actually
                        // signs (see the constants' own docs in
                        // ./better-auth.ts) - a plain base-URL guess here
                        // rejects every real token with invalid_token.
                        audience: validOAuthAudiences,
                        issuer: authIssuer,
                    },
                    resourceMetadataMappings: {
                        mcp: mcpResourceUrl,
                    },
                });
        } catch {
            return null;
        }
    },
    ensureAccountForBetterAuthUserId: ensureSendLitAccountForBetterAuthUserId,
    ensureAccountForUser: ensureSendLitAccountForUser,
    getTeamMembership,
};

function getHeaderValue(value: unknown): string | undefined {
    if (Array.isArray(value)) {
        return typeof value[0] === "string" ? value[0] : undefined;
    }
    return typeof value === "string" ? value : undefined;
}

export async function resolveAuth(
    input: AuthInput,
    dependencies: AuthDependencies = defaultDependencies,
): Promise<AuthResult> {
    const authorization = getHeaderValue(input.authorization);
    if (authorization) {
        const match = authorization.match(/^Bearer (.+)$/i);
        if (match) {
            const claims = await dependencies.verifyBetterAuthBearerToken(
                match[1],
            );
            if (!claims?.sub) return { status: "invalid_token" };

            const account = await dependencies.ensureAccountForBetterAuthUserId(
                claims.sub,
            );
            if (!account) return { status: "unauthorized" };

            const teamId = claims.team_id
                ? await (async () => {
                      const membership = await dependencies.getTeamMembership(
                          claims.team_id!,
                          account.id,
                      );
                      // A membership can be revoked after the token was
                      // minted — an unverifiable claim is dropped, not
                      // trusted, and falls back to require-team.ts below.
                      return membership ? claims.team_id : undefined;
                  })()
                : undefined;

            return {
                status: "authenticated",
                kind: "oauth",
                account,
                accountId: account.id,
                clientId: String(claims.azp || "better-auth"),
                scopes:
                    typeof claims.scope === "string"
                        ? claims.scope.split(/\s+/).filter(Boolean)
                        : [],
                teamId,
            };
        }
    }

    if (input.headers) {
        const session = await dependencies.getBetterAuthSession(input.headers);
        if (session?.user?.email) {
            const account = await dependencies.ensureAccountForUser({
                email: session.user.email,
                name: session.user.name,
            });

            return {
                status: "authenticated",
                kind: "session",
                account,
                accountId: account.id,
                scopes: ["web"],
            };
        }
    }

    const submittedApiKey =
        getHeaderValue(input.bodyApiKey) || getHeaderValue(input.apiKeyHeader);
    if (!submittedApiKey) return { status: "missing" };

    const apiKey = await dependencies.getApiKeyBySecret(submittedApiKey);
    if (!apiKey) return { status: "unauthorized" };

    return {
        status: "authenticated",
        kind: "apikey",
        account: null,
        apiKey: submittedApiKey,
        teamId: apiKey.teamId,
    };
}
