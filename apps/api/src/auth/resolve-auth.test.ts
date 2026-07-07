import { describe, expect, it, vi } from "vitest";

vi.mock("../account/queries", () => ({
    getAccount: vi.fn(),
}));
vi.mock("../apikey/queries", () => ({
    getApiKeyBySecret: vi.fn(),
}));
vi.mock("./better-auth", () => ({
    auth: {
        api: {
            getSession: vi.fn(async () => null),
        },
    },
    ensureSendLitAccountForBetterAuthUserId: vi.fn(),
    ensureSendLitAccountForUser: vi.fn(),
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

const account = {
    id: "account-1",
    email: "owner@example.com",
    name: "Owner",
    createdAt: new Date(),
    updatedAt: new Date(),
};

function deps(overrides: Partial<AuthDependencies> = {}): AuthDependencies {
    return {
        getAccount: vi.fn(async () => account as any),
        getApiKeyBySecret: vi.fn(async () => ({
            id: "key-id",
            teamId: "team-1",
            keyHash: "hash-of-api-key",
            keyPrefix: "sl_live_api-",
            name: "Default",
            createdAt: new Date(),
        })),
        getBetterAuthSession: vi.fn(async () => null),
        verifyBetterAuthBearerToken: vi.fn(async () => null),
        ensureAccountForBetterAuthUserId: vi.fn(async () => account as any),
        ensureAccountForUser: vi.fn(async () => account as any),
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
            accountId: account.id,
            clientId: "mcp-client",
            scopes: ["contacts:read", "templates:write"],
        });
        expect(authDeps.ensureAccountForBetterAuthUserId).toHaveBeenCalledWith(
            "better-auth-user-1",
        );
        expect(authDeps.getApiKeyBySecret).not.toHaveBeenCalled();
    });

    it("authenticates API keys from headers or request bodies", async () => {
        await expect(
            resolveAuth({ apiKeyHeader: "api-key" }, deps()),
        ).resolves.toMatchObject({
            status: "authenticated",
            kind: "apikey",
            apiKey: "api-key",
            teamId: "team-1",
        });

        await expect(
            resolveAuth({ bodyApiKey: ["body-key"] }, deps()),
        ).resolves.toMatchObject({
            status: "authenticated",
            kind: "apikey",
            apiKey: "body-key",
            teamId: "team-1",
        });
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
                user: { email: "owner@example.com", name: "Owner" },
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
            accountId: account.id,
        });
        expect(authDeps.ensureAccountForUser).toHaveBeenCalledWith({
            email: "owner@example.com",
            name: "Owner",
        });
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
                kind: "apikey",
                account: null,
                apiKey: "k",
                teamId: "t",
            }),
        ).toBe(false);
    });
});
