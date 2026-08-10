import { afterEach, describe, expect, it, vi } from "vitest";
import {
    Client,
    StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import {
    createMcpHandler,
    type AuthInfo,
    type McpHttpHandler,
    type ServerContext,
} from "@modelcontextprotocol/server";
import { buildMcpServer } from "./server";
import { authorizeMcpTool, listMcpToolPolicies, MCP_SCOPES } from "./policy";

vi.mock("../db/client", () => ({ db: {}, pool: {} }));

const endpoint = new URL("http://sendlit.test/mcp");
const teamKeyAuth: AuthInfo = {
    token: "tak_test",
    clientId: "team-key:tak_test",
    scopes: [],
    extra: {
        authKind: "team_key",
        teamId: "team-1",
        user: null,
    },
};

function createHandler() {
    return createMcpHandler(() => buildMcpServer(), {
        legacy: "stateless",
    });
}

function transportFor(handler: McpHttpHandler, authInfo = teamKeyAuth) {
    return new StreamableHTTPClientTransport(endpoint, {
        fetch: (input, init) =>
            handler.fetch(new Request(input, init), { authInfo }),
    });
}

const closeables: Array<{ close(): Promise<void> }> = [];

afterEach(async () => {
    await Promise.allSettled(closeables.splice(0).map((item) => item.close()));
});

describe("MCP server", () => {
    it("serves the complete deterministic tool catalog on 2026-07-28", async () => {
        const handler = createHandler();
        const client = new Client(
            { name: "sendlit-test", version: "1.0.0" },
            { versionNegotiation: { mode: { pin: "2026-07-28" } } },
        );
        closeables.push(client, handler);

        await client.connect(transportFor(handler));
        expect(client.getProtocolEra()).toBe("modern");

        const result = await client.listTools();
        expect(result.tools).toHaveLength(68);
        expect(result.tools.map((tool) => tool.name).sort()).toEqual(
            Object.keys(listMcpToolPolicies()).sort(),
        );
        expect(new Set(result.tools.map((tool) => tool.name)).size).toBe(68);
        expect(result.ttlMs).toBe(300_000);
        expect(result.cacheScope).toBe("private");
        for (const tool of result.tools) {
            expect(tool.description).toBeTruthy();
            expect(tool.inputSchema).toMatchObject({ type: "object" });
            expect(tool.outputSchema).toBeTruthy();
            expect(tool.annotations).toBeTruthy();
        }

        const refreshed = await client.listTools(undefined, {
            cacheMode: "refresh",
        });
        expect(refreshed.tools.map((tool) => tool.name)).toEqual(
            result.tools.map((tool) => tool.name),
        );
    });

    it("rejects protocol-envelope/header mismatches", async () => {
        const handler = createHandler();
        const client = new Client(
            { name: "sendlit-header-test", version: "1.0.0" },
            { versionNegotiation: { mode: { pin: "2026-07-28" } } },
        );
        closeables.push(client, handler);
        let tamperHeaders = false;
        const transport = new StreamableHTTPClientTransport(endpoint, {
            fetch: (input, init) => {
                const request = new Request(input, init);
                if (!tamperHeaders) {
                    return handler.fetch(request, { authInfo: teamKeyAuth });
                }
                const headers = new Headers(request.headers);
                headers.set("Mcp-Method", "tools/call");
                return handler.fetch(new Request(request, { headers }), {
                    authInfo: teamKeyAuth,
                });
            },
        });

        await client.connect(transport);
        tamperHeaders = true;

        await expect(
            client.listTools(undefined, { cacheMode: "refresh" }),
        ).rejects.toThrow();
    });

    it("enforces default-deny OAuth scopes while allowing fixed-team keys", () => {
        const baseContext = {
            mcpReq: {},
            http: { authInfo: teamKeyAuth },
        } as unknown as ServerContext;
        expect(authorizeMcpTool("send_email", baseContext)).toBeNull();

        const oauthContext = {
            mcpReq: {},
            http: {
                authInfo: {
                    token: "oauth-token",
                    clientId: "client-1",
                    scopes: [MCP_SCOPES.contactsRead],
                    extra: {
                        authKind: "oauth",
                        teamId: "team-1",
                        user: null,
                    },
                },
            },
        } as unknown as ServerContext;

        expect(authorizeMcpTool("list_contacts", oauthContext)).toBeNull();
        expect(authorizeMcpTool("send_email", oauthContext)).toMatchObject({
            isError: true,
            content: [
                expect.objectContaining({
                    text: expect.stringContaining(MCP_SCOPES.emailsSend),
                }),
            ],
        });
        expect(() =>
            authorizeMcpTool("unregistered_tool", oauthContext),
        ).toThrow("has no authorization policy");
    });
});
