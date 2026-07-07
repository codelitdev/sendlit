import { NextFunction, Request, Response } from "express";
import {
    getTeamByTeamId,
    getTeamMembership,
    listTeamsForAccount,
} from "../team/queries";

function getHeaderValue(value: unknown): string | undefined {
    if (Array.isArray(value)) {
        return typeof value[0] === "string" ? value[0] : undefined;
    }
    return typeof value === "string" ? value : undefined;
}

/**
 * Resolves `req.teamId` — the one thing every resource route actually needs.
 * Must run after `requireAuth`/`mcpAuth`.
 *
 * - API-key requests already have `req.teamId` set by `auth/middleware.ts`
 *   (a key authenticates as exactly one, fixed team) — this is a no-op for them.
 * - User-authenticated requests pick a team via the `X-Sendlit-Team-Id`
 *   header, validated against team membership on every call — this is what
 *   lets the web dashboard switch teams instantly, without re-authenticating.
 *   If the header is absent and the account belongs to exactly one team, that
 *   team is used automatically (the common case). Otherwise the caller must
 *   specify one explicitly.
 */
export async function requireTeam(
    req: Request,
    res: Response,
    next: NextFunction,
): Promise<void> {
    const anyReq = req as any;
    if (anyReq.teamId) return next();
    if (!anyReq.accountId) {
        res.status(401).json({ error: "unauthorized" });
        return;
    }

    const headerTeamId = getHeaderValue(req.headers["x-sendlit-team-id"]);
    if (headerTeamId) {
        const team = await getTeamByTeamId(headerTeamId);
        if (!team) {
            res.status(400).json({
                error: "invalid_team_id",
                error_description: "The provided team ID is not valid.",
            });
            return;
        }
        let membership;
        try {
            membership = await getTeamMembership(team.id, anyReq.accountId);
        } catch {
            res.status(400).json({
                error: "invalid_team_id",
                error_description: "The provided team ID is not valid.",
            });
            return;
        }
        if (!membership) {
            res.status(403).json({
                error: "not_a_team_member",
                error_description: "You are not a member of this team.",
            });
            return;
        }
        anyReq.teamId = team.id;
        return next();
    }

    const teams = await listTeamsForAccount(anyReq.accountId);
    if (teams.length === 1) {
        anyReq.teamId = teams[0].id;
        return next();
    }
    if (teams.length === 0) {
        res.status(409).json({
            error: "no_team",
            error_description: "This account doesn't belong to any team yet.",
        });
        return;
    }

    res.status(409).json({
        error: "team_required",
        error_description:
            "This account belongs to multiple teams — specify one via the X-Sendlit-Team-Id header.",
        teams: teams.map((t) => ({ teamId: t.teamId, name: t.name })),
    });
}
