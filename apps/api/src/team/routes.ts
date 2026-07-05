import { Router, Request, Response, NextFunction } from "express";
import { createExpressEndpoints, initServer } from "@ts-rest/express";
import { contract } from "@sendlit/api-contract";
import { requireAuth } from "../auth/middleware";
import {
    createTeam,
    deleteTeam,
    getTeamMembership,
    listTeamsForAccount,
    renameTeam,
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
 * one does not run `requireTeam`. It's also restricted to OAuth-authenticated
 * (human/browser) sessions: an API key is intentionally scoped to exactly one
 * team, so allowing it to enumerate or manage every team its owning account
 * belongs to would defeat that isolation.
 */
router.use((req: Request, res: Response, next: NextFunction) => {
    if ((req as any).authKind !== "oauth") {
        return res.status(403).json({
            error: "oauth_required",
            error_description:
                "Team management requires an OAuth-authenticated (browser) session, not an API key.",
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

const impl = s.router(contract.teams, {
    list: async ({ req }) => {
        const teams = await listTeamsForAccount((req as any).accountId);
        return { status: 200, body: { items: serializeDates(teams) } };
    },
    create: async ({ body, req }) => {
        const team = await createTeam({
            ownerAccountId: (req as any).accountId,
            name: body.name,
        });
        return { status: 201, body: serializeDates(team) };
    },
    rename: async ({ params, body, req }) => {
        const membership = await requireMembership(
            params.teamId,
            (req as any).accountId,
        );
        if (!membership)
            return { status: 404, body: { error: "Team not found" } };
        const team = await renameTeam(params.teamId, body.name);
        return { status: 200, body: serializeDates(team!) };
    },
    remove: async ({ params, req }) => {
        const membership = await requireMembership(
            params.teamId,
            (req as any).accountId,
        );
        if (!membership)
            return { status: 404, body: { error: "Team not found" } };
        if (membership.role !== "owner") {
            return {
                status: 403,
                body: { error: "Only the team owner can delete it" },
            };
        }
        await deleteTeam(params.teamId);
        return { status: 204, body: undefined };
    },
    listKeys: async ({ params, req }) => {
        const membership = await requireMembership(
            params.teamId,
            (req as any).accountId,
        );
        if (!membership)
            return { status: 404, body: { error: "Team not found" } };
        const keys = await getApiKeysByTeamId(params.teamId);
        return { status: 200, body: { items: serializeDates(keys) } };
    },
    createKey: async ({ params, body, req }) => {
        const membership = await requireMembership(
            params.teamId,
            (req as any).accountId,
        );
        if (!membership)
            return { status: 404, body: { error: "Team not found" } };
        const key = await createApiKey(params.teamId, body.name);
        return { status: 201, body: serializeDates(key) };
    },
    removeKey: async ({ params, req }) => {
        const membership = await requireMembership(
            params.teamId,
            (req as any).accountId,
        );
        if (!membership)
            return { status: 404, body: { error: "Team not found" } };
        await deleteApiKey(params.teamId, params.key);
        return { status: 204, body: undefined };
    },
});

createExpressEndpoints(contract.teams, impl, router);

export default router;
