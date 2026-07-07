import { Router, Request, Response, NextFunction } from "express";
import { createExpressEndpoints, initServer } from "@ts-rest/express";
import { contract } from "@sendlit/api-contract";
import { requireAuth } from "../auth/middleware";
import {
    createTeam,
    deleteTeam,
    getTeamByTeamId,
    getTeamMembership,
    listTeamsForAccount,
    renameTeam,
    type Team,
} from "./queries";
import {
    createApiKey,
    deleteApiKey,
    getApiKeysByTeamId,
} from "../apikey/queries";
import { serializeDates } from "../utils/serialize";

const router = Router();
router.use(requireAuth);

/**
 * Team management is account-level (list/create/rename/delete which teams an
 * account belongs to), not team-scoped \u2014 so, unlike every other router, this
 * one does not run `requireTeam`. It's also restricted to user-authenticated
 * sessions: an API key is intentionally scoped to exactly one
 * team, so allowing it to enumerate or manage every team its owning account
 * belongs to would defeat that isolation.
 */
router.use((req: Request, res: Response, next: NextFunction) => {
    if (!["oauth", "session"].includes((req as any).authKind)) {
        return res.status(403).json({
            error: "user_auth_required",
            error_description:
                "Team management requires a user-authenticated session, not an API key.",
        });
    }
    next();
});

const s = initServer();

/** API keys are how CourseLit-style integrations (and MCP clients) actually
 * access a team. A team can hold several, independently named/revocable \u2014
 * e.g. one per integration \u2014 without any of them exposing another team. */
async function requireMembership(teamId: string, accountId: string) {
    return getTeamMembership(teamId, accountId);
}

/** `teams.teamId` is this row's *own* public identifier, not an internal
 * tenant-FK to another resource — so, unlike `omitInternal()`, only drop
 * `id`, never `teamId`. */
function toPublicTeam(team: Team) {
    const { id: _id, ...publicTeam } = team;
    return publicTeam;
}

/** Resolves a route's public `:teamId` param to its internal id, 404-ing if
 * it doesn't resolve to a team the caller is even a member of. */
async function resolveTeamParam(teamId: string, accountId: string) {
    const team = await getTeamByTeamId(teamId);
    if (!team) return null;
    const membership = await requireMembership(team.id, accountId);
    if (!membership) return null;
    return { team, membership };
}

const impl = s.router(contract.teams, {
    list: async ({ req }) => {
        const teams = await listTeamsForAccount((req as any).accountId);
        return {
            status: 200,
            body: { items: serializeDates(teams.map(toPublicTeam)) },
        };
    },
    create: async ({ body, req }) => {
        // The default key's one-time secret is deliberately dropped here (the
        // contract's team shape has no place for it); browser users mint keys
        // explicitly via `createKey`, which does return the secret once.
        const { defaultApiKeySecret: _, ...team } = await createTeam({
            ownerAccountId: (req as any).accountId,
            name: body.name,
        });
        return { status: 201, body: serializeDates(toPublicTeam(team)) };
    },
    rename: async ({ params, body, req }) => {
        const resolved = await resolveTeamParam(
            params.teamId,
            (req as any).accountId,
        );
        if (!resolved)
            return { status: 404, body: { error: "Team not found" } };
        const team = await renameTeam(resolved.team.id, body.name);
        return { status: 200, body: serializeDates(toPublicTeam(team!)) };
    },
    remove: async ({ params, req }) => {
        const resolved = await resolveTeamParam(
            params.teamId,
            (req as any).accountId,
        );
        if (!resolved)
            return { status: 404, body: { error: "Team not found" } };
        if (resolved.membership.role !== "owner") {
            return {
                status: 403,
                body: { error: "Only the team owner can delete it" },
            };
        }
        await deleteTeam(resolved.team.id);
        return { status: 204, body: undefined };
    },
    listKeys: async ({ params, req }) => {
        const resolved = await resolveTeamParam(
            params.teamId,
            (req as any).accountId,
        );
        if (!resolved)
            return { status: 404, body: { error: "Team not found" } };
        const keys = await getApiKeysByTeamId(resolved.team.id);
        // Strip keyHash (even a hash of a live credential has no business in
        // an HTTP response) and teamId (an internal FK to `teams.id` — the
        // caller already knows which team they're scoped to).
        return {
            status: 200,
            body: {
                items: serializeDates(
                    keys.map(({ keyHash: _, teamId: _t, ...key }) => key),
                ),
            },
        };
    },
    createKey: async ({ params, body, req }) => {
        const resolved = await resolveTeamParam(
            params.teamId,
            (req as any).accountId,
        );
        if (!resolved)
            return { status: 404, body: { error: "Team not found" } };
        const {
            apiKey: { keyHash: _, teamId: _t, ...apiKey },
            secret,
        } = await createApiKey(resolved.team.id, body.name);
        return {
            status: 201,
            body: { ...serializeDates(apiKey), key: secret },
        };
    },
    removeKey: async ({ params, req }) => {
        const resolved = await resolveTeamParam(
            params.teamId,
            (req as any).accountId,
        );
        if (!resolved)
            return { status: 404, body: { error: "Team not found" } };
        await deleteApiKey(resolved.team.id, params.keyId);
        return { status: 204, body: undefined };
    },
});

createExpressEndpoints(contract.teams, impl, router);

export default router;
