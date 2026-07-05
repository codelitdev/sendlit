import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
    deleteEspConfig,
    getEspConfig,
    recordEspTestResult,
    upsertEspConfig,
    type EspConfig,
} from "../../settings/esp/queries";
import { invalidateTeamTransport } from "../../mail/transport";
import { sendTestMail } from "../../mail/send";
import { getEmailFrom } from "../../utils/mail";
import { getTeam } from "../../team/queries";
import { AUTH_ERROR, errorResult, jsonResult } from "./responses";
import {
    espConfigSchema,
    espProviders,
    successMessageSchema,
    testEspResultSchema,
} from "./schemas";
import { getAuthAccount, getTeamId } from "./auth";

function toPublicShape(config: EspConfig | null) {
    if (!config) return null;
    return {
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

export function registerEspTools(server: McpServer): void {
    server.registerTool(
        "get_esp_config",
        {
            description:
                "Returns the team's configured email sending provider (ESP/SMTP), or null if none is configured yet (mail then sends through the platform default). Never includes the password.",
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
                "Creates or updates the team's ESP (SMTP) configuration used to send its broadcasts/sequences. Works with any provider that exposes an SMTP relay (SendGrid, Mailgun, Postmark, SES, Resend, or a custom/self-hosted SMTP server). Omit `password` to keep the existing secret; send an empty string to clear it.",
            inputSchema: {
                provider: z
                    .enum(espProviders)
                    .describe(
                        "A label for which ESP this is — the transport is always SMTP",
                    ),
                host: z
                    .string()
                    .min(1)
                    .describe("SMTP host, e.g. smtp.sendgrid.net"),
                port: z
                    .number()
                    .int()
                    .min(1)
                    .max(65535)
                    .describe("SMTP port, e.g. 587"),
                secure: z
                    .boolean()
                    .describe(
                        "Use implicit TLS (usually true only for port 465)",
                    ),
                username: z.string().optional(),
                password: z
                    .string()
                    .optional()
                    .describe("Omit to keep unchanged; empty string clears it"),
                fromName: z.string().optional(),
                fromEmail: z.string().email().optional(),
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
                "Removes the team's ESP configuration. Future sends fall back to the platform default sender.",
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
            await deleteEspConfig(teamId);
            invalidateTeamTransport(teamId);
            return jsonResult({ message: "ESP configuration removed." });
        },
    );

    server.registerTool(
        "send_test_email",
        {
            description:
                "Sends a test email through the team's configured ESP to verify it works. Defaults to the current user's own email address if `to` is omitted (OAuth sessions only — API-key sessions must supply `to`).",
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

            const account = getAuthAccount(extra);
            const team = await getTeam(teamId);
            const to = args.to || account?.email;
            if (!to) {
                return jsonResult({
                    success: false,
                    error: "No destination email address available.",
                });
            }

            const from = getEmailFrom({
                name:
                    config.fromName ||
                    team?.fromName ||
                    account?.name ||
                    "SendLit",
                email:
                    config.fromEmail || team?.fromEmail || account?.email || "",
            });

            try {
                await sendTestMail({
                    from,
                    to,
                    subject: "SendLit test email",
                    html: "<p>This is a test email from your SendLit ESP configuration. If you're reading this, it works!</p>",
                    teamId,
                });
                await recordEspTestResult(teamId, "success");
                return jsonResult({ success: true });
            } catch (err: any) {
                await recordEspTestResult(teamId, "failed", err.message);
                return jsonResult({ success: false, error: err.message });
            }
        },
    );
}
