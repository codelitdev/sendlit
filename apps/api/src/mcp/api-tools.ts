import { createServer, type RequestListener } from "node:http";
import type { AddressInfo } from "node:net";
import { createPlatformError, type PlatformErrorCode } from "@codelitdev/platform";
import { contract, MCP_API_TOOLS, mcpParityManifest } from "@sendlit/api-contract";
import { openApiDocument } from "@sendlit/api-contract/openapi";
import { z } from "zod";
import logger from "../services/log";
import type { SendLitMcpContext, SendLitMcpTool } from "./context";
import { authorizeMcpOperation, getRequiredScope } from "./policy";
import { toolError } from "./tools/responses";

type ApiRisk = keyof typeof MCP_API_TOOLS;

type ApiOperation = {
  operationId: string;
  method: string;
  path: string;
  risk: ApiRisk;
  tool: string;
};

type ContractRoute = { method: string; path: string };

type OpenApiOperation = {
  summary?: string;
  tags?: string[];
  parameters?: Array<{
    name: string;
    in: string;
    required?: boolean;
    schema?: unknown;
  }>;
  requestBody?: { content?: Record<string, { schema?: unknown }> };
  responses?: Record<string, { content?: Record<string, { schema?: unknown }> }>;
};

/** Every ts-rest route, keyed by its dotted router-key operation id. */
function contractRoutes(
  router: object,
  prefix: string[] = [],
): Map<string, ContractRoute> {
  const routes = new Map<string, ContractRoute>();
  for (const [key, value] of Object.entries(router)) {
    if (!value || typeof value !== "object") continue;
    const route = value as Partial<ContractRoute>;
    if (typeof route.method === "string" && typeof route.path === "string") {
      routes.set([...prefix, key].join("."), {
        method: route.method.toUpperCase(),
        path: route.path,
      });
    } else {
      for (const entry of contractRoutes(value, [...prefix, key])) routes.set(...entry);
    }
  }
  return routes;
}

const ROUTES = contractRoutes(contract);

const API_TOOL_RISK = new Map(
  (Object.entries(MCP_API_TOOLS) as Array<[ApiRisk, string]>).map(([risk, tool]) => [
    tool,
    risk,
  ]),
);

/**
 * REST operations the parity manifest routes to a generic `api.*` tool.
 * Operations with a dedicated tool, and REST-only operations (billing,
 * organization administration, account deletion), are not here.
 */
export const MCP_API_OPERATIONS: ReadonlyMap<string, ApiOperation> = new Map(
  mcpParityManifest.flatMap((entry) => {
    if (entry.parity !== "required") return [];
    const risk = API_TOOL_RISK.get(entry.mcp.tool);
    const route = ROUTES.get(entry.rest.operationId);
    if (!risk || !route) return [];
    return [
      [
        entry.rest.operationId,
        { operationId: entry.rest.operationId, ...route, risk, tool: entry.mcp.tool },
      ] as const,
    ];
  }),
);

function openApiOperation(operation: ApiOperation): OpenApiOperation | undefined {
  const paths = (
    openApiDocument as { paths: Record<string, Record<string, OpenApiOperation>> }
  ).paths;
  const openApiPath = operation.path.replace(/:([A-Za-z0-9_]+)/g, "{$1}");
  return paths[openApiPath]?.[operation.method.toLowerCase()];
}

function pathPattern(path: string): RegExp {
  const escaped = path
    .split("/")
    .map((segment) =>
      segment.startsWith(":")
        ? "[^/]+"
        : segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
    )
    .join("/");
  return new RegExp(`^${escaped}$`);
}

/** Whether a concrete path reaches exactly this operation, so a parameter
 * value (`export` is its own route, not a contact id) can't re-route the call
 * to an operation the caller was not authorized for. A path without
 * parameters is the operation's own literal route. */
function reachesOnly(operation: ApiOperation, concretePath: string): boolean {
  if (!operation.path.includes(":")) return concretePath === operation.path;
  for (const [operationId, route] of ROUTES) {
    if (operationId === operation.operationId || route.method !== operation.method)
      continue;
    if (pathPattern(route.path).test(concretePath)) return false;
  }
  return pathPattern(operation.path).test(concretePath);
}

function unknownOperation(operationId: string) {
  return toolError("validation_failed", { reason: "unknown_operation", operationId });
}

const STATUS_CODES: Record<number, PlatformErrorCode> = {
  400: "validation_failed",
  401: "unauthenticated",
  402: "forbidden",
  403: "forbidden",
  404: "not_found",
  409: "conflict",
  413: "validation_failed",
  415: "validation_failed",
  422: "validation_failed",
  429: "rate_limited",
};

/** A REST error body (`{ error, error_description, ... }`) as a tool error:
 * the REST code becomes `reason`, its description `message`, and other
 * primitive fields (limits, upgrade URLs) are kept. */
function restError(status: number, body: unknown) {
  const code =
    STATUS_CODES[status] ?? (status >= 500 ? "internal_error" : "validation_failed");
  const details: Record<string, string | number | boolean | null> = {};
  if (body && typeof body === "object" && !Array.isArray(body)) {
    for (const [key, value] of Object.entries(body)) {
      if (value !== null && !["string", "number", "boolean"].includes(typeof value))
        continue;
      if (key === "error") details.reason = value as string;
      else if (key === "error_description") details.message = value as string;
      else details[key] = value as string | number | boolean | null;
    }
    // ts-rest's request validation answers `{ name: "ZodError", issues }`;
    // the issues are what tell the model which fields to fix.
    const issues = (body as { issues?: unknown }).issues;
    if (Array.isArray(issues) && issues.length > 0) {
      delete details.name;
      details.reason ??= "invalid_request";
      details.message ??= issues
        .slice(0, 10)
        .map((issue: { path?: unknown[]; message?: unknown }) => {
          const path = Array.isArray(issue.path) ? issue.path.join(".") : "";
          return path ? `${path}: ${String(issue.message)}` : String(issue.message);
        })
        .join("; ");
    }
  }
  if (code === "internal_error") return { error: createPlatformError(code) };
  return toolError(code, Object.keys(details).length ? details : undefined);
}

const queryValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.array(z.string()),
]);

const callInputShape = {
  operationId: z.string().min(1).describe("An operationId from api.list_operations."),
  pathParams: z
    .record(z.string())
    .optional()
    .describe("Values for the operation's path parameters, e.g. { espId: 'esp_…' }."),
  query: z
    .record(queryValueSchema)
    .optional()
    .describe("Query-string parameters, as listed by api.describe_operation."),
};

const bodySchema = z.object({}).passthrough();

type CallInput = {
  operationId: string;
  pathParams?: Record<string, string>;
  query?: Record<string, z.infer<typeof queryValueSchema>>;
  body?: unknown;
};

export type ApiToolDeps = {
  /** The SendLit HTTP app that serves each generic call. */
  app: () => RequestListener;
};

const loopbackOrigins = new WeakMap<RequestListener, Promise<string>>();

/**
 * A loopback-only listener for the same app, so a generic call is a real
 * REST request through every middleware and route, without leaving the host
 * or going through the public load balancer. Started on first use; it does
 * not keep the process alive.
 */
function loopbackOrigin(app: RequestListener): Promise<string> {
  let origin = loopbackOrigins.get(app);
  if (!origin) {
    origin = new Promise<string>((resolve, reject) => {
      const server = createServer(app);
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        server.unref();
        resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
      });
    });
    origin.catch(() => loopbackOrigins.delete(app));
    loopbackOrigins.set(app, origin);
  }
  return origin;
}

async function callOperation(
  deps: ApiToolDeps,
  context: SendLitMcpContext,
  tool: string,
  input: CallInput,
  signal: AbortSignal,
): Promise<unknown> {
  const operation = MCP_API_OPERATIONS.get(input.operationId);
  if (!operation) return unknownOperation(input.operationId);
  if (operation.tool !== tool) {
    return toolError("validation_failed", {
      reason: "wrong_tool",
      useTool: operation.tool,
    });
  }
  const denied = authorizeMcpOperation(operation.operationId, context);
  if (denied) return { error: denied };

  let path = operation.path;
  for (const name of operation.path.match(/:([A-Za-z0-9_]+)/g) ?? []) {
    const value = input.pathParams?.[name.slice(1)];
    if (!value) {
      return toolError("validation_failed", {
        reason: "missing_path_param",
        param: name.slice(1),
      });
    }
    // `.` and `..` survive encoding and would be resolved away as path
    // segments, reaching another route.
    if (value === "." || value === "..") {
      return toolError("validation_failed", { reason: "invalid_path_param" });
    }
    path = path.replace(name, encodeURIComponent(value));
  }
  if (!reachesOnly(operation, path)) {
    return toolError("validation_failed", { reason: "invalid_path_param" });
  }

  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(input.query ?? {})) {
    for (const item of Array.isArray(value) ? value : [value]) {
      search.append(key, String(item));
    }
  }
  const query = search.toString();
  const startedAt = performance.now();
  const origin = await loopbackOrigin(deps.app());
  const response = await fetch(`${origin}${path}${query ? `?${query}` : ""}`, {
    method: operation.method,
    headers: {
      ...context.replayHeaders,
      "content-type": "application/json",
      ...(context.requestId ? { "x-request-id": context.requestId } : {}),
      // With `trust proxy` on, REST sees (and rate limits) the MCP caller's
      // IP, not this loopback hop.
      ...(context.clientIp ? { "x-forwarded-for": context.clientIp } : {}),
    },
    body: operation.method === "GET" ? undefined : JSON.stringify(input.body ?? {}),
    redirect: "manual",
    signal,
  });
  const text = await response.text();
  logger.info(
    {
      tool,
      operationId: operation.operationId,
      requiredScope: getRequiredScope(operation.operationId),
      authKind: context.authKind,
      statusCode: response.status,
      durationMs: Math.round(performance.now() - startedAt),
    },
    "MCP api operation completed",
  );

  const contentType = response.headers.get("content-type") ?? "";
  const isJson = contentType.includes("application/json");
  let body: unknown;
  if (isJson && text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = undefined;
    }
  }
  if (response.status >= 400) return restError(response.status, body);
  if (response.status === 204 || !text) return { ok: true };
  if (!isJson) return { contentType, body: text };
  return Array.isArray(body) ? { items: body } : body;
}

const CALL_GUIDE =
  "Get the operationId from api.list_operations and its parameters and body from api.describe_operation. The call runs exactly as the REST API does, with the same validation, plan limits and errors, for the connected team.";

function callTool(
  deps: ApiToolDeps,
  risk: ApiRisk,
  description: string,
  inputSchema: z.ZodObject<z.ZodRawShape>,
): SendLitMcpTool {
  const tool = MCP_API_TOOLS[risk];
  return {
    name: tool,
    description,
    risk,
    inputSchema,
    handler: ({ context, args, signal }) =>
      callOperation(deps, context, tool, args as CallInput, signal),
  };
}

function describe(operation: ApiOperation, context: SendLitMcpContext) {
  const spec = openApiOperation(operation);
  return {
    operationId: operation.operationId,
    tool: operation.tool,
    method: operation.method,
    path: operation.path,
    summary: spec?.summary ?? null,
    group: spec?.tags?.[0] ?? null,
    requiredScope: getRequiredScope(operation.operationId),
    available: authorizeMcpOperation(operation.operationId, context) === null,
  };
}

/**
 * Generic access to every team REST operation the parity manifest routes to
 * MCP, beyond the dedicated tools. Calls run through SendLit's own REST
 * routes, so validation, plan limits and errors are the REST API's.
 */
export function apiTools(deps: ApiToolDeps): SendLitMcpTool[] {
  return [
    {
      name: "api.list_operations",
      description:
        "Lists the SendLit API operations this connection can run beyond the dedicated tools: sending providers (ESPs) and their delivery feedback, suppressions, sender reputation, the tracking domain, general and web settings, signup forms, media, tags, segments, templates, sequence and contact management (including deletes), event definitions, teams and API keys. Each item gives the tool that runs it (api.read, api.write or api.delete), the OAuth scope it needs and whether this connection may run it. Filter with search (matches the operation id, path, summary or group) or group.",
      risk: "read",
      inputSchema: z.object({
        search: z.string().max(100).optional(),
        group: z.string().max(100).optional(),
      }),
      annotations: { idempotentHint: true, openWorldHint: false },
      async handler({ context, args }) {
        const { search, group } = args as { search?: string; group?: string };
        const needle = search?.trim().toLowerCase();
        const items = [...MCP_API_OPERATIONS.values()]
          .map((operation) => describe(operation, context))
          .filter(
            (item) =>
              !group || item.group?.toLowerCase() === group.trim().toLowerCase(),
          )
          .filter(
            (item) =>
              !needle ||
              [item.operationId, item.path, item.summary ?? "", item.group ?? ""].some(
                (text) => text.toLowerCase().includes(needle),
              ),
          );
        return { items };
      },
    },
    {
      name: "api.describe_operation",
      description:
        "Describes one operation from api.list_operations: its path and query parameters, the JSON Schema of its request body, and the schema of a successful response.",
      risk: "read",
      inputSchema: z.object({ operationId: z.string().min(1) }),
      annotations: { idempotentHint: true, openWorldHint: false },
      async handler({ context, args }) {
        const { operationId } = args as { operationId: string };
        const operation = MCP_API_OPERATIONS.get(operationId);
        if (!operation) return unknownOperation(operationId);
        const spec = openApiOperation(operation);
        const success = Object.entries(spec?.responses ?? {}).find(([status]) =>
          status.startsWith("2"),
        );
        return {
          ...describe(operation, context),
          pathParams: (spec?.parameters ?? []).filter((param) => param.in === "path"),
          query: (spec?.parameters ?? []).filter((param) => param.in === "query"),
          body: spec?.requestBody?.content?.["application/json"]?.schema ?? null,
          response: success
            ? {
                status: Number(success[0]),
                schema: success[1].content?.["application/json"]?.schema ?? null,
              }
            : null,
        };
      },
    },
    callTool(
      deps,
      "read",
      `Runs a read-only SendLit API operation (GET). ${CALL_GUIDE}`,
      z.object(callInputShape),
    ),
    callTool(
      deps,
      "write",
      `Runs a SendLit API operation that creates or changes data, or has an external effect such as testing an ESP. Pass the JSON request body in body. ${CALL_GUIDE} Repeating a create usually makes a duplicate or fails with conflict, so read before retrying.`,
      z.object({
        ...callInputShape,
        body: bodySchema.optional().describe("The JSON request body."),
      }),
    ),
    callTool(
      deps,
      "destructive",
      `Runs a SendLit API operation that deletes or permanently disables something (deleting contacts, templates, sequences, ESPs or API keys, retiring an ESP, disconnecting reputation sources). It can't be undone: confirm the target with the user first and pass confirm: true. ${CALL_GUIDE}`,
      z.object({
        ...callInputShape,
        body: bodySchema
          .optional()
          .describe("The JSON request body, if the operation takes one."),
        confirm: z.boolean().optional(),
      }),
    ),
  ];
}
