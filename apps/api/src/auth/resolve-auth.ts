import { validateBearerToken } from "../oauth/middleware";
import { getAccount, Account } from "../account/queries";
import { getApiKeyUsingKeyId, ApiKey } from "../apikey/queries";

type OAuthClaims = {
  accountId: string;
  clientId: string;
  scopes: string[];
};

export type AuthInput = {
  authorization?: unknown;
  apiKeyHeader?: unknown;
  bodyApiKey?: unknown;
};

export type AuthDependencies = {
  validateBearerToken: (bearer: string) => Promise<OAuthClaims | null>;
  getAccount: (id: string) => Promise<Account | null>;
  getApiKeyUsingKeyId: (key: string) => Promise<ApiKey | null>;
};

export type AuthResult =
  | {
      status: "authenticated";
      kind: "oauth";
      account: Account;
      accountId: string;
      clientId: string;
      scopes: string[];
      /** Not resolved here — an OAuth-authenticated account may belong to
       * several teams. See `auth/require-team.ts`, which resolves it from
       * an explicit header (falling back to the account's sole team, if
       * it only has one). */
      teamId?: undefined;
    }
  | {
      status: "authenticated";
      kind: "apikey";
      /** A key has no single owning account any more (a team can have
       * several members) — `account` is only ever populated for OAuth. */
      account: null;
      accountId?: undefined;
      apiKey: string;
      /** A key always authenticates as exactly one, fixed team. */
      teamId: string;
    }
  | { status: "invalid_token" }
  | { status: "unauthorized" }
  | { status: "missing" };

export function sendAuthError(res: any, auth: AuthResult): boolean {
  if (auth.status === "invalid_token") {
    res.status(401).json({
      error: "invalid_token",
      error_description: "Access token is invalid or expired",
    });
    return true;
  }

  if (auth.status === "missing") {
    res.status(401).json({
      error: "unauthorized",
      error_description:
        "Missing authentication: provide Authorization: Bearer <token> or x-sendlit-apikey header",
    });
    return true;
  }

  if (auth.status === "unauthorized") {
    res.status(401).json({ error: "unauthorized" });
    return true;
  }

  return false;
}

const defaultDependencies: AuthDependencies = {
  validateBearerToken,
  getAccount,
  getApiKeyUsingKeyId,
};

function getHeaderValue(value: unknown): string | undefined {
  if (Array.isArray(value)) {
    return typeof value[0] === "string" ? value[0] : undefined;
  }
  return typeof value === "string" ? value : undefined;
}

export async function resolveAuth(
  input: AuthInput,
  dependencies: AuthDependencies = defaultDependencies,
): Promise<AuthResult> {
  const authorization = getHeaderValue(input.authorization);
  if (authorization) {
    const match = authorization.match(/^Bearer (.+)$/i);
    if (match) {
      const claims = await dependencies.validateBearerToken(match[1]);
      if (!claims) return { status: "invalid_token" };

      const account = await dependencies.getAccount(claims.accountId);
      if (!account) return { status: "unauthorized" };

      return {
        status: "authenticated",
        kind: "oauth",
        account,
        accountId: claims.accountId,
        clientId: claims.clientId,
        scopes: claims.scopes,
      };
    }
  }

  const submittedApiKey =
    getHeaderValue(input.bodyApiKey) || getHeaderValue(input.apiKeyHeader);
  if (!submittedApiKey) return { status: "missing" };

  const apiKey = await dependencies.getApiKeyUsingKeyId(submittedApiKey);
  if (!apiKey) return { status: "unauthorized" };

  return {
    status: "authenticated",
    kind: "apikey",
    account: null,
    apiKey: submittedApiKey,
    teamId: apiKey.teamId,
  };
}
