import { describe, expect, it, vi } from "vitest";

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
    auth: {
        api: {
            getSession: vi.fn(async () => null),
        },
    },
    oauthResourceClient: {
        getActions: vi.fn(() => ({
            verifyAccessToken: vi.fn(async () => null),
        })),
    },
}));
vi.mock("better-auth/node", () => ({
    fromNodeHeaders: vi.fn((headers) => headers),
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
            lastUsedAt: null,
            revokedAt: null,
            createdByType: "user",
            createdById: null,
            createdAt: new Date(),
        })),
        getOrganizationApiKeyBySecret: vi.fn(async () => null),
        getBetterAuthSession: vi.fn(async () => null),
        verifyBetterAuthBearerToken: vi.fn(async () => null),
        ensureDefaultOrganization: vi.fn(async () => ({ id: "org-1" })),
        getTeamMembership: vi.fn(async () => null),
        ...overrides,
    };
}

describe("resolveAuth", () => {
    it("rejects invalid bearer tokens instead of falling back to an API key", async () => {
        const authDeps = deps({
            verifyBetterAuthBearerToken: vi.fn(async () => null),
        });

        await expect(
            resolveAuth(
                {
                    authorization: "Bearer expired",
                    apiKeyHeader: "api-key",
                },
                authDeps,
            ),
        ).resolves.toEqual({ status: "invalid_token" });
        expect(authDeps.getApiKeyBySecret).not.toHaveBeenCalled();
    });

    it("authenticates Better Auth OAuth bearer tokens before considering API keys", async () => {
        const authDeps = deps({
            verifyBetterAuthBearerToken: vi.fn(async () => ({
                sub: "better-auth-user-1",
                azp: "mcp-client",
                scope: "contacts:read templates:write",
            })),
        });

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
        expect(authDeps.getUser).toHaveBeenCalledWith("better-auth-user-1");
        expect(authDeps.getApiKeyBySecret).not.toHaveBeenCalled();
    });

    it("resolves teamId from a verified team_id claim (multi-team OAuth account)", async () => {
        const authDeps = deps({
            verifyBetterAuthBearerToken: vi.fn(async () => ({
                sub: "better-auth-user-1",
                azp: "mcp-client",
                scope: "contacts:read",
                team_id: "team-abc",
            })),
            getTeamMembership: vi.fn(async () => ({
                id: "membership-1",
                teamId: "team-abc",
                userId: user.id,
                role: "owner",
                createdAt: new Date(),
            })),
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

    it("drops a team_id claim whose membership no longer holds", async () => {
        const authDeps = deps({
            verifyBetterAuthBearerToken: vi.fn(async () => ({
                sub: "better-auth-user-1",
                azp: "mcp-client",
                scope: "contacts:read",
                team_id: "team-revoked",
            })),
            getTeamMembership: vi.fn(async () => null),
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

    it("leaves teamId undefined when the token carries no team_id claim", async () => {
        const authDeps = deps({
            verifyBetterAuthBearerToken: vi.fn(async () => ({
                sub: "better-auth-user-1",
                azp: "mcp-client",
                scope: "contacts:read",
            })),
        });

        const result = await resolveAuth(
            { authorization: "Bearer token" },
            authDeps,
        );
        expect((result as any).teamId).toBeUndefined();
        expect(authDeps.getTeamMembership).not.toHaveBeenCalled();
    });

    it("authenticates API keys from headers or request bodies", async () => {
        await expect(
            resolveAuth({ apiKeyHeader: "api-key" }, deps()),
        ).resolves.toMatchObject({
            status: "authenticated",
            kind: "team_key",
            apiKey: "api-key",
            teamId: "team-1",
        });

        await expect(
            resolveAuth({ bodyApiKey: ["body-key"] }, deps()),
        ).resolves.toMatchObject({
            status: "authenticated",
            kind: "team_key",
            apiKey: "body-key",
            teamId: "team-1",
        });
    });

    it("prefers an explicitly supplied API key over a browser session", async () => {
        const authDeps = deps({
            getBetterAuthSession: vi.fn(async () => ({
                user: { id: user.id },
            })),
        });

        await expect(
            resolveAuth(
                {
                    apiKeyHeader: "api-key",
                    headers: { cookie: "better-auth.session_token=s" },
                },
                authDeps,
            ),
        ).resolves.toMatchObject({
            status: "authenticated",
            kind: "team_key",
            teamId: "team-1",
        });
        expect(authDeps.getBetterAuthSession).not.toHaveBeenCalled();
    });

    it("distinguishes missing credentials from unknown credentials", async () => {
        await expect(resolveAuth({}, deps())).resolves.toEqual({
            status: "missing",
        });
        await expect(
            resolveAuth(
                { apiKeyHeader: "wrong" },
                deps({ getApiKeyBySecret: vi.fn(async () => null) }),
            ),
        ).resolves.toEqual({ status: "unauthorized" });
    });

    it("authenticates Better Auth web sessions from forwarded cookies", async () => {
        const authDeps = deps({
            getBetterAuthSession: vi.fn(async () => ({
                user: { id: user.id },
            })),
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
        expect(authDeps.getApiKeyBySecret).not.toHaveBeenCalled();
    });
});

describe("sendAuthError", () => {
    it("writes client-facing auth errors with stable response codes", () => {
        const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };

        expect(sendAuthError(res, { status: "missing" })).toBe(true);
        expect(res.status).toHaveBeenLastCalledWith(401);
        expect(res.json).toHaveBeenLastCalledWith(
            expect.objectContaining({ error: "unauthorized" }),
        );

        expect(
            sendAuthError(res, {
                status: "authenticated",
                kind: "team_key",
                user: null,
                apiKey: "k",
                teamId: "t",
            }),
        ).toBe(false);
    });
});
