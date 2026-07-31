/** Which team the dashboard is currently "in" — forwarded as the
 * `X-Sendlit-Team-Id` header by the BFF proxy so the API can resolve
 * `req.teamId` for this session (see `apps/api/src/auth/require-team.ts`).
 * Not a secret; just a stable selection, re-validated against team
 * membership by the API on every request. */
export const TEAM_ID_COOKIE = "sendlit_team_id";
export const ORGANIZATION_ID_COOKIE = "sendlit_organization_id";
export const ORGANIZATION_CONTEXT_CHANGED =
    "sendlit:organization-context-changed";
export const TEAMS_CHANGED = "sendlit:teams-changed";

function getCookie(name: string): string | null {
    if (typeof document === "undefined") return null;
    const match = document.cookie.match(
        new RegExp(`(?:^|;\\s*)${name}=([^;]+)`),
    );
    return match ? decodeURIComponent(match[1]) : null;
}

function setCookie(name: string, value: string): void {
    if (typeof document === "undefined") return;
    document.cookie = `${name}=${encodeURIComponent(value)}; path=/; SameSite=Lax`;
}

export function getTeamIdFromCookie(): string | null {
    return getCookie(TEAM_ID_COOKIE);
}

/** The selected organization is UI context, not an authorization grant. The
 * API independently verifies organization and team membership on every call. */
export function getOrganizationIdFromCookie(): string | null {
    return getCookie(ORGANIZATION_ID_COOKIE);
}

export function setOrganizationIdCookie(organizationId: string): void {
    setCookie(ORGANIZATION_ID_COOKIE, organizationId);
}

export function clearOrganizationIdCookie(): void {
    if (typeof document === "undefined") return;
    document.cookie = `${ORGANIZATION_ID_COOKIE}=; Max-Age=0; path=/`;
}

export function setTeamIdCookie(teamId: string): void {
    setCookie(TEAM_ID_COOKIE, teamId);
}

/** Clears a stale team selection (team deleted, or this account isn't/no
 * longer a member of it) so the next request falls back to auto-resolution
 * instead of repeatedly failing against a team this browser can't use. */
export function clearTeamIdCookie(): void {
    if (typeof document === "undefined") return;
    document.cookie = `${TEAM_ID_COOKIE}=; Max-Age=0; path=/`;
}

export type OrganizationScopedTeam = {
    teamId: string;
    organizationId?: string;
};

/** Select the persisted organization when it has teams the user can access;
 * otherwise derive a safe initial workspace from the currently selected team
 * or the first available team. */
export function resolveCurrentOrganizationId(
    teams: OrganizationScopedTeam[],
    organizations: { organizationId: string }[] = [],
): string | null {
    const cookieOrganizationId = getOrganizationIdFromCookie();
    // An organization can deliberately have no teams yet. Keep that selected
    // context rather than silently falling back to a different organization,
    // but never retain an organization the signed-in user cannot access.
    if (
        cookieOrganizationId &&
        (organizations.length === 0 ||
            organizations.some(
                (organization) =>
                    organization.organizationId === cookieOrganizationId,
            ))
    ) {
        return cookieOrganizationId;
    }
    const currentTeamId = getTeamIdFromCookie();
    const currentTeam = teams.find((team) => team.teamId === currentTeamId);
    return (
        currentTeam?.organizationId ??
        teams[0]?.organizationId ??
        organizations[0]?.organizationId ??
        null
    );
}

/** Resolve a usable team strictly inside the selected organization. It never
 * leaves a previously selected team from another organization active. */
export function resolveCurrentTeamIdForOrganization(
    teams: OrganizationScopedTeam[],
    organizationId: string | null,
): string | null {
    const scopedTeams = organizationId
        ? teams.filter((team) => team.organizationId === organizationId)
        : [];
    const currentTeamId = getTeamIdFromCookie();
    if (
        currentTeamId &&
        scopedTeams.some((team) => team.teamId === currentTeamId)
    ) {
        return currentTeamId;
    }
    return scopedTeams[0]?.teamId ?? null;
}

/** Publish an organization switch to the dashboard shell. Keeping this in a
 * small browser-only helper avoids treating organization choice as authority. */
export function selectOrganizationContext(organizationId: string): void {
    setOrganizationIdCookie(organizationId);
    if (typeof window !== "undefined") {
        window.dispatchEvent(
            new CustomEvent(ORGANIZATION_CONTEXT_CHANGED, {
                detail: organizationId,
            }),
        );
    }
}

/** Notify the persistent dashboard shell that the signed-in user's accessible
 * team list changed (for example, after creating a human-managed team). */
export function notifyTeamsChanged(): void {
    if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent(TEAMS_CHANGED));
    }
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
