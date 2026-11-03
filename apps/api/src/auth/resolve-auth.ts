import {
  type AuthenticatedIdentity,
  type AuthenticationResult,
  verifyOAuthAccessToken,
} from "@codelitdev/oauth-server-kit";
import { resolveBetterAuthSession } from "@codelitdev/oauth-server-kit/better-auth";
import {
  extractHttpCredentials,
  extractMcpCredentials,
  type HeaderMap,
  type PresentedCredential,
  selectSingleCredential,
} from "@codelitdev/platform";
import { fromNodeHeaders } from "better-auth/node";
import {
  type ApiKey,
  getApiKeyBySecret,
  getOrganizationApiKeyBySecret,
  type OrganizationApiKey,
} from "../apikey/queries";
import { ensureDefaultOrganization } from "../organization/queries";
import { getTeamMembership } from "../team/queries";
import { getUser, type User } from "../user/queries";
import {
  auth,
  authIssuer,
  mcpResourceUrl,
  oauthResourceClient,
  SESSION_COOKIE_NAME,
  validOAuthAudiences,
} from "./better-auth";

export type AuthInput = {
  authorization?: unknown;
  apiKeyHeader?: unknown;
  bodyApiKey?: unknown;
  headers?: Record<string, string | string[] | undefined>;
  /** MCP accepts bearer tokens and API keys only; browser sessions are not
   * credentials there (and so never make an MCP request ambiguous). */
  transport?: "http" | "mcp";
};

export type AuthResult =
  | {
      status: "authenticated";
      kind: "oauth";
      identity: Extract<AuthenticatedIdentity, { method: "oauth" }>;
      user: User;
      userId: string;
      token: string;
      clientId: string;
      scopes: string[];
      teamId?: string;
    }
  | {
      status: "authenticated";
      kind: "session";
      identity: Extract<AuthenticatedIdentity, { method: "session" }>;
      user: User;
      userId: string;
      scopes: ["web"];
    }
  | {
      status: "authenticated";
      kind: "team_key";
      user: null;
      apiKeyId: string;
      teamId: string;
    }
  | {
      status: "authenticated";
      kind: "organization_key";
      user: null;
      organizationId: string;
      organizationApiKeyId: string;
      organizationScopes: string[];
    }
  | { status: "ambiguous" }
  | { status: "invalid_token" }
  | { status: "unauthorized" }
  | { status: "missing" }
  | { status: "unavailable" };

export type AuthDependencies = {
  getUser: (id: string) => Promise<User | null>;
  getApiKeyBySecret: (secret: string) => Promise<ApiKey | null>;
  getOrganizationApiKeyBySecret: (secret: string) => Promise<OrganizationApiKey | null>;
  resolveSession: (
    headers: Record<string, string | string[] | undefined>,
  ) => Promise<AuthenticationResult>;
  authenticateBearer: (token: string) => Promise<{
    identity: Extract<AuthenticatedIdentity, { method: "oauth" }>;
    teamId?: string;
  } | null>;
  ensureDefaultOrganization: (userId: string) => Promise<unknown | null>;
  getTeamMembership: (teamId: string, userId: string) => Promise<unknown | null>;
};

function headerValue(value: unknown): string | undefined {
  if (Array.isArray(value)) {
    return typeof value[0] === "string" ? value[0] : undefined;
  }
  return typeof value === "string" ? value : undefined;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/** The kit returns protocol identity only. SendLit's `team_id` claim (the team
 * picked on `/oauth/select-team`) is read from the token the kit has just
 * verified; membership is re-checked before it is trusted. */
function verifiedTeamClaim(token: string): string | undefined {
  const payload = token.split(".")[1];
  if (!payload) return undefined;
  try {
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return optionalString(claims?.team_id);
  } catch {
    return undefined;
  }
}

const ORGANIZATION_KEY_PREFIX = "sl_org_live_";

/**
 * Every credential the request presents, using the Platform kernel's
 * extraction (Better Auth session cookie, `Authorization: Bearer`,
 * `X-API-Key`) plus SendLit's own API-key locations. A bearer value with the
 * organization-key prefix is an API key, not an OAuth token.
 */
function presentedCredentials(input: AuthInput): PresentedCredential[] {
  const authorization = headerValue(input.authorization);
  const headers: HeaderMap = {
    ...(input.headers ?? {}),
    ...(authorization !== undefined ? { authorization } : {}),
  };
  const presented =
    input.transport === "mcp"
      ? extractMcpCredentials(headers)
      : extractHttpCredentials(headers, { sessionCookieName: SESSION_COOKIE_NAME });
  for (const value of [
    headerValue(input.apiKeyHeader),
    headerValue(input.bodyApiKey),
  ]) {
    if (value) presented.push({ kind: "api_key", secret: value });
  }
  return presented.map((credential) =>
    credential.kind === "oauth" && credential.secret.startsWith(ORGANIZATION_KEY_PREFIX)
      ? { kind: "api_key", secret: credential.secret }
      : credential,
  );
}

function hasMalformedAuthorization(authorization: string | undefined) {
  return (
    Boolean(authorization?.trim()) && !/^Bearer\s+\S+$/i.test(authorization!.trim())
  );
}

const defaultDependencies: AuthDependencies = {
  getUser,
  getApiKeyBySecret,
  getOrganizationApiKeyBySecret,
  async resolveSession(headers) {
    return resolveBetterAuthSession(
      { auth, issuer: authIssuer },
      fromNodeHeaders(headers),
    );
  },
  async authenticateBearer(token) {
    const result = await verifyOAuthAccessToken(
      {
        oauthResourceClient,
        issuer: authIssuer,
        audiences: validOAuthAudiences,
        resourceMetadataMappings: { mcp: mcpResourceUrl },
      },
      token,
    );
    if (result.status !== "authenticated" || result.identity.method !== "oauth") {
      return null;
    }
    return { identity: result.identity, teamId: verifiedTeamClaim(token) };
  },
  ensureDefaultOrganization,
  getTeamMembership,
};

/**
 * Resolves the single credential a request presents (Platform ADR 0001): more
 * than one is `ambiguous`, an invalid one is rejected, and nothing ever falls
 * back to another mechanism or to anonymous access.
 */
export async function resolveAuth(
  input: AuthInput,
  dependencies: AuthDependencies = defaultDependencies,
): Promise<AuthResult> {
  const authorization = headerValue(
    input.authorization ?? input.headers?.authorization,
  );
  if (hasMalformedAuthorization(authorization)) return { status: "invalid_token" };

  const selection = selectSingleCredential(presentedCredentials(input));
  if (selection.kind === "absent") return { status: "missing" };
  if (selection.kind !== "single") return { status: "ambiguous" };
  const credential = selection.credential;

  if (credential.kind === "api_key") {
    if (credential.secret.startsWith(ORGANIZATION_KEY_PREFIX)) {
      const organizationKey = await dependencies.getOrganizationApiKeyBySecret(
        credential.secret,
      );
      if (!organizationKey) return { status: "unauthorized" };
      return {
        status: "authenticated",
        kind: "organization_key",
        user: null,
        organizationId: organizationKey.organizationId,
        organizationApiKeyId: organizationKey.organizationApiKeyId,
        organizationScopes: organizationKey.scopes,
      };
    }
    const apiKey = await dependencies.getApiKeyBySecret(credential.secret);
    if (!apiKey) return { status: "unauthorized" };
    return {
      status: "authenticated",
      kind: "team_key",
      user: null,
      apiKeyId: apiKey.teamApiKeyId,
      teamId: apiKey.teamId,
    };
  }

  if (credential.kind === "oauth") {
    const token = credential.secret;
    const authenticated = await dependencies.authenticateBearer(token);
    if (!authenticated) return { status: "invalid_token" };
    const user = await dependencies.getUser(authenticated.identity.subject);
    // A deleted account's unexpired tokens stop working at once (#134).
    if (!user || user.deletedAt) return { status: "unauthorized" };
    if (!(await dependencies.ensureDefaultOrganization(user.id))) {
      return { status: "unauthorized" };
    }

    let teamId: string | undefined;
    if (
      authenticated.teamId &&
      (await dependencies.getTeamMembership(authenticated.teamId, user.id))
    ) {
      teamId = authenticated.teamId;
    }
    return {
      status: "authenticated",
      kind: "oauth",
      identity: authenticated.identity,
      user,
      userId: user.id,
      token,
      clientId: authenticated.identity.clientId,
      scopes: authenticated.identity.scopes,
      teamId,
    };
  }

  const session = await dependencies.resolveSession(input.headers ?? {});
  if (session.status === "unavailable") return { status: "unavailable" };
  if (session.status !== "authenticated" || session.identity.method !== "session") {
    return { status: "unauthorized" };
  }
  const user = await dependencies.getUser(session.identity.subject);
  if (!user || user.deletedAt) return { status: "unauthorized" };
  if (!(await dependencies.ensureDefaultOrganization(user.id))) {
    return { status: "unauthorized" };
  }
  return {
    status: "authenticated",
    kind: "session",
    identity: session.identity,
    user,
    userId: user.id,
    scopes: ["web"],
  };
}

export function sendAuthError(
  response: {
    setHeader(name: string, value: string): unknown;
    status(code: number): { json(body: unknown): unknown };
  },
  result: AuthResult,
  resourceMetadataUrl?: string,
): boolean {
  if (result.status === "authenticated") return false;
  if (result.status === "unavailable") {
    response.status(503).json({ error: "authentication_unavailable" });
    return true;
  }
  if (result.status === "ambiguous") {
    response.status(400).json({
      error: "credential_ambiguous",
      error_description:
        "Send exactly one credential: a session cookie, an Authorization bearer token, or an API key.",
    });
    return true;
  }
  if (resourceMetadataUrl) {
    response.setHeader(
      "WWW-Authenticate",
      `Bearer resource_metadata="${resourceMetadataUrl}"`,
    );
  }
  if (result.status === "invalid_token") {
    response.status(401).json({
      error: "invalid_token",
      error_description: "The access token is invalid or expired",
    });
    return true;
  }
  if (result.status === "missing") {
    response.status(401).json({
      error: "unauthorized",
      error_description:
        "Missing authentication: provide Authorization: Bearer <token> or x-sendlit-apikey header",
    });
    return true;
  }
  response.status(401).json({ error: "unauthorized" });
  return true;
}
