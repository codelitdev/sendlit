import type { NextFunction, Request, Response } from "express";
import { getTeamByTeamId, getTeamMembership, listTeamsForUser } from "../team/queries";

function getHeaderValue(value: unknown): string | undefined {
  if (Array.isArray(value)) {
    return typeof value[0] === "string" ? value[0] : undefined;
  }
  return typeof value === "string" ? value : undefined;
}

export type UserTeamResolution =
  | { ok: true; teamId: string }
  | {
      ok: false;
      status: number;
      error: "invalid_team_id" | "not_a_team_member" | "no_team" | "team_required";
      body: Record<string, unknown>;
    };

/**
 * The team a user-authenticated request acts on: the `X-Sendlit-Team-Id`
 * header, validated against team membership on every call (so the dashboard
 * can switch teams without re-authenticating), or the user's only team when
 * the header is absent. Shared by REST (`requireTeam`) and MCP.
 */
export async function resolveUserTeam(
  userId: string,
  headerTeamIdValue: unknown,
): Promise<UserTeamResolution> {
  const headerTeamId = getHeaderValue(headerTeamIdValue);
  if (headerTeamId) {
    const invalid = {
      ok: false as const,
      status: 400,
      error: "invalid_team_id" as const,
      body: {
        error: "invalid_team_id",
        error_description: "The provided team ID is not valid.",
      },
    };
    const team = await getTeamByTeamId(headerTeamId);
    if (!team) return invalid;
    let membership: Awaited<ReturnType<typeof getTeamMembership>>;
    try {
      membership = await getTeamMembership(team.id, userId);
    } catch {
      return invalid;
    }
    if (!membership) {
      return {
        ok: false,
        status: 403,
        error: "not_a_team_member",
        body: {
          error: "not_a_team_member",
          error_description: "You are not a member of this team.",
        },
      };
    }
    return { ok: true, teamId: team.id };
  }

  const teams = await listTeamsForUser(userId);
  if (teams.length === 1) return { ok: true, teamId: teams[0].id };
  if (teams.length === 0) {
    return {
      ok: false,
      status: 409,
      error: "no_team",
      body: {
        error: "no_team",
        error_description: "This user doesn't belong to any team yet.",
      },
    };
  }
  return {
    ok: false,
    status: 409,
    error: "team_required",
    body: {
      error: "team_required",
      error_description:
        "This user belongs to multiple teams — specify one via the X-Sendlit-Team-Id header.",
      teams: teams.map((t) => ({ teamId: t.teamId, name: t.name })),
    },
  };
}

/**
 * Resolves `req.teamId` — the one thing every resource route actually needs.
 * Must run after `requireAuth`.
 *
 * - API-key requests already have `req.teamId` set by `auth/middleware.ts`
 *   (a key authenticates as exactly one, fixed team) — this is a no-op for them.
 * - User-authenticated requests resolve it with `resolveUserTeam`.
 */
export async function requireTeam(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const anyReq = req as any;
  if (anyReq.teamId) return next();
  if (!anyReq.userId) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }

  const resolved = await resolveUserTeam(
    anyReq.userId,
    req.headers["x-sendlit-team-id"],
  );
  if (!resolved.ok) {
    res.status(resolved.status).json(resolved.body);
    return;
  }
  anyReq.teamId = resolved.teamId;
  next();
}
