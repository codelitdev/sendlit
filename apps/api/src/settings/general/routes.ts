import { Router } from "express";
import { createExpressEndpoints, initServer } from "@ts-rest/express";
import { contract } from "@sendlit/api-contract";
import { requireAuth } from "../../auth/middleware";
import { requireTeam } from "../../auth/require-team";
import {
    getGeneralSettings,
    upsertGeneralSettings,
    type GeneralSettings,
} from "./queries";

const router = Router();
router.use(requireAuth);
router.use(requireTeam);

const s = initServer();

function toPublicShape(settings: GeneralSettings) {
    return {
        mailingAddress: settings.mailingAddress,
        updatedAt: settings.updatedAt?.toISOString() ?? null,
    };
}

const impl = s.router(contract.settings.general, {
    get: async ({ req }) => {
        const settings = await getGeneralSettings((req as any).teamId);
        return { status: 200, body: toPublicShape(settings) };
    },
    update: async ({ body, req }) => {
        const settings = await upsertGeneralSettings((req as any).teamId, body);
        return { status: 200, body: toPublicShape(settings) };
    },
});

createExpressEndpoints(contract.settings.general, impl, router);

export default router;
