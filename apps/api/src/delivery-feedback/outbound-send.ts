import { generateRfcMessageId } from "../utils/rfc-message-id";
import { getActiveFeedbackConnectionForEspConfig } from "./feedback-connection-queries";
import {
    createOutboundMessage,
    type OutboundMessage,
} from "./outbound-queries";
import type { OutboundSourceType } from "../config/constants";
import { SES_MESSAGE_TAG } from "./adapters/ses";
import { db } from "../db/client";
import { teams } from "../db/schema";
import { reserveSend } from "../billing/entitlements";
import { reserveOrganizationQuota } from "../delivery/quota";
import { eq } from "drizzle-orm";

/**
 * Creates the outbound-ledger row for an already-authorized pinned source,
 * the pinned ESP's provider and any active feedback connection, and
 * generates the RFC `Message-ID` to submit with the transport call. Called
 * before transport submission from both the transactional and campaign send
 * paths (`docs/bounces-and-complaints.md#1-outbound-message-ledger`) so a
 * later provider webhook has something to correlate against.
 */
export async function createPinnedOutboundMessage({
    teamId,
    deliverySourceType,
    espConfigId,
    espGrantId,
    provider,
    sourceType,
    submissionKey,
    campaignDeliveryId,
    transactionalEmailId,
    recipientEmail,
    normalizedRecipient,
    organizationQuotaGrantId,
}: {
    teamId: string;
    deliverySourceType: "organization" | "team";
    espConfigId: string;
    espGrantId: string | null;
    provider: string;
    sourceType: OutboundSourceType;
    submissionKey: string;
    campaignDeliveryId?: string | null;
    transactionalEmailId?: string | null;
    recipientEmail: string;
    normalizedRecipient: string;
    organizationQuotaGrantId?: string | null;
}): Promise<{ outbound: OutboundMessage; rfcMessageId: string }> {
    const rfcMessageId = generateRfcMessageId();
    const connection =
        await getActiveFeedbackConnectionForEspConfig(espConfigId);
    const [team] = await db
        .select({ organizationId: teams.organizationId })
        .from(teams)
        .where(eq(teams.id, teamId))
        .limit(1);
    if (!team) throw new Error("team_not_found");
    const outbound = await db.transaction(async (tx) => {
        const created = await createOutboundMessage({
            teamId,
            deliverySourceType,
            espConfigId,
            espGrantId,
            feedbackConnectionId: connection?.id ?? null,
            sourceType,
            submissionKey,
            campaignDeliveryId,
            transactionalEmailId,
            recipientEmail,
            normalizedRecipient,
            provider,
            rfcMessageId,
            tx,
        });
        // A prior attempt may already have reached the provider. Do not run a
        // fresh plan gate for that terminal ledger row; callers can complete
        // their local workflow action idempotently without resubmitting mail.
        if (created.deliveryStatus === "accepted") return created;
        await reserveSend(tx, {
            organizationId: team.organizationId,
            outboundMessageId: created.id,
            purpose: sourceType === "campaign" ? "marketing" : "transactional",
        });
        if (organizationQuotaGrantId) {
            await reserveOrganizationQuota(tx, {
                outboundMessageId: created.id,
                grantId: organizationQuotaGrantId,
            });
        }
        return created;
    });
    return { outbound, rfcMessageId: outbound.rfcMessageId || rfcMessageId };
}

/** SES's SMTP interface answers `250 Ok <ses-message-id>`, and that id is
 * what SES events carry as `mail.messageId`. Other providers keep the raw
 * response line, as before. */
const SES_SMTP_RESPONSE = /^250\s+Ok\s+(\S+)/i;

export function extractProviderMessageId(
    provider: string | null,
    response: string | null,
): string | null {
    if (provider === "ses" && response) {
        const match = response.match(SES_SMTP_RESPONSE);
        if (match) return match[1];
    }
    return response;
}

/**
 * Adds the provider headers that let a later webhook correlate straight back
 * to the outbound row. For SES that's a `sendlit_message_id` message tag,
 * merged with any tags the caller already set.
 */
export function withCorrelationHeaders(
    outbound: Pick<OutboundMessage, "provider" | "messageId"> | null,
    headers?: Record<string, string>,
): Record<string, string> | undefined {
    if (outbound?.provider !== "ses") return headers;
    const tag = `${SES_MESSAGE_TAG}=${outbound.messageId}`;
    const merged = { ...headers };
    const existingKey = Object.keys(merged).find(
        (key) => key.toLowerCase() === "x-ses-message-tags",
    );
    if (existingKey) {
        merged[existingKey] = `${merged[existingKey]}, ${tag}`;
    } else {
        merged["X-SES-MESSAGE-TAGS"] = tag;
    }
    return merged;
}
