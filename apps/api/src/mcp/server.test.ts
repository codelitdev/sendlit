import { describe, expect, it, mock } from "bun:test";
import { mcpParityManifest } from "@sendlit/api-contract";
import { z } from "zod";

// The real test database: importing the server starts Better Auth, whose OAuth
// plugin queries it in the background. Built before mocking, so the factory is
// synchronous and safe when other files share the process.
const { makeTestDb } = await import("../test/db");
const testDb = await makeTestDb();
mock.module("../db/client", () => ({ db: testDb, pool: {} }));

const { sendLitMcpTools } = await import("./server");
const { authorizeMcpOperation, listMcpOperationScopes, MCP_SCOPES } = await import(
  "./policy"
);

const context = {
  authKind: "team_key" as const,
  teamId: "team-1",
  user: null,
  scopes: [] as string[],
  requestId: "",
};

describe("SendLit MCP catalog and policy", () => {
  it("serves one uniquely named tool per manifest tool, in a stable order", () => {
    const names = sendLitMcpTools().map((tool) => tool.name);
    const manifestTools = mcpParityManifest.flatMap((entry) =>
      entry.mcp ? [entry.mcp.tool] : [],
    );
    expect(new Set(names).size).toBe(names.length);
    expect([...names].sort()).toEqual([...new Set(manifestTools)].sort());
    expect(sendLitMcpTools().map((tool) => tool.name)).toEqual(names);
  });

  // What the Claude and ChatGPT directories review (see ADR 0010).
  it("gives every tool a title, short name, description and explicit open-world hint", () => {
    for (const tool of sendLitMcpTools()) {
      expect(tool.title?.length, tool.name).toBeGreaterThan(0);
      expect(tool.name.length, tool.name).toBeLessThanOrEqual(64);
      expect(tool.description.length, tool.name).toBeGreaterThan(20);
      expect(typeof tool.annotations?.openWorldHint, tool.name).toBe("boolean");
    }
  });

  it("advertises confirm on every destructive tool", () => {
    const destructive = sendLitMcpTools().filter((tool) => tool.risk === "destructive");
    expect(destructive.length).toBeGreaterThan(0);
    for (const tool of destructive) {
      expect(tool.inputSchema, tool.name).toBeInstanceOf(z.ZodObject);
      expect(
        Object.keys((tool.inputSchema as z.AnyZodObject).shape),
        tool.name,
      ).toContain("confirm");
    }
  });

  it("gives every MCP-reachable operation a scope, and no other operation one", () => {
    const reachable = mcpParityManifest
      .flatMap((entry) => (entry.parity === "required" ? [entry.rest.operationId] : []))
      .sort();
    expect(Object.keys(listMcpOperationScopes()).sort()).toEqual(reachable);
  });

  it("lets team keys run everything but key management", () => {
    expect(authorizeMcpOperation("transactional.send", context)).toBeNull();
    expect(authorizeMcpOperation("settings.esps.remove", context)).toBeNull();
    for (const operationId of [
      "teams.listKeys",
      "teams.createKey",
      "teams.removeKey",
    ]) {
      expect(authorizeMcpOperation(operationId, context)).toMatchObject({
        code: "forbidden",
        safeDetails: { reason: "user_auth_required" },
      });
    }
  });

  it("requires the operation's scope for OAuth and refuses unknown operations", () => {
    const oauth = {
      ...context,
      authKind: "oauth" as const,
      scopes: [MCP_SCOPES.contactsRead],
    };
    expect(authorizeMcpOperation("contacts.list", oauth)).toBeNull();
    expect(authorizeMcpOperation("transactional.send", oauth)).toMatchObject({
      code: "forbidden",
      safeDetails: { reason: "insufficient_scope", requiredScope: "emails:send" },
    });
    expect(
      authorizeMcpOperation("teams.createKey", {
        ...oauth,
        scopes: [MCP_SCOPES.apiKeysWrite],
      }),
    ).toBeNull();
    expect(authorizeMcpOperation("billing.portal", oauth)).toMatchObject({
      code: "forbidden",
      safeDetails: { reason: "not_mcp_operation" },
    });
  });
});
