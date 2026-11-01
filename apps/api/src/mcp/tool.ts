import type { McpToolRisk } from "@codelitdev/mcp-server-kit";
import type { z } from "zod";
import logger from "../services/log";
import { serializeDates } from "../utils/serialize";
import type { SendLitMcpContext, SendLitMcpTool } from "./context";
import { authorizeMcpOperation, getRequiredScope, type McpOperationId } from "./policy";

export type DedicatedToolDefinition<Args> = {
  name: string;
  /** The REST operation this tool performs; its scope authorizes the call. */
  operationId: McpOperationId;
  title?: string;
  description: string;
  risk: McpToolRisk;
  inputSchema: z.ZodType<Args, z.ZodTypeDef, unknown>;
  outputSchema?: z.ZodType;
  annotations?: SendLitMcpTool["annotations"];
  handler: (input: { context: SendLitMcpContext; args: Args }) => Promise<unknown>;
};

/**
 * A dedicated MCP tool for a common flow. Every call is authorized against
 * its REST operation's scope before the handler runs (default deny: an
 * operation without a policy throws here, at startup), and dates in the
 * result become ISO strings, as REST sends them.
 */
export function dedicatedTool<Args>(
  definition: DedicatedToolDefinition<Args>,
): SendLitMcpTool {
  const { operationId, handler, ...tool } = definition;
  const requiredScope = getRequiredScope(operationId);
  return {
    ...tool,
    inputSchema: definition.inputSchema,
    async handler({ context, args }) {
      const startedAt = performance.now();
      const log = { tool: tool.name, requiredScope, authKind: context.authKind };
      const denied = authorizeMcpOperation(operationId, context);
      if (denied) {
        logger.warn(
          { ...log, scopeDecision: "denied" },
          "MCP tool authorization denied",
        );
        return { error: denied };
      }
      try {
        const result = await handler({ context, args: args as Args });
        const failed = Boolean(
          result && typeof result === "object" && "error" in result,
        );
        logger.info(
          {
            ...log,
            scopeDecision: "allowed",
            outcome: failed ? "tool_error" : "success",
            durationMs: Math.round(performance.now() - startedAt),
          },
          "MCP tool completed",
        );
        return failed ? result : serializeDates(result);
      } catch (error) {
        logger.error(
          {
            ...log,
            scopeDecision: "allowed",
            outcome: "exception",
            durationMs: Math.round(performance.now() - startedAt),
            errorType: error instanceof Error ? error.name : typeof error,
          },
          "MCP tool failed",
        );
        throw error;
      }
    },
  };
}
