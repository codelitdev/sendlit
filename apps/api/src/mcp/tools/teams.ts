import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { listTeamsForAccount, renameTeam } from "../../team/queries";
import {
    createApiKey,
    deleteApiKey,
    getApiKeysByTeamId,
} from "../../apikey/queries";
import { AUTH_ERROR, INTERNAL_ERROR, NOT_FOUND, jsonResult } from "./responses";
import { apiKeySchema, successMessageSchema, teamSchema } from "./schemas";
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
                    items: teams.map((t) => ({ id: t.id, name: t.name })),
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
                return jsonResult({ id: updated.id, name: updated.name });
            } catch {
                return INTERNAL_ERROR;
            }
        },
    );

    server.registerTool(
        "list_api_keys",
        {
            description: "Returns all API keys for the current team.",
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
                        key: k.key,
                        name: k.name,
                        teamId: k.teamId,
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
            outputSchema: apiKeySchema,
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
                const key = await createApiKey(teamId, args.name);
                return jsonResult({
                    key: key.key,
                    name: key.name,
                    teamId: key.teamId,
                    createdAt: key.createdAt,
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
                key: z.string().describe("The API key value to delete"),
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
                await deleteApiKey(teamId, args.key);
                return jsonResult({ message: "API key deleted." });
            } catch {
                return INTERNAL_ERROR;
            }
        },
    );
}
