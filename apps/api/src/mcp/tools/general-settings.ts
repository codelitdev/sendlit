import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
    getGeneralSettings,
    upsertGeneralSettings,
    type GeneralSettings,
} from "../../settings/general/queries";
import { AUTH_ERROR, errorResult, jsonResult } from "./responses";
import { generalSettingsSchema } from "./schemas";
import { getTeamId } from "./auth";

function toPublicShape(settings: GeneralSettings) {
    return {
        mailingAddress: settings.mailingAddress,
        updatedAt: settings.updatedAt,
    };
}

export function registerGeneralSettingsTools(server: McpServer): void {
    server.registerTool(
        "get_general_settings",
        {
            description:
                "Returns the team's general workspace settings (e.g. the mailing address rendered in email footers). Returns defaults (null fields) when nothing has been saved yet.",
            outputSchema: generalSettingsSchema,
            annotations: {
                readOnlyHint: true,
                idempotentHint: true,
                openWorldHint: false,
            },
        },
        async (extra: any) => {
            const teamId = getTeamId(extra);
            if (!teamId) return AUTH_ERROR;
            const settings = await getGeneralSettings(teamId);
            return jsonResult(toPublicShape(settings));
        },
    );

    server.registerTool(
        "update_general_settings",
        {
            description:
                "Updates the team's general workspace settings. Omitted fields are left unchanged; send an empty string to clear a field. `mailingAddress` is the physical postal address rendered in email footers (CAN-SPAM/GDPR requirement).",
            inputSchema: {
                mailingAddress: z
                    .string()
                    .optional()
                    .describe("Omit to keep unchanged; empty string clears it"),
            },
            outputSchema: generalSettingsSchema,
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
                const settings = await upsertGeneralSettings(teamId, args);
                return jsonResult(toPublicShape(settings));
            } catch (err: any) {
                return errorResult(err.message);
            }
        },
    );
}
