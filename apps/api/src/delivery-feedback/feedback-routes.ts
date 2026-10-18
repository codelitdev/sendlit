import { contract } from "@sendlit/api-contract";
import { createExpressEndpoints, initServer } from "@ts-rest/express";
import { Router } from "express";
import { requireAuth } from "../auth/middleware";
import { requireTeam } from "../auth/require-team";
import { feedbackCapableProviders } from "../config/constants";
import { captureEvent } from "../observability";
import { getEspConfigByEspId } from "../settings/esp/queries";
import {
  disableFeedbackConnection,
  feedbackConnectionReadinessError,
  getFeedbackConnectionForTeamEsp,
  recordFeedbackConnectionVerified,
  upsertFeedbackConnection,
} from "./feedback-connection-queries";
import {
  feedbackConnectionInputError,
  toPublicFeedbackConnection,
} from "./feedback-connection-shape";

const router = Router();
router.use("/settings/esps/:espId/feedback", requireAuth, requireTeam);

const s = initServer();

const impl = s.router(contract.feedback, {
  get: async ({ params, req }) => {
    const teamId = (req as any).teamId;
    const esp = await getEspConfigByEspId(teamId, params.espId);
    if (!esp) return { status: 404, body: { error: "ESP not found" } };

    const connection = await getFeedbackConnectionForTeamEsp(teamId, esp.id);
    return {
      status: 200,
      body: connection ? toPublicFeedbackConnection(esp.espId, connection) : null,
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
    const inputError = feedbackConnectionInputError(esp.provider, body);
    if (inputError) return { status: 400, body: { error: inputError } };

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
    return {
      status: 200,
      body: toPublicFeedbackConnection(esp.espId, connection),
    };
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
    const inputError = feedbackConnectionInputError(esp.provider, body);
    if (inputError) return { status: 400, body: { error: inputError } };

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
    return {
      status: 200,
      body: toPublicFeedbackConnection(esp.espId, connection),
    };
  },
  test: async ({ params, req }) => {
    const teamId = (req as any).teamId;
    const esp = await getEspConfigByEspId(teamId, params.espId);
    if (!esp) return { status: 404, body: { error: "ESP not found" } };

    const connection = await getFeedbackConnectionForTeamEsp(teamId, esp.id);
    if (!connection) {
      return {
        status: 404,
        body: { error: "feedback_not_configured" },
      };
    }

    const readinessError = feedbackConnectionReadinessError(connection);
    if (readinessError) {
      return {
        status: 200,
        body: { success: false, error: readinessError },
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
