import { afterEach, describe, expect, it, mock } from "bun:test";
import { validateParityManifest } from "@codelitdev/mcp-server-kit";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { type AuthInfo, createMcpHandler } from "@modelcontextprotocol/server";
import { contract, mcpParityManifest } from "@sendlit/api-contract";

mock.module("../db/client", () => ({ db: {}, pool: {} }));

const { buildMcpServer } = await import("./server");

type Risk = "read" | "write" | "destructive";

const teamKeyAuth: AuthInfo = {
  token: "tak_test",
  clientId: "team-key:tak_test",
  scopes: [],
  extra: { authKind: "team_key", teamId: "team-1", user: null },
};

/** Dotted router-key paths for every ts-rest route, e.g. `settings.esps.list`. */
function collectRestOperationIds(router: object, prefix: string[] = []): string[] {
  return Object.entries(router).flatMap(([key, value]) => {
    if (!value || typeof value !== "object") return [];
    const path = [...prefix, key];
    const route = value as { method?: unknown; path?: unknown };
    if (typeof route.method === "string" && typeof route.path === "string") {
      return [path.join(".")];
    }
    return collectRestOperationIds(value, path);
  });
}

function riskFromAnnotations(annotations?: {
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
}): Risk {
  if (annotations?.readOnlyHint) return "read";
  if (annotations?.destructiveHint) return "destructive";
  return "write";
}

async function listRegisteredTools() {
  const handler = createMcpHandler(() => buildMcpServer(), { legacy: "stateless" });
  const client = new Client(
    { name: "sendlit-parity-test", version: "1.0.0" },
    { versionNegotiation: { mode: { pin: "2026-07-28" } } },
  );
  closeables.push(client, handler);
  await client.connect(
    new StreamableHTTPClientTransport(new URL("http://sendlit.test/mcp"), {
      fetch: (input, init) =>
        handler.fetch(new Request(input, init), { authInfo: teamKeyAuth }),
    }),
  );
  return (await client.listTools()).tools;
}

const closeables: Array<{ close(): Promise<void> }> = [];

afterEach(async () => {
  await Promise.allSettled(closeables.splice(0).map((item) => item.close()));
});

describe("platform conformance: MCP parity manifest", () => {
  it("documents every REST operation and MCP tool with matching risk", async () => {
    const restOperationIds = new Set(collectRestOperationIds(contract));
    const tools = await listRegisteredTools();
    const mcpToolNames = new Set(tools.map((tool) => tool.name));
    const mcpToolRisks = new Map(
      tools.map((tool) => [tool.name, riskFromAnnotations(tool.annotations)] as const),
    );

    expect(
      validateParityManifest(mcpParityManifest, {
        restOperationIds,
        mcpToolNames,
        mcpToolRisks,
      }),
    ).toEqual([]);

    // The kit checks REST coverage; also require exactly-once REST entries
    // and an entry for every registered MCP tool.
    const restEntries = mcpParityManifest.flatMap((entry) =>
      entry.rest ? [entry.rest.operationId] : [],
    );
    expect(restEntries.length).toBe(new Set(restEntries).size);
    expect(new Set(restEntries)).toEqual(restOperationIds);

    const documentedTools = new Set(
      mcpParityManifest.flatMap((entry) => (entry.mcp ? [entry.mcp.tool] : [])),
    );
    expect([...mcpToolNames].filter((name) => !documentedTools.has(name))).toEqual([]);
  });
});
