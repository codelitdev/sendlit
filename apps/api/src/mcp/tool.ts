import type { McpToolRisk } from "@codelitdev/mcp-server-kit";
import { z } from "zod";
import logger from "../services/log";
import { serializeDates } from "../utils/serialize";
import type { SendLitMcpContext, SendLitMcpTool } from "./context";
import {
  authorizeMcpOperation,
  authorizeTeamAuthority,
  getRequiredScope,
  type McpOperationId,
} from "./policy";

export type DedicatedToolDefinition<Args> = {
  name: string;
  /** The REST operation this tool performs; its scope authorizes the call. */
  operationId: McpOperationId;
  /** Shown to people in place of `name`; directories require one. */
  title: string;
  description: string;
  risk: McpToolRisk;
  inputSchema: z.ZodType<Args, z.ZodTypeDef, unknown>;
  outputSchema?: z.ZodType;
  annotations?: SendLitMcpTool["annotations"];
  handler: (input: { context: SendLitMcpContext; args: Args }) => Promise<unknown>;
};

const confirmSchema = z
  .boolean()
  .optional()
  .describe("Set to true once the user has confirmed this action; it can't be undone.");

/**
 * The MCP tool for one REST operation. Every call is authorized against the
 * operation's scope before the handler runs (default deny: an operation
 * without a policy throws here, at startup), and dates in the result become
 * ISO strings, as REST sends them. A destructive tool advertises `confirm`,
 * which the kit requires to be `true`. `openWorldHint` is always explicit:
 * false unless the tool reaches outside the team's workspace.
 */
export function dedicatedTool<Args>(
  definition: DedicatedToolDefinition<Args>,
): SendLitMcpTool {
  const { operationId, handler, ...tool } = definition;
  const requiredScope = getRequiredScope(operationId);
  const inputSchema =
    tool.risk === "destructive" &&
    definition.inputSchema instanceof z.ZodObject &&
    !("confirm" in definition.inputSchema.shape)
      ? definition.inputSchema.extend({ confirm: confirmSchema })
      : definition.inputSchema;
  return {
    ...tool,
    inputSchema,
    annotations: { openWorldHint: false, ...tool.annotations },
    async handler({ context, args }) {
      const startedAt = performance.now();
      const log = { tool: tool.name, requiredScope, authKind: context.authKind };
      const denied =
        authorizeMcpOperation(operationId, context) ??
        (await authorizeTeamAuthority(operationId, context));
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
