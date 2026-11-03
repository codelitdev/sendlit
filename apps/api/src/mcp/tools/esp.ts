import {
  domainAuthenticationQuerySchema,
  domainAuthenticationSchema,
  upsertEspConfigBodySchema,
} from "@sendlit/api-contract";
import { z } from "zod";
import { invalidateEspTransport, invalidateTeamTransport } from "../../mail/transport";
import { warmupState } from "../../mail/warmup";
import { espDeleteBlockerMessage } from "../../settings/esp/delete-blockers";
import {
  checkAndRememberDomainAuthentication,
  createEspConfig,
  deleteEspConfig,
  type EspConfig,
  getEspConfig,
  getEspConfigByEspId,
  listEspConfigs,
  transitionEspConfig,
  updateEspConfig,
  upsertEspConfig,
} from "../../settings/esp/queries";
import { testEspConfig } from "../../settings/esp/test";
import type { SendLitMcpTool } from "../context";
import { dedicatedTool } from "../tool";
import { notFound, type ToolError, toolError } from "./responses";
import {
  espConfigListSchema,
  espConfigSchema,
  espProviders,
  successMessageSchema,
  testEspResultSchema,
} from "./schemas";

function toPublicShape(config: EspConfig | null) {
  if (!config) return null;
  return {
    espId: config.espId,
    name: config.name,
    provider: config.provider,
    host: config.host,
    port: config.port,
    secure: config.secure,
    username: config.username,
    hasPassword: Boolean(config.encryptedSecret),
    fromName: config.fromName,
    fromEmail: config.fromEmail,
    replyTo: config.replyTo,
    maxSendRate: config.maxSendRate,
    dailySendLimit: config.dailySendLimit,
    warmup: warmupState(config),
    status: config.status,
    secretVersion: config.secretVersion,
    lastTestedAt: config.lastTestedAt,
    lastTestStatus: config.lastTestStatus,
    lastTestError: config.lastTestError,
  };
}

/** A write to a retired ESP: the only code the ESP queries name. Anything
 * else is unexpected and thrown. */
function lifecycleError(err: unknown): ToolError {
  if (err instanceof Error && err.message === "invalid_lifecycle_transition") {
    return toolError("conflict", {
      reason: "invalid_lifecycle_transition",
      message: "A retired ESP can't be changed.",
    });
  }
  throw err;
}

/** Why an ESP can't be deleted, with what to do instead. */
function deleteBlockedError(err: unknown): ToolError {
  const code = err instanceof Error ? err.message : undefined;
  const message = espDeleteBlockerMessage(code);
  if (!code || !message) throw err;
  return toolError("conflict", { reason: code, message });
}

const connectionFields = {
  provider: z
    .enum(espProviders)
    .describe("A label for which ESP this is — the transport is always SMTP"),
  host: z.string().min(1).describe("SMTP host, e.g. smtp.sendgrid.net"),
  port: z.number().int().min(1).max(65535).describe("SMTP port, e.g. 587"),
  secure: z.boolean().describe("Use implicit TLS (usually true only for port 465)"),
  username: z.string().optional(),
  password: z
    .string()
    .optional()
    .describe("Omit to keep unchanged; empty string clears it"),
  fromName: z.string().optional(),
  fromEmail: z.string().email().optional(),
  replyTo: z
    .union([z.string().email(), z.literal("")])
    .optional()
    .describe("Reply-To for mail sent through this ESP; empty string clears it"),
  maxSendRate: z
    .number()
    .positive()
    .max(10_000)
    .nullable()
    .optional()
    .describe(
      "Messages per second across all workers; null uses the provider default (SES 14, Resend 2, others unlimited). Set SES to your account's MaxSendRate.",
    ),
  dailySendLimit: z
    .number()
    .int()
    .positive()
    .nullable()
    .optional()
    .describe(
      "Most broadcast/sequence emails per UTC day through this ESP, e.g. a warm-up ramp; emails over it wait for the next day. null removes the cap.",
    ),
  warmupTargetDailyVolume: upsertEspConfigBodySchema.shape.warmupTargetDailyVolume,
};

const readOnly = { idempotentHint: true, openWorldHint: false };

export const espTools = (): SendLitMcpTool[] => [
  dedicatedTool({
    name: "get_esp_config",
    title: "Get Default Sending Provider",
    operationId: "settings.esps.get",
    risk: "read",
    description:
      "Returns the team's configured email sending provider (ESP/SMTP), or null if none is configured yet. Teams without ESP cannot send campaign mail. Never includes the password.",
    inputSchema: z.object({}),
    outputSchema: z.object({ config: espConfigSchema.nullable() }),
    annotations: readOnly,
    async handler({ context }) {
      return { config: toPublicShape(await getEspConfig(context.teamId)) };
    },
  }),

  dedicatedTool({
    name: "update_esp_config",
    title: "Update Default Sending Provider",
    operationId: "settings.esps.update",
    risk: "write",
    description:
      "Creates or updates the team's *default* ESP (SMTP) configuration — an alias over the first/default row in the team's ESP collection (see `create_esp`/`update_esp` for named, non-default configurations). Works with any provider that exposes an SMTP relay (SendGrid, Mailgun, Postmark, SES, Resend, or a custom/self-hosted SMTP server). Omit `password` to keep the existing secret; send an empty string to clear it.",
    inputSchema: z.object(connectionFields),
    outputSchema: espConfigSchema,
    annotations: { openWorldHint: false },
    async handler({ context, args }) {
      try {
        const config = await upsertEspConfig(context.teamId, args);
        invalidateTeamTransport(context.teamId);
        return toPublicShape(config);
      } catch (err) {
        return lifecycleError(err);
      }
    },
  }),

  dedicatedTool({
    name: "delete_esp_config",
    title: "Delete Default Sending Provider",
    operationId: "settings.esps.remove",
    risk: "destructive",
    description:
      "Legacy: removes the team's first ESP configuration. A live team default can't be removed (make another source the default, or retire it with retire_esp, first), and an ESP with delivery history or queued work is never deleted.",
    inputSchema: z.object({}),
    outputSchema: successMessageSchema,
    annotations: { openWorldHint: false },
    async handler({ context }) {
      try {
        await deleteEspConfig(context.teamId);
      } catch (err) {
        return deleteBlockedError(err);
      }
      invalidateTeamTransport(context.teamId);
      return { message: "ESP configuration removed." };
    },
  }),

  dedicatedTool({
    name: "send_test_email",
    title: "Send Test Email via Default Provider",
    operationId: "settings.esps.test",
    risk: "write",
    description:
      "Sends a test email through the team's default ESP to verify it works. Defaults to the current user's own email address if `to` is omitted (OAuth sessions only — API-key sessions must supply `to`).",
    inputSchema: z.object({ to: z.string().email().optional() }),
    outputSchema: testEspResultSchema,
    annotations: { openWorldHint: true },
    async handler({ context, args }) {
      const config = await getEspConfig(context.teamId);
      if (!config) {
        return { success: false, error: "No ESP configured for this team yet." };
      }
      const result = await testEspConfig({
        config,
        to: args.to,
        account: context.user,
        source: "mcp.send_test_email",
      });
      return { success: result.success, error: result.error };
    },
  }),

  dedicatedTool({
    name: "list_esps",
    title: "List Sending Providers",
    operationId: "settings.esps.list",
    risk: "read",
    description:
      "Lists every user-managed ESP configuration the team has created. Never includes passwords.",
    inputSchema: z.object({}),
    outputSchema: espConfigListSchema,
    annotations: readOnly,
    async handler({ context }) {
      const configs = await listEspConfigs(context.teamId);
      return { items: configs.map(toPublicShape) };
    },
  }),

  dedicatedTool({
    name: "create_esp",
    title: "Create Sending Provider",
    operationId: "settings.esps.create",
    risk: "write",
    description:
      "Creates a new team-owned ESP configuration. Delivery selection is managed separately.",
    inputSchema: z.object({
      name: z.string().trim().min(1).max(100),
      ...connectionFields,
    }),
    outputSchema: espConfigSchema,
    annotations: { openWorldHint: false },
    async handler({ context, args }) {
      const config = await createEspConfig(context.teamId, args);
      invalidateTeamTransport(context.teamId);
      return toPublicShape(config);
    },
  }),

  dedicatedTool({
    name: "get_esp",
    title: "Get Sending Provider",
    operationId: "settings.esps.get",
    risk: "read",
    description: "Returns a single user-managed ESP configuration by its ESP ID.",
    inputSchema: z.object({ espId: z.string().min(1) }),
    outputSchema: espConfigSchema,
    annotations: readOnly,
    async handler({ context, args }) {
      const config = await getEspConfigByEspId(context.teamId, args.espId);
      if (!config) return notFound();
      return toPublicShape(config);
    },
  }),

  dedicatedTool({
    name: "check_esp_domain_authentication",
    title: "Check Domain Authentication",
    operationId: "settings.esps.domainAuthentication",
    risk: "read",
    description:
      "Checks SPF, DKIM and DMARC for the domain of an ESP's From address (live DNS lookups) and returns each check's status, plus the DNS records to add. Records whose value only the provider's console knows (e.g. DKIM keys) have a null value. Pass dkimSelector if the provider uses a custom DKIM selector (for Amazon SES, one Easy DKIM token); a selector that passes is saved on the ESP and reused by later checks.",
    inputSchema: z.object({
      espId: z.string().min(1),
      dkimSelector: domainAuthenticationQuerySchema.shape.dkimSelector,
    }),
    outputSchema: domainAuthenticationSchema,
    annotations: { idempotentHint: true, openWorldHint: true },
    async handler({ context, args }) {
      const config = await getEspConfigByEspId(context.teamId, args.espId);
      if (!config) return notFound();
      const result = await checkAndRememberDomainAuthentication(
        config,
        args.dkimSelector,
      );
      if (!result) {
        return toolError("validation_failed", {
          reason: "from_email_missing",
          message: "Set the ESP's From address first.",
        });
      }
      return result;
    },
  }),

  dedicatedTool({
    name: "update_esp",
    title: "Update Sending Provider",
    operationId: "settings.esps.update",
    risk: "write",
    description:
      "Updates a team-owned ESP configuration by its ESP ID. Omit `password` to keep the existing secret; send an empty string to clear it.",
    inputSchema: z.object({
      espId: z.string().min(1),
      name: z.string().trim().min(1).max(100).optional(),
      provider: connectionFields.provider.optional(),
      host: connectionFields.host.optional(),
      port: connectionFields.port.optional(),
      secure: connectionFields.secure.optional(),
      username: connectionFields.username,
      password: connectionFields.password,
      fromName: connectionFields.fromName,
      fromEmail: connectionFields.fromEmail,
      replyTo: connectionFields.replyTo,
      maxSendRate: connectionFields.maxSendRate,
      dailySendLimit: connectionFields.dailySendLimit,
      warmupTargetDailyVolume: connectionFields.warmupTargetDailyVolume,
    }),
    outputSchema: espConfigSchema,
    annotations: { openWorldHint: false },
    async handler({ context, args }) {
      const { espId, ...patch } = args;
      try {
        const config = await updateEspConfig(context.teamId, espId, patch);
        if (!config) return notFound();
        invalidateEspTransport(context.teamId, config.id);
        return toPublicShape(config);
      } catch (err) {
        return lifecycleError(err);
      }
    },
  }),

  dedicatedTool({
    name: "delete_esp",
    title: "Delete Sending Provider",
    operationId: "settings.esps.remove",
    risk: "destructive",
    description:
      "Deletes an ESP that has never carried delivery history. Blocked when it is the team's live default, is used by a sending sequence or broadcast or by queued email, or has transactional email, delivery feedback or grants (retire it with retire_esp instead). Draft, paused and completed sequences are detached first; sent-mail history is kept.",
    inputSchema: z.object({ espId: z.string().min(1) }),
    outputSchema: successMessageSchema,
    annotations: { openWorldHint: false },
    async handler({ context, args }) {
      const config = await getEspConfigByEspId(context.teamId, args.espId);
      if (!config) return notFound();
      try {
        await deleteEspConfig(context.teamId, args.espId);
      } catch (err) {
        return deleteBlockedError(err);
      }
      invalidateEspTransport(context.teamId, config.id);
      return { message: "ESP configuration removed." };
    },
  }),

  dedicatedTool({
    name: "activate_esp",
    title: "Activate Sending Provider",
    operationId: "settings.esps.activate",
    risk: "write",
    description:
      "Activates a verified team-owned ESP so it can be selected as the team's default or pinned for delivery. Run test_esp successfully after the latest credential or sender change before activating.",
    inputSchema: z.object({ espId: z.string().min(1) }),
    outputSchema: espConfigSchema,
    annotations: { openWorldHint: false },
    async handler({ context, args }) {
      const config = await getEspConfigByEspId(context.teamId, args.espId);
      if (!config) return notFound();
      try {
        return toPublicShape(await transitionEspConfig(config, "activate"));
      } catch (err) {
        if (err instanceof Error && err.message === "esp_verification_required") {
          return toolError("validation_failed", {
            reason: "esp_verification_required",
            message:
              "ESP verification is required: send a successful test after its latest configuration change, and configure a sender email.",
          });
        }
        return lifecycleError(err);
      }
    },
  }),

  dedicatedTool({
    name: "retire_esp",
    title: "Retire Sending Provider",
    operationId: "settings.esps.retire",
    risk: "destructive",
    description:
      "Retires a team-owned ESP (active, suspended or draining) so it no longer sends. This is how an ESP with delivery history is archived; its history stays intact. A retired ESP can be deleted with delete_esp only if it has no history.",
    inputSchema: z.object({ espId: z.string().min(1) }),
    outputSchema: espConfigSchema,
    annotations: { openWorldHint: false },
    async handler({ context, args }) {
      const config = await getEspConfigByEspId(context.teamId, args.espId);
      if (!config) return notFound();
      try {
        const retired = await transitionEspConfig(config, "retire", { cancel: true });
        invalidateEspTransport(context.teamId, config.id);
        return toPublicShape(retired);
      } catch (err) {
        if (err instanceof Error && err.message === "invalid_lifecycle_transition") {
          return toolError("conflict", {
            reason: "invalid_lifecycle_transition",
            message:
              "Only an active, suspended or draining ESP can be retired. Delete a draft ESP instead.",
          });
        }
        throw err;
      }
    },
  }),

  dedicatedTool({
    name: "test_esp",
    title: "Test Sending Provider",
    operationId: "settings.esps.test",
    risk: "write",
    description:
      "Sends a test email through a user-managed ESP (by its ESP ID) to verify it works. Defaults to the current user's own email address if `to` is omitted (OAuth sessions only — API-key sessions must supply `to`).",
    inputSchema: z.object({
      espId: z.string().min(1),
      to: z.string().email().optional(),
    }),
    outputSchema: testEspResultSchema,
    annotations: { openWorldHint: true },
    async handler({ context, args }) {
      const config = await getEspConfigByEspId(context.teamId, args.espId);
      if (!config) return notFound();
      const result = await testEspConfig({
        config,
        to: args.to,
        account: context.user,
        source: "mcp.test_esp",
      });
      return { success: result.success, error: result.error };
    },
  }),
];
