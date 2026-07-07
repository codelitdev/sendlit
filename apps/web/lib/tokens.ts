/** Which team the dashboard is currently "in" — forwarded as the
 * `X-Sendlit-Team-Id` header by the BFF proxy so the API can resolve
 * `req.teamId` for this session (see `apps/api/src/auth/require-team.ts`).
 * Not a secret; just a stable selection, re-validated against team
 * membership by the API on every request. */
export const TEAM_ID_COOKIE = "sendlit_team_id";

export function getTeamIdFromCookie(): string | null {
    if (typeof document === "undefined") return null;
    const match = document.cookie.match(
        new RegExp(`(?:^|;\\s*)${TEAM_ID_COOKIE}=([^;]+)`),
    );
    return match ? decodeURIComponent(match[1]) : null;
}

/** Clears a stale team selection (team deleted, or this account isn't/no
 * longer a member of it) so the next request falls back to auto-resolution
 * instead of repeatedly failing against a team this browser can't use. */
export function clearTeamIdCookie(): void {
    if (typeof document === "undefined") return;
    document.cookie = `${TEAM_ID_COOKIE}=; Max-Age=0; path=/`;
}

/** True for API error responses that mean "the caller must pick/has no valid
 * team": an account with several teams and no selection, or a
 * `sendlit_team_id` cookie the API rejected. Shared by both HTTP clients
 * (`api.ts`'s ts-rest client and `api-client.ts`'s plain fetch client) so
 * recovery behaves identically everywhere. */
export function needsTeamSelection(status: number, error?: string): boolean {
    return (
        status === 409 ||
        (status === 400 && error === "invalid_team_id") ||
        (status === 403 && error === "not_a_team_member")
    );
}

/** Whether that error means the cookie itself is stale (as opposed to just
 * "no team picked yet") and should be cleared rather than reused. */
export function isStaleTeamSelectionError(error?: string): boolean {
    return error === "invalid_team_id" || error === "not_a_team_member";
}

/** Resolves which team the dashboard should treat as "current": the
 * cookie's team if the account still belongs to it, else its sole team, or
 * `null` if it has none/several and no valid selection. Clears the cookie as
 * a side effect when it's stale (pointing at a team this browser no longer
 * has access to), so the displayed team and the one actually sent to the API
 * never disagree. */
export function resolveCurrentTeamId(
    teams: { teamId: string }[],
): string | null {
    const cookieTeamId = getTeamIdFromCookie();
    const cookieIsValid =
        !!cookieTeamId && teams.some((team) => team.teamId === cookieTeamId);
    if (cookieTeamId && !cookieIsValid) {
        clearTeamIdCookie();
    }
    if (cookieIsValid) return cookieTeamId;
    return teams.length === 1 ? teams[0].teamId : null;
}
