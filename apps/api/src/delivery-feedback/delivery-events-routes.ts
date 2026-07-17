import { Router } from "express";
import { createExpressEndpoints, initServer } from "@ts-rest/express";
import { contract } from "@sendlit/api-contract";
import { requireAuth } from "../auth/middleware";
import { requireTeam } from "../auth/require-team";
import { listEspConfigs, getEspConfigByEspId } from "../settings/esp/queries";
import {
    countDeliveryEvents,
    getDeliveryEventByEventId,
    listDeliveryEvents,
    type DeliveryEvent,
} from "./delivery-event-queries";
import { getOutboundMessagesByIds } from "./outbound-queries";

const router = Router();
router.use(requireAuth);
router.use(requireTeam);

const s = initServer();

async function toPublicEvents(teamId: string, events: DeliveryEvent[]) {
    const [espConfigs, outboundById] = await Promise.all([
        listEspConfigs(teamId),
        getOutboundMessagesByIds(
            events
                .map((e) => e.outboundMessageId)
                .filter((id): id is string => Boolean(id)),
        ),
    ]);
    const espIdByConfigId = new Map(espConfigs.map((c) => [c.id, c.espId]));

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
            eventType: event.eventType as any,
            bounceClass: event.bounceClass as any,
            smtpCode: event.smtpCode,
            enhancedStatusCode: event.enhancedStatusCode,
            reason: event.reason,
            occurredAt: event.occurredAt.toISOString(),
            receivedAt: event.receivedAt.toISOString(),
        };
    });
}

const impl = s.router(contract.deliveryEvents, {
    list: async ({ query, req }) => {
        const teamId = (req as any).teamId;
        let espConfigId: string | undefined;
        if (query.espId) {
            const esp = await getEspConfigByEspId(teamId, query.espId);
            if (!esp) return { status: 200, body: { items: [], total: 0 } };
            espConfigId = esp.id;
        }

        const filters = {
            teamId,
            eventType: query.eventType,
            espConfigId,
            deliveryRoute: query.deliveryRoute,
            createdAfter: query.createdAfter,
            createdBefore: query.createdBefore,
        };
        const [events, total] = await Promise.all([
            listDeliveryEvents({
                ...filters,
                offset: query.offset,
                rowsPerPage: query.itemsPerPage,
            }),
            countDeliveryEvents(filters),
        ]);
        return {
            status: 200,
            body: { items: await toPublicEvents(teamId, events), total },
        };
    },
    get: async ({ params, req }) => {
        const teamId = (req as any).teamId;
        const event = await getDeliveryEventByEventId(teamId, params.eventId);
        if (!event) {
            return { status: 404, body: { error: "Delivery event not found" } };
        }
        const [publicEvent] = await toPublicEvents(teamId, [event]);
        return { status: 200, body: publicEvent };
    },
});

createExpressEndpoints(contract.deliveryEvents, impl, router);

export default router;
