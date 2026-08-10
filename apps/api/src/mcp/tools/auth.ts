import type { ServerContext } from "@modelcontextprotocol/server";
import type { User } from "../../user/queries";
import { getSendLitMcpAuthInfo } from "../auth-context";

/** The team id is explicit tenant context and is never overloaded into the
 * OAuth `clientId`. It is attached after credential and team verification. */
export function getTeamId(ctx: ServerContext): string | null {
    return getSendLitMcpAuthInfo(ctx)?.extra.teamId ?? null;
}

/** The logged-in human, when authenticated as a user — `null` for API-key
 * sessions (a key has no single owning account; a team can have several
 * members). Only used for cosmetic fallbacks (e.g. "send the test email to
 * me"), never for authorization. */
export function getAuthUser(ctx: ServerContext): User | null {
    return getSendLitMcpAuthInfo(ctx)?.extra.user ?? null;
}
