import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
    getEspConfigByEspId,
    listEspConfigs,
} from "../../settings/esp/queries";
import { getSiteUrl } from "../../utils/mail";
import { feedbackCapableProviders as feedbackCapableProvidersConst } from "../../config/constants";
import {
    decryptFeedbackCredentials,
    disableFeedbackConnection,
    getFeedbackConnectionForTeamEsp,
    recordFeedbackConnectionVerified,
    upsertFeedbackConnection,
    type FeedbackConnection,
} from "../../delivery-feedback/feedback-connection-queries";
import {
    countDeliveryEvents,
    getDeliveryEventByEventId,
    listDeliveryEvents,
    type DeliveryEvent,
} from "../../delivery-feedback/delivery-event-queries";
import { getOutboundMessagesByIds } from "../../delivery-feedback/outbound-queries";
import {
    countSuppressions,
    getSuppressionBySuppressionId,
    listSuppressions,
    releaseSuppression,
    type Suppression,
} from "../../delivery-feedback/suppression-queries";
import { AUTH_ERROR, NOT_FOUND, errorResult, jsonResult } from "./responses";
import {
    deliveryEventListSchema,
    deliveryEventSchema,
    feedbackConnectionSchema,
    successMessageSchema,
    suppressionListSchema,
    suppressionSchema,
    testEspResultSchema,
} from "./schemas";
import { getAuthAccount, getTeamId } from "./auth";

function webhookUrlFor(connection: {
    provider: string;
    connectionId: string;
}): string {
    return `${getSiteUrl()}/webhooks/esp/${connection.provider}/${connection.connectionId}`;
}

function toPublicConnection(espId: string, connection: FeedbackConnection) {
    return {
        connectionId: connection.connectionId,
        espId,
        provider: connection.provider,
        webhookUrl: webhookUrlFor(connection),
        hasCredential: Boolean(connection.encryptedCredentials),
        status: connection.status as
            "pending" | "healthy" | "stale" | "error" | "retiring" | "disabled",
        lastReceivedAt: connection.lastReceivedAt,
        lastVerifiedAt: connection.lastVerifiedAt,
        lastErrorCode: connection.lastErrorCode,
    };
}

function toPublicSuppression(suppression: Suppression) {
    return {
        suppressionId: suppression.suppressionId,
        recipientEmail: suppression.recipientEmail,
        reason: suppression.reason as
            | "hard_bounce"
            | "complaint"
            | "repeated_soft_bounce"
            | "provider_suppression"
            | "manual",
        active: suppression.active,
        firstSuppressedAt: suppression.firstSuppressedAt,
        lastSuppressedAt: suppression.lastSuppressedAt,
        releasedAt: suppression.releasedAt,
        releaseReason: suppression.releaseReason,
    };
}

async function toPublicEvents(teamId: string, events: DeliveryEvent[]) {
    const [esps, outboundById] = await Promise.all([
        listEspConfigs(teamId),
        getOutboundMessagesByIds(
            events
                .map((e) => e.outboundMessageId)
                .filter((id): id is string => Boolean(id)),
        ),
    ]);
    const espIdByConfigId = new Map(esps.map((c) => [c.id, c.espId]));
    return events.map((event) => {
        const outbound = event.outboundMessageId
            ? outboundById.get(event.outboundMessageId)
            : undefined;
        return {
            eventId: event.eventId,
            provider: event.provider,
            espId: outbound?.espConfigId
                ? (espIdByConfigId.get(outbound.espConfigId) ?? null)
                : null,
            deliveryRoute:
                (outbound?.deliveryRoute as
                    "custom" | "platform" | undefined) ?? null,
            messageId: outbound?.messageId ?? null,
            recipientEmail: event.recipientEmail,
            eventType: event.eventType,
            bounceClass: event.bounceClass,
            reason: event.reason,
            occurredAt: event.occurredAt,
            receivedAt: event.receivedAt,
        };
    });
}

/**
 * MCP tools for `docs/bounces-and-complaints.md` — mirrors the
 * `/settings/esps/:espId/feedback`, `/delivery-events`, and `/suppressions`
 * REST resources so MCP clients get the same collection-aware, tenant-scoped
 * behavior. Only providers with a reviewed adapter
 * (`feedbackCapableProviders`) can be configured.
 */
export function registerDeliveryFeedbackTools(server: McpServer): void {
    server.registerTool(
        "get_esp_feedback_connection",
        {
            description:
                "Returns a user ESP's bounce/complaint webhook connection (URL, status, health), or null if not configured yet. Never returns the credential.",
            inputSchema: { espId: z.string().min(1) },
            outputSchema: z.object({
                connection: feedbackConnectionSchema.nullable(),
            }),
            annotations: {
                readOnlyHint: true,
                idempotentHint: true,
                openWorldHint: false,
            },
        },
        async (args: any, extra: any) => {
            const teamId = getTeamId(extra);
            if (!teamId) return AUTH_ERROR;
            const esp = await getEspConfigByEspId(teamId, args.espId);
            if (!esp) return NOT_FOUND;
            const connection = await getFeedbackConnectionForTeamEsp(
                teamId,
                esp.id,
            );
            return jsonResult({
                connection: connection
                    ? toPublicConnection(esp.espId, connection)
                    : null,
            });
        },
    );

    server.registerTool(
        "upsert_esp_feedback_connection",
        {
            description:
                "Creates a user ESP's feedback connection (first call) or rotates its credential (later calls) — the webhook URL stays stable across rotation. The provider is always the ESP's current provider (must be one of: " +
                feedbackCapableProvidersConst.join(", ") +
                ").",
            inputSchema: {
                espId: z.string().min(1),
                credential: z
                    .string()
                    .min(1)
                    .describe(
                        "The provider's webhook signing secret / shared header value",
                    ),
                expectedTopicArn: z
                    .string()
                    .optional()
                    .describe("SES only — reserved, not yet usable"),
            },
            outputSchema: feedbackConnectionSchema,
            annotations: {
                readOnlyHint: false,
                destructiveHint: false,
                openWorldHint: false,
            },
        },
        async (args: any, extra: any) => {
            const teamId = getTeamId(extra);
            if (!teamId) return AUTH_ERROR;
            const esp = await getEspConfigByEspId(teamId, args.espId);
            if (!esp) return NOT_FOUND;
            if (
                !feedbackCapableProvidersConst.includes(
                    esp.provider as (typeof feedbackCapableProvidersConst)[number],
                )
            ) {
                return errorResult(
                    `Provider "${esp.provider}" does not have a reviewed feedback adapter yet.`,
                );
            }
            const connection = await upsertFeedbackConnection({
                teamId,
                espConfigId: esp.id,
                provider:
                    esp.provider as (typeof feedbackCapableProvidersConst)[number],
                credential: args.credential,
                expectedTopicArn: args.expectedTopicArn,
            });
            return jsonResult(toPublicConnection(esp.espId, connection));
        },
    );

    server.registerTool(
        "test_esp_feedback_connection",
        {
            description:
                "Verifies a feedback connection's stored credential can be decrypted (a smoke test — it does not call the provider).",
            inputSchema: { espId: z.string().min(1) },
            outputSchema: testEspResultSchema,
            annotations: {
                readOnlyHint: false,
                destructiveHint: false,
                openWorldHint: false,
            },
        },
        async (args: any, extra: any) => {
            const teamId = getTeamId(extra);
            if (!teamId) return AUTH_ERROR;
            const esp = await getEspConfigByEspId(teamId, args.espId);
            if (!esp) return NOT_FOUND;
            const connection = await getFeedbackConnectionForTeamEsp(
                teamId,
                esp.id,
            );
            if (!connection) {
                return jsonResult({
                    success: false,
                    error: "feedback_not_configured",
                });
            }
            const decrypted = decryptFeedbackCredentials(connection);
            if (!decrypted) {
                return jsonResult({
                    success: false,
                    error: "feedback_invalid_credentials",
                });
            }
            await recordFeedbackConnectionVerified(connection.id);
            return jsonResult({ success: true });
        },
    );

    server.registerTool(
        "delete_esp_feedback_connection",
        {
            description: "Disables a user ESP's feedback connection.",
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
            const esp = await getEspConfigByEspId(teamId, args.espId);
            if (!esp) return NOT_FOUND;
            const disabled = await disableFeedbackConnection(teamId, esp.id);
            if (!disabled) return NOT_FOUND;
            return jsonResult({ message: "Feedback connection disabled." });
        },
    );

    server.registerTool(
        "list_delivery_events",
        {
            description:
                "Returns a paginated list of normalized bounce/complaint/delivery events for the team, most recent first.",
            inputSchema: {
                espId: z.string().min(1).optional(),
                deliveryRoute: z.enum(["custom", "platform"]).optional(),
                eventType: z
                    .enum([
                        "accepted",
                        "delivered",
                        "delayed",
                        "soft_bounce",
                        "hard_bounce",
                        "failed",
                        "complaint",
                        "suppressed",
                        "rejected",
                        "unknown",
                    ])
                    .optional(),
                createdAfter: z
                    .number()
                    .int()
                    .optional()
                    .describe("Millisecond timestamp lower bound (inclusive)"),
                createdBefore: z
                    .number()
                    .int()
                    .optional()
                    .describe("Millisecond timestamp upper bound (exclusive)"),
                offset: z.number().int().min(1).optional(),
                itemsPerPage: z.number().int().min(1).optional(),
            },
            outputSchema: deliveryEventListSchema,
            annotations: {
                readOnlyHint: true,
                idempotentHint: true,
                openWorldHint: false,
            },
        },
        async (args: any, extra: any) => {
            const teamId = getTeamId(extra);
            if (!teamId) return AUTH_ERROR;
            let espConfigId: string | undefined;
            if (args.espId) {
                const esp = await getEspConfigByEspId(teamId, args.espId);
                if (!esp) return jsonResult({ items: [], total: 0 });
                espConfigId = esp.id;
            }
            const filters = {
                teamId,
                eventType: args.eventType,
                espConfigId,
                deliveryRoute: args.deliveryRoute,
                createdAfter: args.createdAfter,
                createdBefore: args.createdBefore,
            };
            const [events, total] = await Promise.all([
                listDeliveryEvents({
                    ...filters,
                    offset: args.offset,
                    rowsPerPage: args.itemsPerPage,
                }),
                countDeliveryEvents(filters),
            ]);
            return jsonResult({
                items: await toPublicEvents(teamId, events),
                total,
            });
        },
    );

    server.registerTool(
        "get_delivery_event",
        {
            description:
                "Returns a single normalized delivery event by its ID.",
            inputSchema: { eventId: z.string() },
            outputSchema: deliveryEventSchema,
            annotations: {
                readOnlyHint: true,
                idempotentHint: true,
                openWorldHint: false,
            },
        },
        async (args: any, extra: any) => {
            const teamId = getTeamId(extra);
            if (!teamId) return AUTH_ERROR;
            const event = await getDeliveryEventByEventId(teamId, args.eventId);
            if (!event) return NOT_FOUND;
            const [publicEvent] = await toPublicEvents(teamId, [event]);
            return jsonResult(publicEvent);
        },
    );

    server.registerTool(
        "list_suppressions",
        {
            description:
                "Returns a paginated list of the team's suppressed (do-not-send) recipients.",
            inputSchema: {
                active: z.boolean().optional(),
                reason: z
                    .enum([
                        "hard_bounce",
                        "complaint",
                        "repeated_soft_bounce",
                        "provider_suppression",
                        "manual",
                    ])
                    .optional(),
                offset: z.number().int().min(1).optional(),
                itemsPerPage: z.number().int().min(1).optional(),
            },
            outputSchema: suppressionListSchema,
            annotations: {
                readOnlyHint: true,
                idempotentHint: true,
                openWorldHint: false,
            },
        },
        async (args: any, extra: any) => {
            const teamId = getTeamId(extra);
            if (!teamId) return AUTH_ERROR;
            const filters = {
                teamId,
                active: args.active,
                reason: args.reason,
            };
            const [items, total] = await Promise.all([
                listSuppressions({
                    ...filters,
                    offset: args.offset,
                    rowsPerPage: args.itemsPerPage,
                }),
                countSuppressions(filters),
            ]);
            return jsonResult({
                items: items.map(toPublicSuppression),
                total,
            });
        },
    );

    server.registerTool(
        "get_suppression",
        {
            description: "Returns a single suppression by its ID.",
            inputSchema: { suppressionId: z.string() },
            outputSchema: suppressionSchema,
            annotations: {
                readOnlyHint: true,
                idempotentHint: true,
                openWorldHint: false,
            },
        },
        async (args: any, extra: any) => {
            const teamId = getTeamId(extra);
            if (!teamId) return AUTH_ERROR;
            const suppression = await getSuppressionBySuppressionId(
                teamId,
                args.suppressionId,
            );
            if (!suppression) return NOT_FOUND;
            return jsonResult(toPublicSuppression(suppression));
        },
    );

    server.registerTool(
        "release_suppression",
        {
            description:
                "Releases an active suppression. Only hard_bounce, repeated_soft_bounce, and manual suppressions can be released this way — complaint suppressions require a SendLit operator and are never releasable through this tool.",
            inputSchema: {
                suppressionId: z.string(),
                explanation: z.string().min(1).max(2000).optional(),
            },
            outputSchema: suppressionSchema,
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
                const suppression = await releaseSuppression({
                    teamId,
                    suppressionId: args.suppressionId,
                    actorType: "workspace_user",
                    actorUserId: getAuthAccount(extra)?.id ?? null,
                    explanation: args.explanation,
                });
                return jsonResult(toPublicSuppression(suppression));
            } catch (err: any) {
                if (err.message === "suppression_not_found") return NOT_FOUND;
                if (err.message === "suppression_not_releasable") {
                    return errorResult(
                        "This suppression cannot be released by a workspace user (e.g. a complaint suppression) — it requires a SendLit operator.",
                    );
                }
                throw err;
            }
        },
    );
}
