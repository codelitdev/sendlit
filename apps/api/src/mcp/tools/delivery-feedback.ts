import { z } from "zod";
import {
  countDeliveryEvents,
  type DeliveryEvent,
  listDeliveryEvents,
} from "../../delivery-feedback/delivery-event-queries";
import { getOutboundMessagesByIds } from "../../delivery-feedback/outbound-queries";
import { getEspConfigByEspId, listEspConfigs } from "../../settings/esp/queries";
import type { SendLitMcpTool } from "../context";
import { dedicatedTool } from "../tool";
import { deliveryEventListSchema } from "./schemas";

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
 * The delivery-events side of `docs/bounces-and-complaints.md`, mirroring
 * `GET /delivery-events`. Feedback connections and suppressions are reachable
 * through the generic `api.*` tools.
 */
export const deliveryEventTools = (): SendLitMcpTool[] => [
  dedicatedTool({
    name: "list_delivery_events",
    operationId: "deliveryEvents.list",
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
];
