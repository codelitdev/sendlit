import { describe, expect, it, vi } from "vitest";

vi.mock("../oauth/middleware", () => ({
    validateBearerToken: vi.fn(),
}));
vi.mock("../account/queries", () => ({
    getAccount: vi.fn(),
}));
vi.mock("../apikey/queries", () => ({
    getApiKeyUsingKeyId: vi.fn(),
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
        validateBearerToken: vi.fn(async () => ({
            accountId: account.id,
            clientId: "client-1",
            scopes: ["read", "write"],
        })),
        getAccount: vi.fn(async () => account as any),
        getApiKeyUsingKeyId: vi.fn(async () => ({
            id: "key-id",
            teamId: "team-1",
            key: "api-key",
            name: "Default",
            createdAt: new Date(),
        })),
        ...overrides,
    };
}

describe("resolveAuth", () => {
    it("authenticates bearer tokens before considering API keys", async () => {
        const authDeps = deps();

        const auth = await resolveAuth(
            {
                authorization: "Bearer access-token",
                apiKeyHeader: "api-key",
            },
            authDeps,
        );

        expect(auth).toMatchObject({
            status: "authenticated",
            kind: "oauth",
            accountId: account.id,
            clientId: "client-1",
            scopes: ["read", "write"],
        });
        expect(authDeps.validateBearerToken).toHaveBeenCalledWith(
            "access-token",
        );
        expect(authDeps.getApiKeyUsingKeyId).not.toHaveBeenCalled();
    });

    it("rejects invalid bearer tokens instead of falling back to an API key", async () => {
        const authDeps = deps({
            validateBearerToken: vi.fn(async () => null),
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
        expect(authDeps.getApiKeyUsingKeyId).not.toHaveBeenCalled();
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
                deps({ getApiKeyUsingKeyId: vi.fn(async () => null) }),
            ),
        ).resolves.toEqual({ status: "unauthorized" });
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
