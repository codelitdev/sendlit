import { generateRfcMessageId } from "../utils/rfc-message-id";
import { getActiveFeedbackConnectionForEspConfig } from "./feedback-connection-queries";
import {
    createOutboundMessage,
    type OutboundMessage,
} from "./outbound-queries";
import type { OutboundSourceType } from "../config/constants";

/**
 * Creates the outbound-ledger row for a `custom`-route send, snapshotting
 * the pinned ESP's provider and any active feedback connection, and
 * generates the RFC `Message-ID` to submit with the transport call. Called
 * before transport submission from both the transactional and campaign send
 * paths (`docs/bounces-and-complaints.md#1-outbound-message-ledger`) so a
 * later provider webhook has something to correlate against.
 */
export async function createCustomRouteOutboundMessage({
    teamId,
    espConfigId,
    provider,
    sourceType,
    submissionKey,
    campaignDeliveryId,
    transactionalEmailId,
    recipientEmail,
    normalizedRecipient,
}: {
    teamId: string;
    espConfigId: string;
    provider: string;
    sourceType: OutboundSourceType;
    submissionKey: string;
    campaignDeliveryId?: string | null;
    transactionalEmailId?: string | null;
    recipientEmail: string;
    normalizedRecipient: string;
}): Promise<{ outbound: OutboundMessage; rfcMessageId: string }> {
    const rfcMessageId = generateRfcMessageId();
    const connection =
        await getActiveFeedbackConnectionForEspConfig(espConfigId);
    const outbound = await createOutboundMessage({
        teamId,
        deliveryRoute: "custom",
        espConfigId,
        feedbackConnectionId: connection?.id ?? null,
        sourceType,
        submissionKey,
        campaignDeliveryId,
        transactionalEmailId,
        recipientEmail,
        normalizedRecipient,
        provider,
        rfcMessageId,
    });
    return { outbound, rfcMessageId: outbound.rfcMessageId || rfcMessageId };
}
