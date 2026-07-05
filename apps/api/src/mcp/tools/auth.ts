import type { Account } from "../../account/queries";

/** MCP tool handlers receive the resolved team id via `extra.authInfo.clientId`
 * (see `mcp/routes.ts`'s `getMcpAuth`, populated by `auth/middleware.ts` +
 * `auth/require-team.ts`). A key always resolves to exactly one team; an
 * OAuth-authenticated session resolves to its sole team if the account only
 * has one, otherwise the connection is rejected (see `mcp/routes.ts`). */
export function getTeamId(extra: any): string | null {
    return extra?.authInfo?.clientId || null;
}

/** The logged-in human, when authenticated via OAuth — `null` for API-key
 * sessions (a key has no single owning account; a team can have several
 * members). Only used for cosmetic fallbacks (e.g. "send the test email to
 * me"), never for authorization. */
export function getAuthAccount(extra: any): Account | null {
    return extra?.authInfo?.account || null;
}
