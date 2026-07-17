import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
    createEspConfig,
    deleteEspConfig,
    getEspConfig,
    getEspConfigByEspId,
    listEspConfigs,
    updateEspConfig,
    upsertEspConfig,
    type EspConfig,
} from "../../settings/esp/queries";
import { testEspConfig } from "../../settings/esp/test";
import {
    invalidateEspTransport,
    invalidateTeamTransport,
} from "../../mail/transport";
import { AUTH_ERROR, NOT_FOUND, errorResult, jsonResult } from "./responses";
import {
    espConfigListSchema,
    espConfigSchema,
    espProviders,
    successMessageSchema,
    testEspResultSchema,
} from "./schemas";
import { getAuthAccount, getTeamId } from "./auth";

function toPublicShape(config: EspConfig | null) {
    if (!config) return null;
    return {
        espId: config.espId,
        name: config.name,
        isDefault: config.isDefault,
        provider: config.provider,
        host: config.host,
        port: config.port,
        secure: config.secure,
        username: config.username,
        hasPassword: Boolean(config.encryptedSecret),
        fromName: config.fromName,
        fromEmail: config.fromEmail,
        lastTestedAt: config.lastTestedAt,
        lastTestStatus: config.lastTestStatus,
        lastTestError: config.lastTestError,
    };
}

const connectionFields = {
    provider: z
        .enum(espProviders)
        .describe(
            "A label for which ESP this is — the transport is always SMTP",
        ),
    host: z.string().min(1).describe("SMTP host, e.g. smtp.sendgrid.net"),
    port: z.number().int().min(1).max(65535).describe("SMTP port, e.g. 587"),
    secure: z
        .boolean()
        .describe("Use implicit TLS (usually true only for port 465)"),
    username: z.string().optional(),
    password: z
        .string()
        .optional()
        .describe("Omit to keep unchanged; empty string clears it"),
    fromName: z.string().optional(),
    fromEmail: z.string().email().optional(),
};

export function registerEspTools(server: McpServer): void {
    server.registerTool(
        "get_esp_config",
        {
            description:
                "Returns the team's configured email sending provider (ESP/SMTP), or null if none is configured yet. Teams without ESP cannot send campaign mail. Never includes the password.",
            outputSchema: z.object({ config: espConfigSchema.nullable() }),
            annotations: {
                readOnlyHint: true,
                idempotentHint: true,
                openWorldHint: false,
            },
        },
        async (extra: any) => {
            const teamId = getTeamId(extra);
            if (!teamId) return AUTH_ERROR;
            const config = await getEspConfig(teamId);
            return jsonResult({ config: toPublicShape(config) });
        },
    );

    server.registerTool(
        "update_esp_config",
        {
            description:
                "Creates or updates the team's *default* ESP (SMTP) configuration — an alias over the first/default row in the team's ESP collection (see `create_esp`/`update_esp` for named, non-default configurations). Works with any provider that exposes an SMTP relay (SendGrid, Mailgun, Postmark, SES, Resend, or a custom/self-hosted SMTP server). Omit `password` to keep the existing secret; send an empty string to clear it.",
            inputSchema: connectionFields,
            outputSchema: espConfigSchema,
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
                const config = await upsertEspConfig(teamId, args);
                invalidateTeamTransport(teamId);
                return jsonResult(toPublicShape(config));
            } catch (err: any) {
                return errorResult(err.message);
            }
        },
    );

    server.registerTool(
        "delete_esp_config",
        {
            description:
                "Removes the team's default ESP configuration. If another user ESP exists, it's promoted to default; otherwise campaign/transactional sends fail until a new ESP is configured.",
            outputSchema: successMessageSchema,
            annotations: {
                readOnlyHint: false,
                destructiveHint: true,
                openWorldHint: false,
            },
        },
        async (extra: any) => {
            const teamId = getTeamId(extra);
            if (!teamId) return AUTH_ERROR;
            try {
                await deleteEspConfig(teamId);
            } catch (err: any) {
                return errorResult(
                    err.message === "esp_in_use"
                        ? "ESP is in use by an active sequence or a queued transactional email and cannot be removed."
                        : err.message,
                );
            }
            invalidateTeamTransport(teamId);
            return jsonResult({ message: "ESP configuration removed." });
        },
    );

    server.registerTool(
        "send_test_email",
        {
            description:
                "Sends a test email through the team's default ESP to verify it works. Defaults to the current user's own email address if `to` is omitted (OAuth sessions only — API-key sessions must supply `to`).",
            inputSchema: {
                to: z.string().email().optional(),
            },
            outputSchema: testEspResultSchema,
            annotations: {
                readOnlyHint: false,
                destructiveHint: false,
                openWorldHint: true,
            },
        },
        async (args: any, extra: any) => {
            const teamId = getTeamId(extra);
            if (!teamId) return AUTH_ERROR;

            const config = await getEspConfig(teamId);
            if (!config) {
                return jsonResult({
                    success: false,
                    error: "No ESP configured for this team yet.",
                });
            }

            const result = await testEspConfig({
                config,
                to: args.to,
                account: getAuthAccount(extra),
                source: "mcp.send_test_email",
            });
            return jsonResult({
                success: result.success,
                error: result.error,
            });
        },
    );

    server.registerTool(
        "list_esps",
        {
            description:
                "Lists every user-managed ESP configuration the team has created. Never includes passwords.",
            outputSchema: espConfigListSchema,
            annotations: {
                readOnlyHint: true,
                idempotentHint: true,
                openWorldHint: false,
            },
        },
        async (extra: any) => {
            const teamId = getTeamId(extra);
            if (!teamId) return AUTH_ERROR;
            const configs = await listEspConfigs(teamId);
            return jsonResult({ items: configs.map(toPublicShape) });
        },
    );

    server.registerTool(
        "create_esp",
        {
            description:
                "Creates a new user-managed ESP configuration for the team. The team's first ESP automatically becomes the default; pass `isDefault: true` to make a later one the default instead.",
            inputSchema: {
                name: z.string().trim().min(1).max(100),
                isDefault: z.boolean().optional(),
                ...connectionFields,
            },
            outputSchema: espConfigSchema,
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
                const config = await createEspConfig(teamId, args);
                invalidateTeamTransport(teamId);
                return jsonResult(toPublicShape(config));
            } catch (err: any) {
                return errorResult(err.message);
            }
        },
    );

    server.registerTool(
        "get_esp",
        {
            description:
                "Returns a single user-managed ESP configuration by its ESP ID.",
            inputSchema: { espId: z.string().min(1) },
            outputSchema: espConfigSchema,
            annotations: {
                readOnlyHint: true,
                idempotentHint: true,
                openWorldHint: false,
            },
        },
        async (args: any, extra: any) => {
            const teamId = getTeamId(extra);
            if (!teamId) return AUTH_ERROR;
            const config = await getEspConfigByEspId(teamId, args.espId);
            if (!config) return NOT_FOUND;
            return jsonResult(toPublicShape(config));
        },
    );

    server.registerTool(
        "update_esp",
        {
            description:
                "Updates a user-managed ESP configuration by its ESP ID. Pass `isDefault: true` to atomically switch the team's default. Omit `password` to keep the existing secret; send an empty string to clear it.",
            inputSchema: {
                espId: z.string().min(1),
                name: z.string().trim().min(1).max(100).optional(),
                isDefault: z.literal(true).optional(),
                provider: connectionFields.provider.optional(),
                host: connectionFields.host.optional(),
                port: connectionFields.port.optional(),
                secure: connectionFields.secure.optional(),
                username: connectionFields.username,
                password: connectionFields.password,
                fromName: connectionFields.fromName,
                fromEmail: connectionFields.fromEmail,
            },
            outputSchema: espConfigSchema,
            annotations: {
                readOnlyHint: false,
                destructiveHint: false,
                openWorldHint: false,
            },
        },
        async (args: any, extra: any) => {
            const teamId = getTeamId(extra);
            if (!teamId) return AUTH_ERROR;
            const { espId, ...patch } = args;
            try {
                const config = await updateEspConfig(teamId, espId, patch);
                if (!config) return NOT_FOUND;
                invalidateEspTransport(teamId, config.id);
                if (patch.isDefault) invalidateTeamTransport(teamId);
                return jsonResult(toPublicShape(config));
            } catch (err: any) {
                return errorResult(err.message);
            }
        },
    );

    server.registerTool(
        "delete_esp",
        {
            description:
                "Removes a user-managed ESP configuration by its ESP ID. Fails if it's referenced by an active/paused sequence or a queued transactional email. Deleting the default promotes another user ESP when one exists.",
            inputSchema: { espId: z.string().min(1) },
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
            const config = await getEspConfigByEspId(teamId, args.espId);
            if (!config) return NOT_FOUND;
            try {
                await deleteEspConfig(teamId, args.espId);
            } catch (err: any) {
                return errorResult(
                    err.message === "esp_in_use"
                        ? "ESP is in use by an active sequence or a queued transactional email and cannot be removed."
                        : err.message,
                );
            }
            invalidateEspTransport(teamId, config.id);
            if (config.isDefault) invalidateTeamTransport(teamId);
            return jsonResult({ message: "ESP configuration removed." });
        },
    );

    server.registerTool(
        "test_esp",
        {
            description:
                "Sends a test email through a user-managed ESP (by its ESP ID) to verify it works. Defaults to the current user's own email address if `to` is omitted (OAuth sessions only — API-key sessions must supply `to`).",
            inputSchema: {
                espId: z.string().min(1),
                to: z.string().email().optional(),
            },
            outputSchema: testEspResultSchema,
            annotations: {
                readOnlyHint: false,
                destructiveHint: false,
                openWorldHint: true,
            },
        },
        async (args: any, extra: any) => {
            const teamId = getTeamId(extra);
            if (!teamId) return AUTH_ERROR;
            const config = await getEspConfigByEspId(teamId, args.espId);
            if (!config) return NOT_FOUND;
            const result = await testEspConfig({
                config,
                to: args.to,
                account: getAuthAccount(extra),
                source: "mcp.test_esp",
            });
            return jsonResult({
                success: result.success,
                error: result.error,
            });
        },
    );
}
