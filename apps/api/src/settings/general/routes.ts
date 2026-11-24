import { contract } from "@sendlit/api-contract";
import { createExpressEndpoints, initServer } from "@ts-rest/express";
import { Router } from "express";
import { requireAuth } from "../../auth/middleware";
import { requireTeam } from "../../auth/require-team";
import {
  type GeneralSettings,
  getGeneralSettings,
  POSTAL_ADDRESS_CONFLICT,
  POSTAL_COUNTRY_INVALID,
  upsertGeneralSettings,
} from "./queries";

const router = Router();
router.use("/settings/general", requireAuth, requireTeam);

const s = initServer();

function toPublicShape(settings: GeneralSettings) {
  return {
    mailingAddress: settings.mailingAddress,
    postalAddress: settings.postalAddress,
    updatedAt: settings.updatedAt?.toISOString() ?? null,
  };
}

const impl = s.router(contract.settings.general, {
  get: async ({ req }) => {
    const settings = await getGeneralSettings((req as any).teamId);
    return { status: 200, body: toPublicShape(settings) };
  },
  update: async ({ body, req }) => {
    try {
      const settings = await upsertGeneralSettings((req as any).teamId, body);
      return { status: 200, body: toPublicShape(settings) };
    } catch (err: any) {
      if (
        err.message === POSTAL_ADDRESS_CONFLICT ||
        err.message === POSTAL_COUNTRY_INVALID
      ) {
        return { status: 400, body: { error: err.message } };
      }
      throw err;
    }
  },
});

createExpressEndpoints(contract.settings.general, impl, router);

export default router;
