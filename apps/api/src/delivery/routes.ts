import { Router } from "express";
import { createExpressEndpoints, initServer } from "@ts-rest/express";
import { contract } from "@sendlit/api-contract";
import { requireAuth } from "../auth/middleware";
import { requireTeam } from "../auth/require-team";
import {
    getTeamDeliverySettingView,
    listSendingOptions,
    updateTeamDeliverySource,
} from "./queries";
import { getTeamMembership } from "../team/queries";

const router = Router();
router.use(
    ["/sending-options", "/settings/delivery"],
    requireAuth,
    requireTeam,
);
const s = initServer();

function serializeSettings(
    view: NonNullable<Awaited<ReturnType<typeof getTeamDeliverySettingView>>>,
) {
    return {
        teamEspEnabled: view.setting.teamEspEnabled,
        teamCanChangeDefault: view.setting.teamCanChangeDefault,
        defaultSource: view.setting.defaultSource as
            "organization" | "team" | null,
        defaultTeamEspId: view.defaultTeamEspId,
        updatedAt: view.setting.updatedAt.toISOString(),
    };
}

const impl = s.router(contract.delivery, {
    sendingOptions: async ({ req }) => {
        const items = await listSendingOptions((req as any).teamId);
        return { status: 200, body: { items: items as any } };
    },
    getSettings: async ({ req }) => {
        const view = await getTeamDeliverySettingView((req as any).teamId);
        if (!view) throw new Error("delivery_settings_not_found");
        return { status: 200, body: serializeSettings(view) };
    },
    updateSettings: async ({ req, body }) => {
        const authReq = req as any;
        if (authReq.authKind !== "team_key") {
            const membership = await getTeamMembership(
                authReq.teamId,
                authReq.userId,
            );
            if (!membership || membership.role !== "admin") {
                return {
                    status: 403,
                    body: { error: "team_admin_required" },
                };
            }
        }
        try {
            const view = await updateTeamDeliverySource(
                authReq.teamId,
                body.deliverySource,
            );
            if (!view) throw new Error("delivery_settings_not_found");
            return { status: 200, body: serializeSettings(view) };
        } catch (error: any) {
            if (
                [
                    "team_default_change_forbidden",
                    "team_esp_disabled",
                    "organization_delivery_disabled",
                ].includes(error.message)
            ) {
                return { status: 403, body: { error: error.message } };
            }
            if (
                ["esp_not_found", "organization_esp_unavailable"].includes(
                    error.message,
                )
            ) {
                return { status: 422, body: { error: error.message } };
            }
            return { status: 409, body: { error: error.message } };
        }
    },
});

createExpressEndpoints(contract.delivery, impl, router);

export default router;
