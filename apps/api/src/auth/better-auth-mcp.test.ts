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

    beforeAll(async () => {
        vi.stubEnv(
            "BETTER_AUTH_SECRET",
            "test-only-secret-with-at-least-thirty-two-characters",
        );
        vi.stubEnv("API_PUBLIC_URL", "https://sendlit.test");
        ({ auth } = await import("./better-auth.js"));
    });

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
