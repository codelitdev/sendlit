/** The caller as the team-authority checks see it. REST requests and MCP
 * contexts both reduce to this, so one rule governs both surfaces. */
export type TeamCaller = {
  authKind?: string;
  teamId: string;
  userId?: string | null;
};

/** Team admins and team API keys (a key is already the team's own
 * credential). A plain member is not enough. */
export async function isTeamAdminOrKey(caller: TeamCaller): Promise<boolean> {
  if (caller.authKind === "team_key") return true;
  if (!caller.userId) return false;
  // Loaded here, not at the top: every MCP tool imports the policy, and the
  // team and delivery queries pull in the database and billing, which most
  // tool tests don't need.
  const { getTeamMembership } = await import("./queries");
  const membership = await getTeamMembership(caller.teamId, caller.userId);
  return membership?.role === "admin";
}

/** Changing the team's own ESP: a team admin or key, and only while the
 * organization lets the team manage its own ESP. */
export async function canManageTeamEsp(caller: TeamCaller): Promise<boolean> {
  const { getTeamDeliverySetting } = await import("../delivery/queries");
  const delivery = await getTeamDeliverySetting(caller.teamId);
  if (!delivery?.teamEspEnabled) return false;
  return isTeamAdminOrKey(caller);
}
