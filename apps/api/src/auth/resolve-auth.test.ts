import { describe, expect, it, vi } from "vitest";
import type {
    AuthenticatedIdentity,
    AuthenticationResult,
} from "@codelitdev/oauth-server-kit";

vi.mock("../apikey/queries", () => ({
    getApiKeyBySecret: vi.fn(),
    getOrganizationApiKeyBySecret: vi.fn(),
}));
vi.mock("../team/queries", () => ({
    getTeamMembership: vi.fn(),
}));
vi.mock("../organization/queries", () => ({
    ensureDefaultOrganization: vi.fn(),
}));
vi.mock("../user/queries", () => ({
    getUser: vi.fn(),
}));
vi.mock("./better-auth", () => ({
    auth: { api: { getSession: vi.fn(async () => null) } },
    authIssuer: "https://sendlit.test/api/auth",
    mcpResourceUrl: "https://sendlit.test/mcp",
    validOAuthAudiences: ["https://sendlit.test", "https://sendlit.test/mcp"],
    oauthResourceClient: { getActions: vi.fn(() => ({})) },
}));

import {
    resolveAuth,
    sendAuthError,
    type AuthDependencies,
} from "./resolve-auth";

const user = {
    id: "user-1",
    email: "owner@example.com",
    name: "Owner",
    createdAt: new Date(),
    updatedAt: new Date(),
};

const oauthIdentity: Extract<AuthenticatedIdentity, { method: "oauth" }> = {
    method: "oauth",
    issuer: "https://sendlit.test/api/auth",
    subject: "better-auth-user-1",
    clientId: "mcp-client",
    scopes: ["contacts:read", "templates:write"],
    audiences: ["https://sendlit.test/mcp"],
};

const sessionIdentity: Extract<AuthenticatedIdentity, { method: "session" }> = {
    method: "session",
    issuer: "https://sendlit.test/api/auth",
    subject: user.id,
    email: user.email,
    name: user.name,
    scopes: [],
};

function deps(overrides: Partial<AuthDependencies> = {}): AuthDependencies {
    return {
        getUser: vi.fn(async () => user as any),
        getApiKeyBySecret: vi.fn(async () => ({
            id: "key-id",
            teamId: "team-1",
            keyHash: "hash-of-api-key",
            keyPrefix: "sl_live_api-",
            name: "Default",
            teamApiKeyId: "tak_1",
            expiresAt: null,
            revokedAt: null,
            lastUsedAt: null,
            createdByType: "user",
            createdById: null,
            createdAt: new Date(),
        })),
        getOrganizationApiKeyBySecret: vi.fn(async () => null),
        resolveSession: vi.fn(
            async () => ({ status: "missing" }) as AuthenticationResult,
        ),
        authenticateBearer: vi.fn(async () => ({ identity: oauthIdentity })),
        ensureDefaultOrganization: vi.fn(async () => ({ id: "org-1" })),
        getTeamMembership: vi.fn(async () => null),
        ...overrides,
    };
}

describe("resolveAuth", () => {
    it("rejects an invalid explicit bearer without falling back to an API key", async () => {
        const authDeps = deps({ authenticateBearer: vi.fn(async () => null) });

        await expect(
            resolveAuth(
                { authorization: "Bearer expired", apiKeyHeader: "api-key" },
                authDeps,
            ),
        ).resolves.toEqual({ status: "invalid_token" });
        expect(authDeps.getApiKeyBySecret).not.toHaveBeenCalled();
    });

    it("maps a verified OAuth identity to a SendLit user", async () => {
        const authDeps = deps();

        await expect(
            resolveAuth(
                {
                    authorization: "Bearer better-auth-token",
                    apiKeyHeader: "api-key",
                },
                authDeps,
            ),
        ).resolves.toMatchObject({
            status: "authenticated",
            kind: "oauth",
            userId: user.id,
            clientId: "mcp-client",
            scopes: ["contacts:read", "templates:write"],
        });
        expect(authDeps.getUser).toHaveBeenCalledWith(oauthIdentity.subject);
        expect(authDeps.getApiKeyBySecret).not.toHaveBeenCalled();
    });

    it("uses a verified team claim only while membership remains valid", async () => {
        const authDeps = deps({
            authenticateBearer: vi.fn(async () => ({
                identity: oauthIdentity,
                teamId: "team-abc",
            })),
            getTeamMembership: vi.fn(async () => ({ id: "membership-1" })),
        });

        await expect(
            resolveAuth({ authorization: "Bearer token" }, authDeps),
        ).resolves.toMatchObject({
            status: "authenticated",
            kind: "oauth",
            teamId: "team-abc",
        });
        expect(authDeps.getTeamMembership).toHaveBeenCalledWith(
            "team-abc",
            user.id,
        );
    });

    it("drops a team claim after the caller loses membership", async () => {
        const authDeps = deps({
            authenticateBearer: vi.fn(async () => ({
                identity: oauthIdentity,
                teamId: "team-revoked",
            })),
        });

        const result = await resolveAuth(
            { authorization: "Bearer token" },
            authDeps,
        );
        expect(result).toMatchObject({
            status: "authenticated",
            kind: "oauth",
        });
        expect((result as any).teamId).toBeUndefined();
    });

    it("authenticates team API keys from headers or request bodies", async () => {
        await expect(
            resolveAuth({ apiKeyHeader: "api-key" }, deps()),
        ).resolves.toMatchObject({
            status: "authenticated",
            kind: "team_key",
            apiKeyId: "tak_1",
            teamId: "team-1",
        });

        await expect(
            resolveAuth({ bodyApiKey: ["body-key"] }, deps()),
        ).resolves.toMatchObject({
            status: "authenticated",
            kind: "team_key",
            apiKeyId: "tak_1",
            teamId: "team-1",
        });
    });

    it("accepts an organization key as its explicit product credential", async () => {
        const authDeps = deps({
            getOrganizationApiKeyBySecret: vi.fn(
                async () =>
                    ({
                        organizationId: "org-1",
                        organizationApiKeyId: "oak-1",
                        scopes: ["teams:provision"],
                    }) as any,
            ),
        });

        await expect(
            resolveAuth(
                { authorization: "Bearer sl_org_live_example" },
                authDeps,
            ),
        ).resolves.toMatchObject({
            status: "authenticated",
            kind: "organization_key",
            organizationId: "org-1",
        });
        expect(authDeps.authenticateBearer).not.toHaveBeenCalled();
    });

    it("prefers an explicit API key over a browser session", async () => {
        const authDeps = deps({
            resolveSession: vi.fn(
                async () =>
                    ({
                        status: "authenticated",
                        identity: sessionIdentity,
                    }) as AuthenticationResult,
            ),
        });

        await expect(
            resolveAuth(
                {
                    apiKeyHeader: "api-key",
                    headers: { cookie: "better-auth.session_token=s" },
                },
                authDeps,
            ),
        ).resolves.toMatchObject({ kind: "team_key", teamId: "team-1" });
        expect(authDeps.resolveSession).not.toHaveBeenCalled();
    });

    it("distinguishes missing credentials, unknown credentials, and unavailable authentication", async () => {
        await expect(resolveAuth({}, deps())).resolves.toEqual({
            status: "missing",
        });
        await expect(
            resolveAuth(
                { apiKeyHeader: "wrong" },
                deps({ getApiKeyBySecret: vi.fn(async () => null) }),
            ),
        ).resolves.toEqual({ status: "unauthorized" });
        await expect(
            resolveAuth(
                { headers: { cookie: "better-auth.session_token=s" } },
                deps({
                    resolveSession: vi.fn(
                        async () =>
                            ({ status: "unavailable" }) as AuthenticationResult,
                    ),
                }),
            ),
        ).resolves.toEqual({ status: "unavailable" });
    });

    it("maps a validated Better Auth session to a SendLit user", async () => {
        const authDeps = deps({
            resolveSession: vi.fn(
                async () =>
                    ({
                        status: "authenticated",
                        identity: sessionIdentity,
                    }) as AuthenticationResult,
            ),
        });

        await expect(
            resolveAuth(
                { headers: { cookie: "better-auth.session_token=s" } },
                authDeps,
            ),
        ).resolves.toMatchObject({
            status: "authenticated",
            kind: "session",
            userId: user.id,
        });
        expect(authDeps.getUser).toHaveBeenCalledWith(user.id);
    });
});

describe("sendAuthError", () => {
    it("writes stable client-facing authentication errors", () => {
        const response = {
            setHeader: vi.fn(),
            status: vi.fn().mockReturnThis(),
            json: vi.fn(),
        };

        expect(sendAuthError(response, { status: "missing" })).toBe(true);
        expect(response.status).toHaveBeenLastCalledWith(401);
        expect(response.json).toHaveBeenLastCalledWith(
            expect.objectContaining({ error: "unauthorized" }),
        );

        expect(sendAuthError(response, { status: "unavailable" })).toBe(true);
        expect(response.status).toHaveBeenLastCalledWith(503);
    });
});
