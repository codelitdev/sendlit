import { fromNodeHeaders } from "better-auth/node";
import {
    type AuthenticatedIdentity,
    type AuthenticationResult,
} from "@codelitdev/oauth-server-kit";
import { resolveBetterAuthSession } from "@codelitdev/oauth-server-kit/better-auth";
import {
    getApiKeyBySecret,
    getOrganizationApiKeyBySecret,
    type ApiKey,
    type OrganizationApiKey,
} from "../apikey/queries";
import { ensureDefaultOrganization } from "../organization/queries";
import { getTeamMembership } from "../team/queries";
import { getUser, type User } from "../user/queries";
import {
    auth,
    authIssuer,
    mcpResourceUrl,
    oauthResourceClient,
    validOAuthAudiences,
} from "./better-auth";

export type AuthInput = {
    authorization?: unknown;
    apiKeyHeader?: unknown;
    bodyApiKey?: unknown;
    headers?: Record<string, string | string[] | undefined>;
};

export type AuthResult =
    | {
          status: "authenticated";
          kind: "oauth";
          identity: Extract<AuthenticatedIdentity, { method: "oauth" }>;
          user: User;
          userId: string;
          token: string;
          clientId: string;
          scopes: string[];
          teamId?: string;
      }
    | {
          status: "authenticated";
          kind: "session";
          identity: Extract<AuthenticatedIdentity, { method: "session" }>;
          user: User;
          userId: string;
          scopes: ["web"];
      }
    | {
          status: "authenticated";
          kind: "team_key";
          user: null;
          apiKeyId: string;
          teamId: string;
      }
    | {
          status: "authenticated";
          kind: "organization_key";
          user: null;
          organizationId: string;
          organizationApiKeyId: string;
          organizationScopes: string[];
      }
    | { status: "invalid_token" }
    | { status: "unauthorized" }
    | { status: "missing" }
    | { status: "unavailable" };

export type AuthDependencies = {
    getUser: (id: string) => Promise<User | null>;
    getApiKeyBySecret: (secret: string) => Promise<ApiKey | null>;
    getOrganizationApiKeyBySecret: (
        secret: string,
    ) => Promise<OrganizationApiKey | null>;
    resolveSession: (
        headers: Record<string, string | string[] | undefined>,
    ) => Promise<AuthenticationResult>;
    authenticateBearer: (token: string) => Promise<{
        identity: Extract<AuthenticatedIdentity, { method: "oauth" }>;
        teamId?: string;
    } | null>;
    ensureDefaultOrganization: (userId: string) => Promise<unknown | null>;
    getTeamMembership: (
        teamId: string,
        userId: string,
    ) => Promise<unknown | null>;
};

function headerValue(value: unknown): string | undefined {
    if (Array.isArray(value)) {
        return typeof value[0] === "string" ? value[0] : undefined;
    }
    return typeof value === "string" ? value : undefined;
}

function optionalString(value: unknown): string | undefined {
    return typeof value === "string" && value.length > 0 ? value : undefined;
}

function stringClaims(value: unknown): string[] {
    if (typeof value === "string") return [value];
    return Array.isArray(value)
        ? value.filter((item): item is string => typeof item === "string")
        : [];
}

const defaultDependencies: AuthDependencies = {
    getUser,
    getApiKeyBySecret,
    getOrganizationApiKeyBySecret,
    async resolveSession(headers) {
        return resolveBetterAuthSession(
            { auth, issuer: authIssuer },
            fromNodeHeaders(headers),
        );
    },
    async authenticateBearer(token) {
        try {
            // This is Better Auth's current resource-server API. The prior
            // oauth-server-kit verifier expected an obsolete
            // `getActions().verifyAccessToken` method, so every otherwise
            // valid SDK 2 bearer token was rejected after OAuth completed.
            const claims = await oauthResourceClient
                .getActions()
                .verifyBearerToken(token, {
                    verifyOptions: {
                        issuer: authIssuer,
                        audience: validOAuthAudiences,
                    },
                    resourceMetadataMappings: { mcp: mcpResourceUrl },
                });
            const subject = optionalString(claims.sub);
            const clientId =
                optionalString(claims.azp) ?? optionalString(claims.client_id);
            const audiences = stringClaims(claims.aud).filter((audience) =>
                validOAuthAudiences.includes(audience),
            );
            if (!subject || !clientId || audiences.length === 0) return null;
            const email = optionalString(claims.email);
            const name = optionalString(claims.name);
            const scopes = stringClaims(claims.scope).flatMap((scope) =>
                scope.split(/\s+/).filter(Boolean),
            );

            return {
                identity: {
                    method: "oauth",
                    issuer: authIssuer,
                    subject,
                    ...(email ? { email } : {}),
                    ...(name ? { name } : {}),
                    clientId,
                    scopes,
                    audiences,
                },
                teamId: optionalString(claims.team_id),
            };
        } catch {
            return null;
        }
    },
    ensureDefaultOrganization,
    getTeamMembership,
};

export async function resolveAuth(
    input: AuthInput,
    dependencies: AuthDependencies = defaultDependencies,
): Promise<AuthResult> {
    const authorization = headerValue(input.authorization);
    if (authorization) {
        const match = authorization.match(/^Bearer\s+(.+)$/i);
        if (match) {
            const token = match[1];
            if (token.startsWith("sl_org_live_")) {
                const organizationKey =
                    await dependencies.getOrganizationApiKeyBySecret(token);
                if (!organizationKey) return { status: "unauthorized" };
                return {
                    status: "authenticated",
                    kind: "organization_key",
                    user: null,
                    organizationId: organizationKey.organizationId,
                    organizationApiKeyId: organizationKey.organizationApiKeyId,
                    organizationScopes: organizationKey.scopes,
                };
            }

            const authenticated = await dependencies.authenticateBearer(token);
            if (!authenticated) return { status: "invalid_token" };
            const user = await dependencies.getUser(
                authenticated.identity.subject,
            );
            if (!user) return { status: "unauthorized" };
            if (!(await dependencies.ensureDefaultOrganization(user.id))) {
                return { status: "unauthorized" };
            }

            let teamId: string | undefined;
            if (
                authenticated.teamId &&
                (await dependencies.getTeamMembership(
                    authenticated.teamId,
                    user.id,
                ))
            ) {
                teamId = authenticated.teamId;
            }
            return {
                status: "authenticated",
                kind: "oauth",
                identity: authenticated.identity,
                user,
                userId: user.id,
                token,
                clientId: authenticated.identity.clientId,
                scopes: authenticated.identity.scopes,
                teamId,
            };
        }
    }

    const submittedApiKey =
        headerValue(input.bodyApiKey) ?? headerValue(input.apiKeyHeader);
    if (submittedApiKey) {
        const apiKey = await dependencies.getApiKeyBySecret(submittedApiKey);
        if (!apiKey) return { status: "unauthorized" };
        return {
            status: "authenticated",
            kind: "team_key",
            user: null,
            apiKeyId: apiKey.teamApiKeyId,
            teamId: apiKey.teamId,
        };
    }

    if (input.headers) {
        const session = await dependencies.resolveSession(input.headers);
        if (session.status === "unavailable") return { status: "unavailable" };
        if (
            session.status === "authenticated" &&
            session.identity.method === "session"
        ) {
            const user = await dependencies.getUser(session.identity.subject);
            if (!user) return { status: "unauthorized" };
            if (!(await dependencies.ensureDefaultOrganization(user.id))) {
                return { status: "unauthorized" };
            }
            return {
                status: "authenticated",
                kind: "session",
                identity: session.identity,
                user,
                userId: user.id,
                scopes: ["web"],
            };
        }
    }

    return { status: "missing" };
}

export function sendAuthError(
    response: {
        setHeader(name: string, value: string): unknown;
        status(code: number): { json(body: unknown): unknown };
    },
    result: AuthResult,
    resourceMetadataUrl?: string,
): boolean {
    if (result.status === "authenticated") return false;
    if (result.status === "unavailable") {
        response.status(503).json({ error: "authentication_unavailable" });
        return true;
    }
    if (resourceMetadataUrl) {
        response.setHeader(
            "WWW-Authenticate",
            `Bearer resource_metadata="${resourceMetadataUrl}"`,
        );
    }
    if (result.status === "invalid_token") {
        response.status(401).json({
            error: "invalid_token",
            error_description: "The access token is invalid or expired",
        });
        return true;
    }
    if (result.status === "missing") {
        response.status(401).json({
            error: "unauthorized",
            error_description:
                "Missing authentication: provide Authorization: Bearer <token> or x-sendlit-apikey header",
        });
        return true;
    }
    response.status(401).json({ error: "unauthorized" });
    return true;
}
