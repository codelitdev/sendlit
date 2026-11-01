import { describe, expect, it, mock } from "bun:test";
import { mcpParityManifest } from "@sendlit/api-contract";
import express from "express";

mock.module("../db/client", () => ({ db: {}, pool: {} }));

const { createSendLitMcp, dedicatedTools } = await import("./server");
const { authorizeMcpOperation, listMcpOperationScopes, MCP_SCOPES } = await import(
  "./policy"
);

const context = {
  authKind: "team_key" as const,
  teamId: "team-1",
  user: null,
  scopes: [] as string[],
  requestId: "",
  clientIp: "",
  replayHeaders: {},
};

describe("SendLit MCP catalog and policy", () => {
  it("serves the dedicated tools then the generic api.* tools, in a stable order", () => {
    const names = createSendLitMcp({ app: () => express() })
      .listTools()
      .map((tool) => tool.name);
    expect(names.slice(-5)).toEqual([
      "api.list_operations",
      "api.describe_operation",
      "api.read",
      "api.write",
      "api.delete",
    ]);
    expect(names).toHaveLength(34);
    expect(new Set(names).size).toBe(names.length);
    expect(names.slice(0, 3)).toEqual([
      "list_contacts",
      "get_contact",
      "create_contact",
    ]);
  });

  it("gives every MCP-reachable operation a scope, and no other operation one", () => {
    const reachable = mcpParityManifest
      .flatMap((entry) => (entry.parity === "required" ? [entry.rest.operationId] : []))
      .sort();
    expect(Object.keys(listMcpOperationScopes()).sort()).toEqual(reachable);
  });

  it("maps each dedicated tool to the operation its manifest entry names", () => {
    const toolOperation = new Map(
      mcpParityManifest.flatMap((entry) =>
        entry.parity === "required"
          ? [[entry.mcp.tool, entry.rest.operationId] as const]
          : [],
      ),
    );
    for (const tool of dedicatedTools()) {
      expect(toolOperation.has(tool.name)).toBe(true);
    }
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
