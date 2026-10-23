import { contract } from "@sendlit/api-contract";
import { createExpressEndpoints, initServer } from "@ts-rest/express";
import { Router } from "express";
import { requireAuth } from "../auth/middleware";
import { requireTeam } from "../auth/require-team";
import { captureEvent } from "../observability";
import {
  addOrStrengthenSuppression,
  countSuppressions,
  getSuppressionBySuppressionId,
  listSuppressions,
  releaseSuppression,
  type Suppression,
} from "./suppression-queries";

const router = Router();
router.use("/suppressions", requireAuth, requireTeam);

const s = initServer();

function toPublicShape(suppression: Suppression) {
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
    firstSuppressedAt: suppression.firstSuppressedAt.toISOString(),
    lastSuppressedAt: suppression.lastSuppressedAt.toISOString(),
    releasedAt: suppression.releasedAt?.toISOString() ?? null,
    releaseReason: suppression.releaseReason,
  };
}

const impl = s.router(contract.suppressions, {
  list: async ({ query, req }) => {
    const teamId = (req as any).teamId;
    const filters = { teamId, active: query.active, reason: query.reason };
    const [items, total] = await Promise.all([
      listSuppressions({
        ...filters,
        offset: query.offset,
        rowsPerPage: query.itemsPerPage,
      }),
      countSuppressions(filters),
    ]);
    return {
      status: 200,
      body: { items: items.map(toPublicShape), total },
    };
  },
  create: async ({ body, req }) => {
    const teamId = (req as any).teamId;
    const suppression = await addOrStrengthenSuppression({
      teamId,
      recipientEmail: body.email,
      reason: "manual",
      actorType: "workspace_user",
      actorUserId: (req as any).userId ?? null,
      explanation: body.note ?? null,
    });
    captureEvent({ event: "suppression_added", source: "suppressions.create", teamId });
    return { status: 201, body: toPublicShape(suppression) };
  },
  get: async ({ params, req }) => {
    const teamId = (req as any).teamId;
    const suppression = await getSuppressionBySuppressionId(
      teamId,
      params.suppressionId,
    );
    if (!suppression) {
      return { status: 404, body: { error: "Suppression not found" } };
    }
    return { status: 200, body: toPublicShape(suppression) };
  },
  release: async ({ params, body, req }) => {
    const teamId = (req as any).teamId;
    try {
      const suppression = await releaseSuppression({
        teamId,
        suppressionId: params.suppressionId,
        actorType: "workspace_user",
        actorUserId: (req as any).userId ?? null,
        explanation: body.explanation,
      });
      captureEvent({
        event: "suppression_released",
        source: "suppressions.release",
        teamId,
        properties: {
          suppression_id: suppression.suppressionId,
          reason: suppression.reason,
        },
      });
      return { status: 200, body: toPublicShape(suppression) };
    } catch (err: any) {
      if (err.message === "suppression_not_found") {
        return {
          status: 404,
          body: { error: "Suppression not found" },
        };
      }
      if (err.message === "suppression_not_releasable") {
        return {
          status: 409,
          body: { error: "suppression_not_releasable" },
        };
      }
      throw err;
    }
  },
});

createExpressEndpoints(contract.suppressions, impl, router);

export default router;
