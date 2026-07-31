import { Router, Request, Response, NextFunction } from "express";
import { createExpressEndpoints, initServer } from "@ts-rest/express";
import { contract } from "@sendlit/api-contract";
import { requireAuth } from "../auth/middleware";
import {
    createTeam,
    archiveTeam,
    getTeamByTeamId,
    getTeamMembership,
    listTeamViewsForUser,
    renameTeam,
    type Team,
} from "./queries";
import {
    createApiKey,
    deleteApiKey,
    getApiKeysByTeamId,
} from "../apikey/queries";
import { serializeDates } from "../utils/serialize";
import { getUser } from "../user/queries";
import { getOrganizationMembership } from "../organization/queries";

const router = Router();
// This router is mounted at the API root. Scope account-level middleware to
// `/teams` so it cannot intercept unrelated endpoints such as `/contacts`.
router.use("/teams", requireAuth);

/**
 * Team management is account-level (list/create/rename/delete which teams an
 * account belongs to), not team-scoped \u2014 so, unlike every other router, this
 * one does not run `requireTeam`. It's also restricted to user-authenticated
 * sessions: an API key is intentionally scoped to exactly one
 * team, so allowing it to enumerate or manage every team its owning account
 * belongs to would defeat that isolation.
 */
router.use("/teams", (req: Request, res: Response, next: NextFunction) => {
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
async function requireMembership(teamId: string, userId: string) {
    return getTeamMembership(teamId, userId);
}

/** `teams.teamId` is this row's *own* public identifier, not an internal
 * tenant-FK to another resource — so, unlike `omitInternal()`, only drop
 * `id`, never `teamId`. */
function toPublicTeam(
    team: Team & { organizationPublicId?: string; organizationName?: string },
) {
    const {
        id: _id,
        organizationId: _organizationId,
        organizationPublicId,
        organizationName,
        provisioningRequestHash: _provisioningRequestHash,
        ...publicTeam
    } = team;
    return {
        ...publicTeam,
        ...(organizationPublicId
            ? { organizationId: organizationPublicId }
            : {}),
        ...(organizationName ? { organizationName } : {}),
        status: publicTeam.status as
            "active" | "sending_suspended" | "archived",
    };
}

/** Resolves a route's public `:teamId` param to its internal id, 404-ing if
 * it doesn't resolve to a team the caller is even a member of. */
async function resolveTeamParam(teamId: string, userId: string) {
    const team = await getTeamByTeamId(teamId);
    if (!team) return null;
    const membership = await requireMembership(team.id, userId);
    if (!membership) return null;
    return { team, membership };
}

const impl = s.router(contract.teams, {
    list: async ({ req }) => {
        const teams = await listTeamViewsForUser((req as any).userId);
        return {
            status: 200,
            body: { items: serializeDates(teams.map(toPublicTeam)) },
        };
    },
    create: async ({ body, req }) => {
        // No default API key here — the dashboard has no surface to show its
        // one-time secret at creation time. Users mint keys explicitly via
        // `createKey`, which does return the secret once.
        const identity = await getUser((req as any).userId);
        if (!identity?.defaultOrganizationId) {
            return {
                status: 409,
                body: { error: "user_onboarding_pending" },
            } as const;
        }
        const organizationMembership = await getOrganizationMembership(
            identity.defaultOrganizationId,
            identity.id,
        );
        if (
            !organizationMembership ||
            !["owner", "admin"].includes(organizationMembership.role)
        ) {
            return {
                status: 403,
                body: { error: "organization_permission_required" },
            } as const;
        }
        const team = await createTeam({
            organizationId: identity.defaultOrganizationId,
            creatorUserId: identity.id,
            name: body.name,
        });
        return { status: 201, body: serializeDates(toPublicTeam(team)) };
    },
    rename: async ({ params, body, req }) => {
        const resolved = await resolveTeamParam(
            params.teamId,
            (req as any).userId,
        );
        if (!resolved)
            return { status: 404, body: { error: "Team not found" } };
        const team = await renameTeam(resolved.team.id, body.name);
        return { status: 200, body: serializeDates(toPublicTeam(team!)) };
    },
    remove: async ({ params, req }) => {
        const resolved = await resolveTeamParam(
            params.teamId,
            (req as any).userId,
        );
        if (!resolved)
            return { status: 404, body: { error: "Team not found" } };
        const organizationMembership = await getOrganizationMembership(
            resolved.team.organizationId,
            (req as any).userId,
        );
        if (
            !organizationMembership ||
            !["owner", "admin"].includes(organizationMembership.role)
        ) {
            return {
                status: 403,
                body: { error: "Organization administration is required" },
            };
        }
        await archiveTeam(resolved.team.id);
        return { status: 204, body: undefined };
    },
    listKeys: async ({ params, req }) => {
        const resolved = await resolveTeamParam(
            params.teamId,
            (req as any).userId,
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
                    keys.map(
                        ({
                            id: _id,
                            keyHash: _keyHash,
                            teamId: _teamId,
                            teamApiKeyId,
                            createdByType: _createdByType,
                            createdById: _createdById,
                            ...key
                        }) => ({
                            ...key,
                            keyId: teamApiKeyId,
                        }),
                    ),
                ),
            },
        };
    },
    createKey: async ({ params, body, req }) => {
        const resolved = await resolveTeamParam(
            params.teamId,
            (req as any).userId,
        );
        if (!resolved)
            return { status: 404, body: { error: "Team not found" } };
        const {
            apiKey: { keyHash: _, teamId: _t, teamApiKeyId, ...apiKey },
            secret,
        } = await createApiKey(resolved.team.id, body.name, {
            createdByType: "user",
            createdById: (req as any).userId,
        });
        return {
            status: 201,
            body: {
                ...serializeDates(apiKey),
                keyId: teamApiKeyId,
                key: secret,
            },
        };
    },
    removeKey: async ({ params, req }) => {
        const resolved = await resolveTeamParam(
            params.teamId,
            (req as any).userId,
        );
        if (!resolved)
            return { status: 404, body: { error: "Team not found" } };
        await deleteApiKey(resolved.team.id, params.keyId);
        return { status: 204, body: undefined };
    },
});

createExpressEndpoints(contract.teams, impl, router);

export default router;
