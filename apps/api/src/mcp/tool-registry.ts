import {
    type McpServer,
    type ServerContext,
    type StandardSchemaWithJSON,
    type ToolAnnotations,
} from "@modelcontextprotocol/server";
import type { ZodRawShape, ZodTypeAny } from "zod";
import logger from "../services/log";
import { authorizeMcpTool, getRequiredScope, type McpToolName } from "./policy";
import { toMcpObjectSchema, toMcpSchema } from "./schema";

export type McpToolConfig = {
    title?: string;
    description?: string;
    inputSchema?: ZodRawShape;
    outputSchema: ZodTypeAny;
    annotations?: ToolAnnotations;
};

export type McpToolHandler = (
    argsOrContext: any,
    context?: ServerContext,
) => Promise<any> | any;

export interface McpToolRegistrar {
    registerTool(
        name: McpToolName,
        config: McpToolConfig,
        handler: McpToolHandler,
    ): void;
}

type CompiledToolSchemas = {
    inputSchema: StandardSchemaWithJSON;
    outputSchema: StandardSchemaWithJSON;
};

// SDK 2 creates a fresh server for every stateless request, but SendLit's tool
// schemas are immutable. Cache their adapters by the exhaustively policy-bound
// tool name so 68 Zod-to-JSON-Schema conversions happen once per process, not
// once per request.
const compiledSchemas = new Map<McpToolName, CompiledToolSchemas>();

function getCompiledSchemas(
    name: McpToolName,
    config: McpToolConfig,
): CompiledToolSchemas {
    const cached = compiledSchemas.get(name);
    if (cached) return cached;

    const schemas = {
        inputSchema: toMcpObjectSchema(config.inputSchema),
        outputSchema: toMcpSchema(config.outputSchema),
    };
    compiledSchemas.set(name, schemas);
    return schemas;
}

/**
 * Adapt SendLit's canonical Zod 3 tool schemas and thin handlers to the MCP
 * SDK 2 Standard Schema/context APIs. Every registration is default-deny:
 * looking up the required scope throws if policy is missing.
 */
export function createMcpToolRegistrar(server: McpServer): McpToolRegistrar {
    return {
        registerTool(name, config, handler) {
            const requiredScope = getRequiredScope(name);
            const hasDeclaredInput = config.inputSchema !== undefined;
            const schemas = getCompiledSchemas(name, config);

            server.registerTool(
                name,
                {
                    title: config.title,
                    description: config.description,
                    ...schemas,
                    annotations: config.annotations,
                },
                async (args, ctx) => {
                    const startedAt = performance.now();
                    const authKind = ctx.http?.authInfo?.extra?.authKind;
                    const denied = authorizeMcpTool(name, ctx);
                    if (denied) {
                        logger.warn(
                            {
                                tool: name,
                                requiredScope,
                                authKind,
                                scopeDecision: "denied",
                            },
                            "MCP tool authorization denied",
                        );
                        return denied;
                    }

                    try {
                        const result = await (hasDeclaredInput
                            ? handler(args, ctx)
                            : handler(ctx));
                        logger.info(
                            {
                                tool: name,
                                requiredScope,
                                authKind,
                                scopeDecision: "allowed",
                                outcome: result?.isError
                                    ? "tool_error"
                                    : "success",
                                durationMs: Math.round(
                                    performance.now() - startedAt,
                                ),
                            },
                            "MCP tool completed",
                        );
                        return result;
                    } catch (error) {
                        logger.error(
                            {
                                tool: name,
                                requiredScope,
                                authKind,
                                scopeDecision: "allowed",
                                outcome: "exception",
                                durationMs: Math.round(
                                    performance.now() - startedAt,
                                ),
                                errorType:
                                    error instanceof Error
                                        ? error.name
                                        : typeof error,
                            },
                            "MCP tool failed",
                        );
                        throw error;
                    }
                },
            );
        },
    };
}
