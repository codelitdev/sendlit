import type { McpToolRegistrar } from "../tool-registry";
import { z } from "zod";
import {
    createTeam,
    archiveTeam,
    getTeamByTeamId,
    getTeamMembership,
    listTeamViewsForUser,
    renameTeam,
} from "../../team/queries";
import {
    createApiKey,
    deleteApiKey,
    getApiKeysByTeamId,
} from "../../apikey/queries";
import { AUTH_ERROR, INTERNAL_ERROR, NOT_FOUND, jsonResult } from "./responses";
import {
    apiKeySchema,
    createdApiKeySchema,
    successMessageSchema,
    teamSchema,
} from "./schemas";
import { getAuthUser, getTeamId } from "./auth";
import { getOrganizationMembership } from "../../organization/queries";

export function registerTeamTools(server: McpToolRegistrar): void {
    server.registerTool(
        "list_teams",
        {
            description: "Returns all teams the authenticated user belongs to.",
            outputSchema: z.object({ items: z.array(teamSchema) }),
            annotations: {
                readOnlyHint: true,
                idempotentHint: true,
                openWorldHint: false,
            },
        },
        async (extra: any) => {
            const user = getAuthUser(extra);
            if (!user) return AUTH_ERROR;
            try {
                const teams = await listTeamViewsForUser(user.id);
                return jsonResult({
                    items: teams.map((t) => ({
                        teamId: t.teamId,
                        name: t.name,
                        organizationId: t.organizationPublicId,
                        organizationName: t.organizationName,
                    })),
                });
            } catch {
                return INTERNAL_ERROR;
            }
        },
    );

    server.registerTool(
        "create_team",
        {
            description:
                "Creates a new team in the authenticated user's default organization.",
            inputSchema: {
                name: z.string().min(1).describe("Team name"),
            },
            outputSchema: teamSchema,
            annotations: {
                readOnlyHint: false,
                destructiveHint: false,
                openWorldHint: false,
            },
        },
        async (args: any, extra: any) => {
            const user = getAuthUser(extra);
            if (!user?.defaultOrganizationId) return AUTH_ERROR;
            try {
                const membership = await getOrganizationMembership(
                    user.defaultOrganizationId,
                    user.id,
                );
                if (
                    !membership ||
                    !["owner", "admin"].includes(membership.role)
                )
                    return AUTH_ERROR;
                const team = await createTeam({
                    organizationId: user.defaultOrganizationId,
                    creatorUserId: user.id,
                    name: args.name,
                });
                return jsonResult({
                    teamId: team.teamId,
                    name: team.name,
                });
            } catch {
                return INTERNAL_ERROR;
            }
        },
    );

    server.registerTool(
        "rename_team",
        {
            description: "Renames the current team.",
            inputSchema: {
                name: z.string().min(1).describe("New team name"),
            },
            outputSchema: teamSchema,
            annotations: {
                readOnlyHint: false,
                destructiveHint: false,
                openWorldHint: false,
            },
        },
        async (args: any, extra: any) => {
            const teamId = getTeamId(extra);
            if (!teamId) return AUTH_ERROR;
            try {
                const updated = await renameTeam(teamId, args.name);
                if (!updated) return NOT_FOUND;
                return jsonResult({
                    teamId: updated.teamId,
                    name: updated.name,
                });
            } catch {
                return INTERNAL_ERROR;
            }
        },
    );

    server.registerTool(
        "delete_team",
        {
            description:
                "Archives a team. Organization administration is required.",
            inputSchema: {
                teamId: z.string().describe("Team ID"),
            },
            outputSchema: successMessageSchema,
            annotations: {
                readOnlyHint: false,
                destructiveHint: true,
                openWorldHint: false,
            },
        },
        async (args: any, extra: any) => {
            const user = getAuthUser(extra);
            if (!user) return AUTH_ERROR;
            try {
                const team = await getTeamByTeamId(args.teamId);
                if (!team) return NOT_FOUND;
                const membership = await getTeamMembership(team.id, user.id);
                if (!membership) return NOT_FOUND;
                const organizationMembership = await getOrganizationMembership(
                    team.organizationId,
                    user.id,
                );
                if (
                    !organizationMembership ||
                    !["owner", "admin"].includes(organizationMembership.role)
                ) {
                    return {
                        content: [
                            {
                                type: "text" as const,
                                text: "Organization administration is required.",
                            },
                        ],
                        isError: true,
                    };
                }
                await archiveTeam(team.id);
                return jsonResult({ message: "Team archived." });
            } catch {
                return INTERNAL_ERROR;
            }
        },
    );

    server.registerTool(
        "list_api_keys",
        {
            description:
                "Returns all API keys for the current team. Secrets are stored hashed, so only each key's display prefix is included.",
            outputSchema: z.object({ items: z.array(apiKeySchema) }),
            annotations: {
                readOnlyHint: true,
                idempotentHint: true,
                openWorldHint: false,
            },
        },
        async (extra: any) => {
            const teamId = getTeamId(extra);
            if (!teamId) return AUTH_ERROR;
            try {
                const keys = await getApiKeysByTeamId(teamId);
                return jsonResult({
                    items: keys.map((k) => ({
                        id: k.teamApiKeyId,
                        keyPrefix: k.keyPrefix,
                        name: k.name,
                        createdAt: k.createdAt,
                    })),
                });
            } catch {
                return INTERNAL_ERROR;
            }
        },
    );

    server.registerTool(
        "create_api_key",
        {
            description:
                "Creates a new API key for the current team. The full key value is only returned once — store it securely.",
            inputSchema: {
                name: z
                    .string()
                    .min(1)
                    .describe("Human-readable label for this key"),
            },
            outputSchema: createdApiKeySchema,
            annotations: {
                readOnlyHint: false,
                destructiveHint: false,
                openWorldHint: false,
            },
        },
        async (args: any, extra: any) => {
            const teamId = getTeamId(extra);
            if (!teamId) return AUTH_ERROR;
            try {
                const user = getAuthUser(extra);
                const { apiKey, secret } = await createApiKey(
                    teamId,
                    args.name,
                    {
                        createdByType: user ? "user" : "system",
                        createdById: user?.id,
                    },
                );
                return jsonResult({
                    id: apiKey.teamApiKeyId,
                    key: secret,
                    keyPrefix: apiKey.keyPrefix,
                    name: apiKey.name,
                    createdAt: apiKey.createdAt,
                });
            } catch {
                return INTERNAL_ERROR;
            }
        },
    );

    server.registerTool(
        "delete_api_key",
        {
            description:
                "Permanently deletes an API key. Any integrations using it will stop working immediately.",
            inputSchema: {
                keyId: z
                    .string()
                    .describe(
                        "Id of the API key to delete (from list_api_keys)",
                    ),
            },
            outputSchema: successMessageSchema,
            annotations: {
                readOnlyHint: false,
                destructiveHint: true,
                openWorldHint: false,
            },
        },
        async (args: any, extra: any) => {
            const teamId = getTeamId(extra);
            if (!teamId) return AUTH_ERROR;
            try {
                await deleteApiKey(teamId, args.keyId);
                return jsonResult({ message: "API key deleted." });
            } catch {
                return INTERNAL_ERROR;
            }
        },
    );
}
