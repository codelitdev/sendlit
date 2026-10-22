import { contract } from "@sendlit/api-contract";
import { createExpressEndpoints, initServer } from "@ts-rest/express";
import { Router } from "express";
import { requireAuth } from "../../auth/middleware";
import { requireTeam } from "../../auth/require-team";
import {
  getTrackingDomain,
  setTrackingDomain,
  type TrackingDomain,
  verifyTrackingDomain,
} from "./queries";

const router = Router();
router.use("/settings/tracking-domain", requireAuth, requireTeam);

const s = initServer();

export function toPublicTrackingDomain(domain: TrackingDomain) {
  return {
    ...domain,
    verifiedAt: domain.verifiedAt?.toISOString() ?? null,
    checkedAt: domain.checkedAt?.toISOString() ?? null,
  };
}

const impl = s.router(contract.settings.trackingDomain, {
  get: async ({ req }) => ({
    status: 200,
    body: toPublicTrackingDomain(await getTrackingDomain((req as any).teamId)),
  }),
  update: async ({ body, req }) => {
    try {
      const domain = await setTrackingDomain((req as any).teamId, body.domain);
      return { status: 200, body: toPublicTrackingDomain(domain) };
    } catch (err: any) {
      if (err.message === "tracking_domain_taken") {
        return { status: 409, body: { error: err.message } };
      }
      if (err.message === "tracking_domain_invalid") {
        return { status: 400, body: { error: err.message } };
      }
      throw err;
    }
  },
  verify: async ({ req }) => {
    try {
      const domain = await verifyTrackingDomain((req as any).teamId);
      return { status: 200, body: toPublicTrackingDomain(domain) };
    } catch (err: any) {
      if (err.message === "tracking_domain_not_set") {
        return { status: 400, body: { error: err.message } };
      }
      throw err;
    }
  },
});

createExpressEndpoints(contract.settings.trackingDomain, impl, router);

export default router;
