import { feedbackRequirementSchema } from "@sendlit/api-contract";
import { z } from "zod";
import { feedbackCapableProviders } from "../../config/constants";
import {
  countDeliveryEvents,
  type DeliveryEvent,
  getDeliveryEventByEventId,
  listDeliveryEvents,
} from "../../delivery-feedback/delivery-event-queries";
import {
  disableFeedbackConnection,
  feedbackConnectionReadinessError,
  getFeedbackConnectionForTeamEsp,
  recordFeedbackConnectionVerified,
  upsertFeedbackConnection,
} from "../../delivery-feedback/feedback-connection-queries";
import {
  feedbackConnectionInputError,
  toPublicFeedbackConnection,
} from "../../delivery-feedback/feedback-connection-shape";
import { getFeedbackRequirementForTeam } from "../../delivery-feedback/feedback-requirement";
import { getOutboundMessagesByIds } from "../../delivery-feedback/outbound-queries";
import {
  addOrStrengthenSuppression,
  countSuppressions,
  getSuppressionBySuppressionId,
  listSuppressions,
  releaseSuppression,
  type Suppression,
} from "../../delivery-feedback/suppression-queries";
import { getEspConfigByEspId, listEspConfigs } from "../../settings/esp/queries";
import type { SendLitMcpTool } from "../context";
import { dedicatedTool } from "../tool";
import { notFound, toolError } from "./responses";
import {
  deliveryEventListSchema,
  deliveryEventSchema,
  feedbackConnectionSchema,
  successMessageSchema,
  suppressionListSchema,
  suppressionSchema,
  testEspResultSchema,
} from "./schemas";

type FeedbackProvider = (typeof feedbackCapableProviders)[number];

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
      events.map((e) => e.outboundMessageId).filter((id): id is string => Boolean(id)),
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
      espId:
        outbound?.deliverySourceType === "team" && outbound?.espConfigId
          ? (espIdByConfigId.get(outbound.espConfigId) ?? null)
          : null,
      deliverySourceType:
        (outbound?.deliverySourceType as "organization" | "team" | undefined) ?? null,
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
export const deliveryFeedbackTools = (): SendLitMcpTool[] => [
  dedicatedTool({
    name: "get_feedback_requirement",
    operationId: "feedback.requirement",
    title: "Get Feedback Requirement",
    risk: "read",
    description:
      "Whether ESPs need a healthy bounce/complaint feedback connection to keep sending (SendLit Cloud, once the organization has sent `requiredAfterSends` emails), and how many emails it has sent so far. `required` is false on self-hosted SendLit.",
    inputSchema: z.object({}),
    outputSchema: feedbackRequirementSchema,
    annotations: { idempotentHint: true, openWorldHint: false },
    async handler({ context }) {
      return (await getFeedbackRequirementForTeam(context.teamId)) ?? notFound();
    },
  }),

  dedicatedTool({
    name: "get_esp_feedback_connection",
    operationId: "feedback.get",
    title: "Get ESP Feedback Connection",
    risk: "read",
    description:
      "Returns a user ESP's bounce/complaint webhook connection (URL, status, health), or null if not configured yet. Never returns the credential.",
    inputSchema: z.object({ espId: z.string().min(1) }),
    outputSchema: z.object({ connection: feedbackConnectionSchema.nullable() }),
    annotations: { idempotentHint: true, openWorldHint: false },
    async handler({ context, args }) {
      const esp = await getEspConfigByEspId(context.teamId, args.espId);
      if (!esp) return notFound();
      const connection = await getFeedbackConnectionForTeamEsp(context.teamId, esp.id);
      return {
        connection: connection
          ? toPublicFeedbackConnection(esp.espId, connection)
          : null,
      };
    },
  }),

  dedicatedTool({
    name: "upsert_esp_feedback_connection",
    operationId: "feedback.upsert",
    title: "Set Up ESP Feedback Connection",
    risk: "write",
    description:
      "Creates a user ESP's feedback connection (first call) or rotates its credential (later calls) — the webhook URL stays stable across rotation. The provider is always the ESP's current provider (must be one of: " +
      feedbackCapableProviders.join(", ") +
      "). Amazon SES takes `expectedTopicArn` (the SNS topic subscribed to the returned webhook URL) instead of a credential; every other provider requires `credential`.",
    inputSchema: z.object({
      espId: z.string().min(1),
      credential: z
        .string()
        .min(1)
        .optional()
        .describe(
          "The provider's webhook signing secret / shared header value. Required for every provider except SES.",
        ),
      expectedTopicArn: z
        .string()
        .optional()
        .describe(
          "SES only, required: the ARN of the SNS topic SES publishes bounce/complaint events to",
        ),
    }),
    outputSchema: feedbackConnectionSchema,
    annotations: { openWorldHint: false },
    async handler({ context, args }) {
      const esp = await getEspConfigByEspId(context.teamId, args.espId);
      if (!esp) return notFound();
      if (!feedbackCapableProviders.includes(esp.provider as FeedbackProvider)) {
        return toolError("validation_failed", {
          reason: "feedback_provider_unsupported",
          message: `Provider "${esp.provider}" does not have a reviewed feedback adapter yet.`,
        });
      }
      const inputError = feedbackConnectionInputError(esp.provider, args);
      if (inputError) {
        return toolError("validation_failed", {
          reason: "invalid_feedback_connection",
          message: inputError,
        });
      }
      const connection = await upsertFeedbackConnection({
        teamId: context.teamId,
        espConfigId: esp.id,
        provider: esp.provider as FeedbackProvider,
        credential: args.credential,
        expectedTopicArn: args.expectedTopicArn,
      });
      return toPublicFeedbackConnection(esp.espId, connection);
    },
  }),

  dedicatedTool({
    name: "test_esp_feedback_connection",
    operationId: "feedback.test",
    title: "Test ESP Feedback Connection",
    risk: "write",
    description:
      "Checks a feedback connection is fully armed (a smoke test — it does not call the provider): the stored credential decrypts, or for SES, the SNS subscription has been confirmed.",
    inputSchema: z.object({ espId: z.string().min(1) }),
    outputSchema: testEspResultSchema,
    annotations: { openWorldHint: false },
    async handler({ context, args }) {
      const esp = await getEspConfigByEspId(context.teamId, args.espId);
      if (!esp) return notFound();
      const connection = await getFeedbackConnectionForTeamEsp(context.teamId, esp.id);
      if (!connection) return { success: false, error: "feedback_not_configured" };
      const readinessError = feedbackConnectionReadinessError(connection);
      if (readinessError) return { success: false, error: readinessError };
      await recordFeedbackConnectionVerified(connection.id);
      return { success: true };
    },
  }),

  dedicatedTool({
    name: "delete_esp_feedback_connection",
    operationId: "feedback.remove",
    title: "Delete ESP Feedback Connection",
    risk: "destructive",
    description: "Disables a user ESP's feedback connection.",
    inputSchema: z.object({ espId: z.string().min(1) }),
    outputSchema: successMessageSchema,
    annotations: { openWorldHint: false },
    async handler({ context, args }) {
      const esp = await getEspConfigByEspId(context.teamId, args.espId);
      if (!esp) return notFound();
      const disabled = await disableFeedbackConnection(context.teamId, esp.id);
      if (!disabled) return notFound();
      return { message: "Feedback connection disabled." };
    },
  }),

  dedicatedTool({
    name: "list_delivery_events",
    operationId: "deliveryEvents.list",
    title: "List Delivery Events",
    risk: "read",
    description:
      "Returns a paginated list of normalized bounce/complaint/delivery events for the team, most recent first.",
    inputSchema: z.object({
      espId: z.string().min(1).optional(),
      deliverySourceType: z.enum(["organization", "team"]).optional(),
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
    }),
    outputSchema: deliveryEventListSchema,
    annotations: { idempotentHint: true, openWorldHint: false },
    async handler({ context, args }) {
      const teamId = context.teamId;
      let espConfigId: string | undefined;
      if (args.espId) {
        const esp = await getEspConfigByEspId(teamId, args.espId);
        if (!esp) return { items: [], total: 0 };
        espConfigId = esp.id;
      }
      const filters = {
        teamId,
        eventType: args.eventType,
        espConfigId,
        deliverySourceType: args.deliverySourceType,
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
      return { items: await toPublicEvents(teamId, events), total };
    },
  }),

  dedicatedTool({
    name: "get_delivery_event",
    operationId: "deliveryEvents.get",
    title: "Get Delivery Event",
    risk: "read",
    description: "Returns a single normalized delivery event by its ID.",
    inputSchema: z.object({ eventId: z.string() }),
    outputSchema: deliveryEventSchema,
    annotations: { idempotentHint: true, openWorldHint: false },
    async handler({ context, args }) {
      const event = await getDeliveryEventByEventId(context.teamId, args.eventId);
      if (!event) return notFound();
      const [publicEvent] = await toPublicEvents(context.teamId, [event]);
      return publicEvent;
    },
  }),

  dedicatedTool({
    name: "list_suppressions",
    operationId: "suppressions.list",
    title: "List Suppressions",
    risk: "read",
    description:
      "Returns a paginated list of the team's suppressed (do-not-send) recipients.",
    inputSchema: z.object({
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
    }),
    outputSchema: suppressionListSchema,
    annotations: { idempotentHint: true, openWorldHint: false },
    async handler({ context, args }) {
      const filters = {
        teamId: context.teamId,
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
      return { items: items.map(toPublicSuppression), total };
    },
  }),

  dedicatedTool({
    name: "get_suppression",
    operationId: "suppressions.get",
    title: "Get Suppression",
    risk: "read",
    description: "Returns a single suppression by its ID.",
    inputSchema: z.object({ suppressionId: z.string() }),
    outputSchema: suppressionSchema,
    annotations: { idempotentHint: true, openWorldHint: false },
    async handler({ context, args }) {
      const suppression = await getSuppressionBySuppressionId(
        context.teamId,
        args.suppressionId,
      );
      if (!suppression) return notFound();
      return toPublicSuppression(suppression);
    },
  }),

  dedicatedTool({
    name: "release_suppression",
    operationId: "suppressions.release",
    title: "Release Suppression",
    risk: "write",
    description:
      "Releases an active suppression. Only hard_bounce, repeated_soft_bounce, and manual suppressions can be released this way — complaint suppressions require a SendLit operator and are never releasable through this tool.",
    inputSchema: z.object({
      suppressionId: z.string(),
      explanation: z.string().min(1).max(2000).optional(),
    }),
    outputSchema: suppressionSchema,
    annotations: { openWorldHint: false },
    async handler({ context, args }) {
      try {
        const suppression = await releaseSuppression({
          teamId: context.teamId,
          suppressionId: args.suppressionId,
          actorType: "workspace_user",
          actorUserId: context.user?.id ?? null,
          explanation: args.explanation,
        });
        return toPublicSuppression(suppression);
      } catch (err: any) {
        if (err?.message === "suppression_not_found") return notFound();
        if (err?.message === "suppression_not_releasable") {
          return toolError("forbidden", {
            reason: "suppression_not_releasable",
            message:
              "This suppression cannot be released by a workspace user (e.g. a complaint suppression) — it requires a SendLit operator.",
          });
        }
        throw err;
      }
    },
  }),

  dedicatedTool({
    name: "add_suppression",
    operationId: "suppressions.create",
    title: "Add Suppression",
    risk: "write",
    description:
      "Suppresses an address for the team (reason `manual`): SendLit never mails it again (broadcasts, sequences or transactional) until released. For role accounts, legal requests or known spam traps.",
    inputSchema: z.object({
      email: z.string().email(),
      note: z.string().max(2000).optional().describe("Why; kept in the audit trail"),
    }),
    outputSchema: suppressionSchema,
    annotations: { idempotentHint: true, openWorldHint: false },
    async handler({ context, args }) {
      const suppression = await addOrStrengthenSuppression({
        teamId: context.teamId,
        recipientEmail: args.email,
        reason: "manual",
        actorType: "workspace_user",
        actorUserId: context.user?.id ?? null,
        explanation: args.note ?? null,
      });
      return toPublicSuppression(suppression);
    },
  }),
];
