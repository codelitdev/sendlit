import { getAccount, Account } from "../account/queries";
import { getApiKeyBySecret, ApiKey } from "../apikey/queries";
import {
    auth,
    ensureSendLitAccountForBetterAuthUserId,
    ensureSendLitAccountForUser,
    oauthResourceClient,
} from "./better-auth";
import { fromNodeHeaders } from "better-auth/node";

type BearerJwtPayload = {
    sub?: string;
    azp?: string;
    scope?: string;
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
};

export type AuthResult =
    | {
          status: "authenticated";
          kind: "oauth";
          account: Account;
          accountId: string;
          clientId: string;
          scopes: string[];
          /** Not resolved here — a bearer-token account may belong to
           * several teams. See `auth/require-team.ts`, which resolves it from
           * an explicit header (falling back to the account's sole team, if
           * it only has one). */
          teamId?: undefined;
      }
    | {
          status: "authenticated";
          kind: "oauth";
          account: Account;
          accountId: string;
          clientId: string;
          scopes: string[];
          teamId?: undefined;
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

export function sendAuthError(res: any, auth: AuthResult): boolean {
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
                        audience:
                            process.env.API_PUBLIC_URL ||
                            process.env.BETTER_AUTH_URL ||
                            "http://localhost:4000",
                        issuer:
                            process.env.API_PUBLIC_URL ||
                            process.env.BETTER_AUTH_URL ||
                            "http://localhost:4000",
                    },
                    resourceMetadataMappings: {
                        mcp: `${
                            process.env.API_PUBLIC_URL ||
                            process.env.BETTER_AUTH_URL ||
                            "http://localhost:4000"
                        }/mcp`,
                    },
                });
        } catch {
            return null;
        }
    },
    ensureAccountForBetterAuthUserId: ensureSendLitAccountForBetterAuthUserId,
    ensureAccountForUser: ensureSendLitAccountForUser,
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
