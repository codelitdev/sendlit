import { describe, expect, it, mock } from "bun:test";
import { validateParityManifest } from "@codelitdev/mcp-server-kit";
import { contract, mcpParityManifest } from "@sendlit/api-contract";

mock.module("../db/client", () => ({ db: {}, pool: {} }));

const { createSendLitMcp } = await import("./server");

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

describe("platform conformance: MCP parity manifest", () => {
  it("documents every REST operation and MCP tool with matching risk", () => {
    const restOperationIds = new Set(collectRestOperationIds(contract));
    const tools = createSendLitMcp().listTools();
    const mcpToolNames = new Set(tools.map((tool) => tool.name));
    const mcpToolRisks = new Map(tools.map((tool) => [tool.name, tool.risk] as const));

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
    expect([...documentedTools].filter((name) => !mcpToolNames.has(name))).toEqual([]);
  });
});
