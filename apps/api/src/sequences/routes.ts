import { contract } from "@sendlit/api-contract";
import { createExpressEndpoints, initServer } from "@ts-rest/express";
import { Router } from "express";
import { broadcastPacing } from "../abuse/pacing-status";
import { requireAuth } from "../auth/middleware";
import { requireTeam } from "../auth/require-team";
import { sequenceDeliveryRates } from "../automation/sending-health";
import { planGateHttp } from "../billing/errors";
import { captureEvent } from "../observability";
import { MAILING_ADDRESS_REQUIRED } from "../settings/general/constants";
import { omitInternal } from "../utils/public";
import { serializeDates } from "../utils/serialize";
import {
  toWebPublishing,
  updateWebPublishing,
  WebPublishingError,
} from "../web/queries";
import {
  addMailToSequence,
  countSequences,
  createSequence,
  deleteMailFromSequence,
  deleteSequence,
  getSequenceDeletionImpact,
  getEmailSentCount,
  getSequenceBySequenceId,
  getSequenceClickThroughRate,
  getSequenceOpenRate,
  getSubscribers,
  getSubscribersCount,
  type HydratedSequence,
  listSequences,
  pauseSequence,
  startSequence,
  updateMailInSequence,
  updateSequence,
} from "./queries";
import { isSequenceDeleteBlocker } from "./delete-blockers";
import { sendSequenceEmailTest } from "./test-send";

const router = Router();
router.use("/sequences", requireAuth, requireTeam);

const s = initServer();

// `content`/`filter`/`report` are jsonb columns (typed `unknown` by Drizzle),
// looser than the contract's schema — same rationale as `templates/routes.ts`.
//
// `sequenceEmails.sequenceId` stores its *parent* sequence's internal `id`
// (see the file-level doc comment in `db/schema.ts`) — it's dropped here
// rather than exposed, since it's an internal join key, not a public ID.
function toBody(sequence: HydratedSequence): any {
  return serializeDates({
    ...omitInternal(sequence, [
      "outboxId",
      "espGrantId",
      "deliverySourceType",
      "deliverySourceIntent",
      // Served by `/sequences/:sequenceId/web`.
      "webPublished",
      "webSlug",
      "webSeoTitle",
      "webSeoDescription",
      "webOgImage",
      "webNoindex",
      "webCanonicalUrl",
    ]),
    emails: sequence.emails.map((email) =>
      omitInternal(email, ["sequenceId", "contentScanHash", "contentScanReasons"]),
    ),
  });
}

const impl = s.router(contract.sequences, {
  create: async ({ body, req }) => {
    try {
      const sequence = await createSequence({
        teamId: (req as any).teamId,
        ...body,
      });
      return { status: 201, body: toBody(sequence) };
    } catch (err: any) {
      if (err.message === "template_not_marketing") {
        return {
          status: 422,
          body: { error: "template_not_marketing" },
        };
      }
      return { status: 400, body: { error: err.message } };
    }
  },
  list: async ({ query, req }) => {
    const teamId = (req as any).teamId;
    const [items, total] = await Promise.all([
      listSequences({
        teamId,
        type: query.type,
        offset: query.offset,
        itemsPerPage: query.itemsPerPage,
      }),
      countSequences(teamId, query.type),
    ]);
    return { status: 200, body: { items: items.map(toBody), total } };
  },
  get: async ({ params, req }) => {
    const sequence = await getSequenceBySequenceId(
      (req as any).teamId,
      params.sequenceId,
    );
    if (!sequence) return { status: 404, body: { error: "Sequence not found" } };
    return {
      status: 200,
      body: { ...toBody(sequence), pacing: await broadcastPacing(sequence) },
    };
  },
  update: async ({ params, body, req }) => {
    try {
      const sequence = await updateSequence({
        teamId: (req as any).teamId,
        sequenceId: params.sequenceId,
        ...body,
      } as any);
      if (!sequence) return { status: 404, body: { error: "Sequence not found" } };
      return { status: 200, body: toBody(sequence) };
    } catch (err: any) {
      return { status: 400, body: { error: err.message } };
    }
  },
  addEmail: async ({ params, body, req }) => {
    try {
      const sequence = await addMailToSequence({
        teamId: (req as any).teamId,
        sequenceId: params.sequenceId,
        templateId: body.templateId,
      });
      if (!sequence) return { status: 404, body: { error: "Sequence not found" } };
      return { status: 201, body: toBody(sequence) };
    } catch (err: any) {
      if (err.message === "template_not_marketing") {
        return {
          status: 422,
          body: { error: "template_not_marketing" },
        };
      }
      return { status: 400, body: { error: err.message } };
    }
  },
  updateEmail: async ({ params, body, req }) => {
    try {
      const sequence = await updateMailInSequence({
        teamId: (req as any).teamId,
        sequenceId: params.sequenceId,
        emailId: params.emailId,
        ...body,
      });
      if (!sequence) return { status: 404, body: { error: "Sequence not found" } };
      return { status: 200, body: toBody(sequence) };
    } catch (err: any) {
      if (err.message === "template_not_marketing") {
        return {
          status: 422,
          body: { error: "template_not_marketing" },
        };
      }
      return { status: 400, body: { error: err.message } };
    }
  },
  sendEmailTest: async ({ params, body, req }) => {
    try {
      const result = await sendSequenceEmailTest({
        teamId: (req as any).teamId,
        sequenceId: params.sequenceId,
        emailId: params.emailId,
        to: body.to,
        fallbackRecipient: (req as any).user?.email,
      });
      return { status: 200, body: result };
    } catch (err: any) {
      const gated = planGateHttp(err);
      if (gated) return gated as any;
      if (err.message === "sequence_not_found" || err.message === "email_not_found") {
        return { status: 404, body: { error: err.message } };
      }
      if (
        err.message === "test_send_limit_reached" ||
        err.message === "test_send_email_limit_reached" ||
        err.message === "organization_team_quota_exhausted" ||
        err.message === "organization_quota_exhausted"
      ) {
        return { status: 429, body: { error: err.message } };
      }
      if (err.message === MAILING_ADDRESS_REQUIRED) {
        return {
          status: 400,
          body: {
            error: "A mailing address is required for broadcasts and sequences.",
          },
        };
      }
      return { status: 400, body: { error: err.message } };
    }
  },
  removeEmail: async ({ params, req }) => {
    try {
      const sequence = await deleteMailFromSequence({
        teamId: (req as any).teamId,
        sequenceId: params.sequenceId,
        emailId: params.emailId,
      });
      if (!sequence) return { status: 404, body: { error: "Sequence not found" } };
      return { status: 200, body: toBody(sequence) };
    } catch (err: any) {
      return { status: 400, body: { error: err.message } };
    }
  },
  remove: async ({ params, req }) => {
    const teamId = (req as any).teamId;
    let deleted: boolean;
    try {
      deleted = await deleteSequence({ teamId, sequenceId: params.sequenceId });
    } catch (err: any) {
      if (isSequenceDeleteBlocker(err.message)) {
        captureEvent({
          event: "sequence_delete_blocked",
          source: "sequences.remove",
          teamId,
          properties: { sequence_id: params.sequenceId, reason: err.message },
        });
        return { status: 409, body: { error: err.message } };
      }
      throw err;
    }
    if (!deleted) return { status: 404, body: { error: "Sequence not found" } };
    return { status: 204, body: undefined };
  },
  deletionPreview: async ({ params, req }) => {
    const preview = await getSequenceDeletionImpact(
      (req as any).teamId,
      params.sequenceId,
    );
    if (!preview) return { status: 404, body: { error: "Sequence not found" } };
    return { status: 200, body: preview };
  },
  start: async ({ params, req }) => {
    try {
      const sequence = await startSequence({
        teamId: (req as any).teamId,
        sequenceId: params.sequenceId,
      });
      return { status: 200, body: toBody(sequence) };
    } catch (err: any) {
      const gated = planGateHttp(err);
      if (gated) return gated as any;
      return err.message === MAILING_ADDRESS_REQUIRED
        ? {
            status: 422,
            body: {
              error: "A mailing address is required for broadcasts and sequences.",
            },
          }
        : err.message === "esp_not_configured"
          ? {
              status: 422,
              body: { error: "Team ESP is not configured." },
            }
          : { status: 400, body: { error: err.message } };
    }
  },
  pause: async ({ params, req }) => {
    try {
      const sequence = await pauseSequence({
        teamId: (req as any).teamId,
        sequenceId: params.sequenceId,
      });
      return { status: 200, body: toBody(sequence) };
    } catch (err: any) {
      return { status: 400, body: { error: err.message } };
    }
  },
  getWeb: async ({ params, req }) => {
    const sequence = await getSequenceBySequenceId(
      (req as any).teamId,
      params.sequenceId,
    );
    if (!sequence) return { status: 404, body: { error: "Sequence not found" } };
    return { status: 200, body: await toWebPublishing(sequence) };
  },
  updateWeb: async ({ params, body, req }) => {
    const sequence = await getSequenceBySequenceId(
      (req as any).teamId,
      params.sequenceId,
    );
    if (!sequence) return { status: 404, body: { error: "Sequence not found" } };
    try {
      return { status: 200, body: await updateWebPublishing(sequence, body) };
    } catch (error) {
      if (error instanceof WebPublishingError) {
        return { status: error.status, body: { error: error.message } };
      }
      throw error;
    }
  },
  stats: async ({ params, req }) => {
    const { sequenceId } = params;
    const sequence = await getSequenceBySequenceId((req as any).teamId, sequenceId);
    if (!sequence) return { status: 404, body: { error: "Sequence not found" } };
    const [sent, openRate, clickThroughRate, subscribersCount, rates] =
      await Promise.all([
        getEmailSentCount(sequenceId),
        getSequenceOpenRate(sequenceId),
        getSequenceClickThroughRate(sequenceId),
        getSubscribersCount(sequenceId),
        sequenceDeliveryRates(sequence.id),
      ]);
    return {
      status: 200,
      body: {
        sent,
        openRate,
        clickThroughRate,
        subscribersCount,
        bounceRate: rates.bounceRate,
        complaintRate: rates.complaintRate,
      },
    };
  },
  subscribers: async ({ params, query, req }) => {
    if (!(await getSequenceBySequenceId((req as any).teamId, params.sequenceId))) {
      return { status: 404, body: { error: "Sequence not found" } };
    }
    const subscribers = await getSubscribers({
      sequenceId: params.sequenceId,
      page: query.page,
      limit: query.limit,
    });
    return { status: 200, body: subscribers };
  },
});

createExpressEndpoints(contract.sequences, impl, router);

export default router;
