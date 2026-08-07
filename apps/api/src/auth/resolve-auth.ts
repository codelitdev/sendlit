import { fromNodeHeaders } from "better-auth/node";
import {
    verifyOAuthAccessToken,
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
          apiKey: string;
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

/** Product claims are decoded only after oauth-server-kit has verified the
 * token's signature, issuer, audience, and expiry. They are then revalidated
 * against current SendLit membership below. */
function teamClaimFromVerifiedJwt(token: string): string | undefined {
    try {
        const parts = token.split(".");
        if (parts.length !== 3) return undefined;
        const payload = JSON.parse(
            Buffer.from(parts[1], "base64url").toString("utf8"),
        ) as Record<string, unknown>;
        return typeof payload.team_id === "string"
            ? payload.team_id
            : undefined;
    } catch {
        return undefined;
    }
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
        const result = await verifyOAuthAccessToken(
            {
                oauthResourceClient,
                audiences: validOAuthAudiences,
                issuer: authIssuer,
                resourceMetadataMappings: { mcp: mcpResourceUrl },
            },
            token,
        );
        if (
            result.status !== "authenticated" ||
            result.identity.method !== "oauth"
        ) {
            return null;
        }
        return {
            identity: result.identity,
            teamId: teamClaimFromVerifiedJwt(token),
        };
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
            apiKey: submittedApiKey,
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
