import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
    createTeam,
    deleteTeam,
    getTeamByTeamId,
    getTeamMembership,
    listTeamsForAccount,
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
import { getAuthAccount, getTeamId } from "./auth";

export function registerTeamTools(server: McpServer): void {
    server.registerTool(
        "list_teams",
        {
            description:
                "Returns all teams the authenticated account belongs to.",
            outputSchema: z.object({ items: z.array(teamSchema) }),
            annotations: {
                readOnlyHint: true,
                idempotentHint: true,
                openWorldHint: false,
            },
        },
        async (extra: any) => {
            const account = getAuthAccount(extra);
            if (!account) return AUTH_ERROR;
            try {
                const teams = await listTeamsForAccount(account.id);
                return jsonResult({
                    items: teams.map((t) => ({
                        teamId: t.teamId,
                        name: t.name,
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
                "Creates a new team owned by the authenticated account.",
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
            const account = getAuthAccount(extra);
            if (!account) return AUTH_ERROR;
            try {
                const team = await createTeam({
                    ownerAccountId: account.id,
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
                "Permanently deletes a team. Only the team owner can delete it.",
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
            const account = getAuthAccount(extra);
            if (!account) return AUTH_ERROR;
            try {
                const team = await getTeamByTeamId(args.teamId);
                if (!team) return NOT_FOUND;
                const membership = await getTeamMembership(team.id, account.id);
                if (!membership) return NOT_FOUND;
                if (membership.role !== "owner") {
                    return {
                        content: [
                            {
                                type: "text" as const,
                                text: "Only the team owner can delete it.",
                            },
                        ],
                        isError: true,
                    };
                }
                await deleteTeam(team.id);
                return jsonResult({ message: "Team deleted." });
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
                        id: k.id,
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
                const { apiKey, secret } = await createApiKey(
                    teamId,
                    args.name,
                );
                return jsonResult({
                    id: apiKey.id,
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
