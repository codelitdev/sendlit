import { beforeAll, describe, expect, it, vi } from "vitest";
import { MCP_SCOPES_SUPPORTED } from "../mcp/policy";

const dbMock = vi.hoisted(() => ({
    select: vi.fn(() => ({
        from: vi.fn(() => ({
            where: vi.fn(() => ({ limit: vi.fn(async () => []) })),
        })),
    })),
    insert: vi.fn(() => ({
        values: vi.fn(() => ({ returning: vi.fn(async () => [{}]) })),
    })),
}));

vi.mock("../db/client", () => ({ db: dbMock }));
vi.mock("../organization/queries", () => ({
    ensureDefaultOrganization: vi.fn(),
}));

describe("Better Auth MCP authorization metadata", () => {
    let auth: (typeof import("./better-auth.js"))["auth"];
    let defaultScopes: (typeof import("./better-auth.js"))["OAUTH_CLIENT_DEFAULT_SCOPES"];
    let requestableScopes: (typeof import("./better-auth.js"))["OAUTH_CLIENT_REQUESTABLE_SCOPES"];

    beforeAll(async () => {
        vi.stubEnv(
            "BETTER_AUTH_SECRET",
            "test-only-secret-with-at-least-thirty-two-characters",
        );
        vi.stubEnv("API_PUBLIC_URL", "https://sendlit.test");
        const betterAuthModule = await import("./better-auth.js");
        auth = betterAuthModule.auth;
        defaultScopes = betterAuthModule.OAUTH_CLIENT_DEFAULT_SCOPES;
        requestableScopes = betterAuthModule.OAUTH_CLIENT_REQUESTABLE_SCOPES;
    });

    it("keeps registration defaults identity-only while allowing MCP scopes", () => {
        expect(defaultScopes).toEqual(["openid", "profile", "email"]);
        expect(requestableScopes).toEqual(
            expect.arrayContaining(["offline_access", ...MCP_SCOPES_SUPPORTED]),
        );
        expect(defaultScopes).not.toEqual(
            expect.arrayContaining([...MCP_SCOPES_SUPPORTED]),
        );
    });

    it.each(["", "   "])(
        "rejects authorization without an explicit scope (%j)",
        async (scope) => {
            const query = new URLSearchParams({
                response_type: "code",
                client_id: "test-client",
                redirect_uri: "https://client.example/callback",
                code_challenge: "test-code-challenge",
                code_challenge_method: "S256",
            });
            if (scope.length > 0) query.set("scope", scope);

            const response = await auth.handler(
                new Request(
                    `https://sendlit.test/api/auth/oauth2/authorize?${query}`,
                ),
            );

            expect(response.status).toBe(400);
            await expect(response.json()).resolves.toMatchObject({
                error: "invalid_scope",
                error_description:
                    "OAuth authorization requests must include an explicit scope.",
            });
        },
    );

    it("advertises CIMD, DCR, issuer protection, and all enforced MCP scopes", async () => {
        const response = await auth.handler(
            new Request(
                "https://sendlit.test/api/auth/.well-known/oauth-authorization-server",
            ),
        );
        const metadata = await response.json();

        expect(response.status).toBe(200);
        expect(metadata).toMatchObject({
            issuer: "https://sendlit.test/api/auth",
            client_id_metadata_document_supported: true,
            authorization_response_iss_parameter_supported: true,
        });
        expect(metadata.scopes_supported).toEqual(
            expect.arrayContaining([...MCP_SCOPES_SUPPORTED]),
        );
        expect(metadata.registration_endpoint).toBe(
            "https://sendlit.test/api/auth/oauth2/register",
        );
    });
});
