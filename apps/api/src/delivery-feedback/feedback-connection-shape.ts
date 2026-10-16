import { getSiteUrl } from "../utils/mail";
import type { FeedbackConnection } from "./feedback-connection-queries";

export function webhookUrlFor(connection: {
    provider: string;
    connectionId: string;
}): string {
    return `${getSiteUrl()}/webhooks/esp/${connection.provider}/${connection.connectionId}`;
}

/** Public shape shared by the team and organization REST routes and the MCP
 * tools — credentials are never returned, only whether one is configured. */
export function toPublicFeedbackConnection(
    espId: string,
    connection: FeedbackConnection,
) {
    return {
        connectionId: connection.connectionId,
        espId,
        provider: connection.provider,
        webhookUrl: webhookUrlFor(connection),
        hasCredential: Boolean(connection.encryptedCredentials),
        expectedTopicArn: connection.expectedTopicArn,
        subscriptionConfirmedAt:
            connection.subscriptionConfirmedAt?.toISOString() ?? null,
        status: connection.status as
            "pending" | "healthy" | "stale" | "error" | "retiring" | "disabled",
        lastReceivedAt: connection.lastReceivedAt?.toISOString() ?? null,
        lastVerifiedAt: connection.lastVerifiedAt?.toISOString() ?? null,
        lastErrorCode: connection.lastErrorCode,
        createdAt: connection.createdAt?.toISOString(),
        updatedAt: connection.updatedAt?.toISOString(),
    };
}

const SNS_TOPIC_ARN =
    /^arn:aws(?:-[a-z]+)*:sns:[a-z0-9-]+:\d{12}:[A-Za-z0-9_-]{1,256}$/;

/** Validates an upsert/rotate body for the ESP's provider — SES is armed by
 * its SNS `TopicArn`, every other provider by a webhook credential. Returns
 * the API error code, or `null` when the input is acceptable. */
export function feedbackConnectionInputError(
    provider: string,
    {
        credential,
        expectedTopicArn,
    }: { credential?: string | null; expectedTopicArn?: string | null },
):
    | "feedback_credential_required"
    | "feedback_topic_arn_required"
    | "feedback_topic_arn_invalid"
    | null {
    if (provider === "ses") {
        if (!expectedTopicArn) return "feedback_topic_arn_required";
        if (!SNS_TOPIC_ARN.test(expectedTopicArn)) {
            return "feedback_topic_arn_invalid";
        }
        return null;
    }
    return credential ? null : "feedback_credential_required";
}
