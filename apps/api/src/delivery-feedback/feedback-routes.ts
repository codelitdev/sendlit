import { Router } from "express";
import { createExpressEndpoints, initServer } from "@ts-rest/express";
import { contract } from "@sendlit/api-contract";
import { requireAuth } from "../auth/middleware";
import { requireTeam } from "../auth/require-team";
import { getEspConfigByEspId } from "../settings/esp/queries";
import { getSiteUrl } from "../utils/mail";
import { feedbackCapableProviders } from "../config/constants";
import {
    decryptFeedbackCredentials,
    disableFeedbackConnection,
    getFeedbackConnectionForTeamEsp,
    recordFeedbackConnectionVerified,
    upsertFeedbackConnection,
    type FeedbackConnection,
} from "./feedback-connection-queries";
import { captureEvent } from "../observability/posthog";

const router = Router();
router.use(requireAuth);
router.use(requireTeam);

const s = initServer();

function webhookUrlFor(connection: {
    provider: string;
    connectionId: string;
}): string {
    return `${getSiteUrl()}/webhooks/esp/${connection.provider}/${connection.connectionId}`;
}

function toPublicShape(espId: string, connection: FeedbackConnection) {
    return {
        connectionId: connection.connectionId,
        espId,
        provider: connection.provider,
        webhookUrl: webhookUrlFor(connection),
        hasCredential: Boolean(connection.encryptedCredentials),
        status: connection.status as
            "pending" | "healthy" | "stale" | "error" | "retiring" | "disabled",
        lastReceivedAt: connection.lastReceivedAt?.toISOString() ?? null,
        lastVerifiedAt: connection.lastVerifiedAt?.toISOString() ?? null,
        lastErrorCode: connection.lastErrorCode,
        createdAt: connection.createdAt?.toISOString(),
        updatedAt: connection.updatedAt?.toISOString(),
    };
}

const impl = s.router(contract.feedback, {
    get: async ({ params, req }) => {
        const teamId = (req as any).teamId;
        const esp = await getEspConfigByEspId(teamId, params.espId);
        if (!esp) return { status: 404, body: { error: "ESP not found" } };

        const connection = await getFeedbackConnectionForTeamEsp(
            teamId,
            esp.id,
        );
        return {
            status: 200,
            body: connection ? toPublicShape(esp.espId, connection) : null,
        };
    },
    upsert: async ({ params, body, req }) => {
        const teamId = (req as any).teamId;
        const esp = await getEspConfigByEspId(teamId, params.espId);
        if (!esp) return { status: 404, body: { error: "ESP not found" } };
        if (
            !feedbackCapableProviders.includes(
                esp.provider as (typeof feedbackCapableProviders)[number],
            )
        ) {
            return {
                status: 400,
                body: { error: "feedback_not_supported" },
            };
        }

        const connection = await upsertFeedbackConnection({
            teamId,
            espConfigId: esp.id,
            provider: esp.provider as (typeof feedbackCapableProviders)[number],
            credential: body.credential,
            expectedTopicArn: body.expectedTopicArn,
        });
        captureEvent({
            event: "feedback_connection_upserted",
            source: "settings.esps.feedback.upsert",
            teamId,
            properties: {
                esp_id: esp.espId,
                provider: connection.provider,
                status: connection.status,
            },
        });
        return { status: 200, body: toPublicShape(esp.espId, connection) };
    },
    rotate: async ({ params, body, req }) => {
        const teamId = (req as any).teamId;
        const esp = await getEspConfigByEspId(teamId, params.espId);
        if (!esp) return { status: 404, body: { error: "ESP not found" } };

        const existing = await getFeedbackConnectionForTeamEsp(teamId, esp.id);
        if (!existing) {
            return {
                status: 404,
                body: { error: "feedback_not_configured" },
            };
        }

        const connection = await upsertFeedbackConnection({
            teamId,
            espConfigId: esp.id,
            provider: esp.provider as (typeof feedbackCapableProviders)[number],
            credential: body.credential,
            expectedTopicArn: body.expectedTopicArn,
        });
        captureEvent({
            event: "feedback_connection_rotated",
            source: "settings.esps.feedback.rotate",
            teamId,
            properties: { esp_id: esp.espId, provider: connection.provider },
        });
        return { status: 200, body: toPublicShape(esp.espId, connection) };
    },
    test: async ({ params, req }) => {
        const teamId = (req as any).teamId;
        const esp = await getEspConfigByEspId(teamId, params.espId);
        if (!esp) return { status: 404, body: { error: "ESP not found" } };

        const connection = await getFeedbackConnectionForTeamEsp(
            teamId,
            esp.id,
        );
        if (!connection) {
            return {
                status: 404,
                body: { error: "feedback_not_configured" },
            };
        }

        const decrypted = decryptFeedbackCredentials(connection);
        if (!decrypted) {
            return {
                status: 200,
                body: { success: false, error: "feedback_invalid_credentials" },
            };
        }

        await recordFeedbackConnectionVerified(connection.id);
        captureEvent({
            event: "feedback_connection_tested",
            source: "settings.esps.feedback.test",
            teamId,
            properties: { esp_id: esp.espId, provider: connection.provider },
        });
        return { status: 200, body: { success: true } };
    },
    remove: async ({ params, req }) => {
        const teamId = (req as any).teamId;
        const esp = await getEspConfigByEspId(teamId, params.espId);
        if (!esp) return { status: 404, body: { error: "ESP not found" } };

        const disabled = await disableFeedbackConnection(teamId, esp.id);
        if (!disabled) {
            return {
                status: 404,
                body: { error: "feedback_not_configured" },
            };
        }
        captureEvent({
            event: "feedback_connection_disabled",
            source: "settings.esps.feedback.remove",
            teamId,
            properties: { esp_id: esp.espId },
        });
        return { status: 204, body: undefined };
    },
});

createExpressEndpoints(contract.feedback, impl, router);

export default router;
