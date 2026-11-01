import { AsyncLocalStorage } from "node:async_hooks";
import type { McpToolDefinition } from "@codelitdev/mcp-server-kit";
import {
  type AuthenticationResult,
  createPlatformError,
  type HeaderMap,
  type PlatformError,
} from "@codelitdev/platform";
import { resolveUserTeam } from "../auth/require-team";
import { type AuthResult, resolveAuth } from "../auth/resolve-auth";
import type { User } from "../user/queries";

/** What every SendLit MCP tool runs with. */
export type SendLitMcpContext = {
  authKind: "oauth" | "team_key";
  /** Internal team id, resolved like REST's `requireTeam`. */
  teamId: string;
  /** The signed-in person for OAuth; `null` for a team API key. */
  user: User | null;
  /** OAuth scopes granted to the token; empty for a team API key. */
  scopes: readonly string[];
  requestId: string;
};

export type SendLitMcpTool = McpToolDefinition<SendLitMcpContext>;

/** The kit hands `resolveContext` a principal id and credential only, so the
 * full auth result is kept for the request's duration here. */
const authByRequest = new AsyncLocalStorage<{ auth?: AuthResult }>();

export function runMcpRequest<T>(handle: () => Promise<T>): Promise<T> {
  return authByRequest.run({}, handle);
}

function headerValue(headers: HeaderMap, name: string): string | undefined {
  const value = headers[name];
  return Array.isArray(value) ? value[0] : value;
}

/** MCP accepts an OAuth bearer token or a team API key (sent as
 * `x-sendlit-apikey`, or `X-API-Key`, which the route aliases). */
export async function authenticateMcpRequest(
  headers: HeaderMap,
): Promise<AuthenticationResult<string>> {
  // `resolveAuth` reads `Authorization` and `X-API-Key` from the headers
  // itself; passing the key again would count it twice (ambiguous).
  const auth = await resolveAuth({
    headers: headers as Record<string, string | string[] | undefined>,
    transport: "mcp",
  });
  const store = authByRequest.getStore();
  if (store) store.auth = auth;

  switch (auth.status) {
    case "authenticated":
      if (auth.kind === "oauth") {
        return {
          kind: "authenticated",
          principalId: auth.userId,
          credential: {
            kind: "oauth",
            credentialId: auth.clientId,
            scopes: auth.scopes,
          },
        };
      }
      if (auth.kind === "team_key") {
        return {
          kind: "authenticated",
          principalId: `team-key:${auth.apiKeyId}`,
          credential: { kind: "api_key", credentialId: auth.apiKeyId },
        };
      }
      // MCP is team-scoped: organization keys and dashboard sessions are
      // not MCP credentials.
      return {
        kind: "rejected",
        error: createPlatformError("unauthenticated", {
          safeDetails: { reason: "credential_not_allowed" },
        }),
      };
    case "missing":
      return { kind: "absent" };
    case "ambiguous":
      return { kind: "rejected", error: createPlatformError("credential_ambiguous") };
    case "unavailable":
      return { kind: "rejected", error: createPlatformError("internal_error") };
    default:
      return { kind: "rejected", error: createPlatformError("unauthenticated") };
  }
}

const TEAM_ERRORS: Record<string, PlatformError> = {
  invalid_team_id: createPlatformError("validation_failed", {
    safeDetails: { reason: "invalid_team_id" },
  }),
  not_a_team_member: createPlatformError("tenant_forbidden"),
  no_team: createPlatformError("tenant_required", {
    safeDetails: { reason: "no_team" },
  }),
  team_required: createPlatformError("tenant_required", {
    safeDetails: {
      reason: "team_required",
      message: "Pick a team on the OAuth consent screen or send X-Sendlit-Team-Id.",
    },
  }),
};

export async function resolveMcpContext({
  headers,
}: {
  headers: HeaderMap;
}): Promise<
  { ok: true; context: SendLitMcpContext } | { ok: false; error: PlatformError }
> {
  const auth = authByRequest.getStore()?.auth;
  if (auth?.status !== "authenticated") {
    return { ok: false, error: createPlatformError("unauthenticated") };
  }

  let teamId: string;
  if (auth.kind === "team_key") {
    teamId = auth.teamId;
  } else if (auth.kind === "oauth") {
    if (auth.teamId) {
      teamId = auth.teamId;
    } else {
      const resolved = await resolveUserTeam(auth.userId, headers["x-sendlit-team-id"]);
      if (!resolved.ok) return { ok: false, error: TEAM_ERRORS[resolved.error] };
      teamId = resolved.teamId;
    }
  } else {
    return { ok: false, error: createPlatformError("unauthenticated") };
  }

  return {
    ok: true,
    context: {
      authKind: auth.kind,
      teamId,
      user: auth.user,
      scopes: auth.kind === "oauth" ? auth.scopes : [],
      requestId: headerValue(headers, "x-request-id") ?? "",
    },
  };
}
