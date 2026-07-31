import { Router } from "express";
import { createExpressEndpoints, initServer } from "@ts-rest/express";
import { contract } from "@sendlit/api-contract";
import { requireAuth } from "../../auth/middleware";
import { requireTeam } from "../../auth/require-team";
import {
    createEspConfig,
    deleteEspConfig,
    getEspConfigByEspId,
    listEspConfigs,
    updateEspConfig,
    transitionEspConfig,
    type EspConfig,
} from "./queries";
import {
    invalidateEspTransport,
    invalidateTeamTransport,
} from "../../mail/transport";
import { testEspConfig } from "./test";
import { captureEvent } from "../../observability/posthog";
import { getTeamDeliverySetting } from "../../delivery/queries";
import { getTeamMembership } from "../../team/queries";

const router = Router();
router.use(["/settings/esp", "/settings/esps"], requireAuth, requireTeam);

const s = initServer();

async function canManageTeamEsp(req: any): Promise<boolean> {
    const delivery = await getTeamDeliverySetting(req.teamId);
    if (!delivery?.teamEspEnabled) return false;
    if (req.authKind === "team_key") return true;
    const membership = await getTeamMembership(req.teamId, req.userId);
    return membership?.role === "admin";
}

function toPublicShape(config: EspConfig) {
    return {
        espId: config.espId,
        name: config.name,
        provider: config.provider,
        host: config.host,
        port: config.port,
        secure: config.secure,
        username: config.username,
        hasPassword: Boolean(config.encryptedSecret),
        fromName: config.fromName,
        fromEmail: config.fromEmail,
        status: config.status as
            "draft" | "active" | "suspended" | "draining" | "retired",
        secretVersion: config.secretVersion,
        lastTestedAt: config.lastTestedAt?.toISOString() ?? null,
        lastTestStatus: config.lastTestStatus as "success" | "failed" | null,
        lastTestError: config.lastTestError,
        activatedAt: config.activatedAt?.toISOString() ?? null,
        drainUntil: config.drainUntil?.toISOString() ?? null,
        retiredAt: config.retiredAt?.toISOString() ?? null,
        updatedAt: config.updatedAt?.toISOString(),
    };
}

function captureUpsert(config: EspConfig, source: string): void {
    captureEvent({
        event: "esp_config_upserted",
        source,
        teamId: config.teamId,
        properties: {
            esp_id: config.espId,
            provider: config.provider,
            status: config.status,
            has_password: Boolean(config.encryptedSecret),
            has_from_email: Boolean(config.fromEmail),
            has_username: Boolean(config.username),
            secure: config.secure,
            port: config.port,
        },
    });
}

async function testConfig({
    config,
    to,
    account,
}: {
    config: EspConfig;
    to?: string;
    account: { name?: string; email?: string } | null;
}) {
    const result = await testEspConfig({
        config,
        to,
        account,
        source: "settings.esps.test",
    });
    if (result.noDestination) {
        return { status: 400 as const, body: { error: result.error! } };
    }
    if (result.mailingAddressRequired) {
        return { status: 422 as const, body: { error: result.error! } };
    }
    if (!result.success) {
        return {
            status: 502 as const,
            body: { success: false, error: result.error },
        };
    }
    return { status: 200 as const, body: { success: true } };
}

const collectionImpl = s.router(contract.settings.esps, {
    list: async ({ req }) => {
        const configs = await listEspConfigs((req as any).teamId);
        return {
            status: 200,
            body: { items: configs.map(toPublicShape) },
        };
    },
    create: async ({ body, req }) => {
        const teamId = (req as any).teamId;
        if (!(await canManageTeamEsp(req))) {
            return { status: 403, body: { error: "team_esp_disabled" } };
        }
        const config = await createEspConfig(teamId, body);
        invalidateTeamTransport(teamId);
        captureUpsert(config, "settings.esps.create");
        return { status: 201, body: toPublicShape(config) };
    },
    get: async ({ params, req }) => {
        const config = await getEspConfigByEspId(
            (req as any).teamId,
            params.espId,
        );
        if (!config) return { status: 404, body: { error: "ESP not found" } };
        return { status: 200, body: toPublicShape(config) };
    },
    update: async ({ params, body, req }) => {
        const teamId = (req as any).teamId;
        if (!(await canManageTeamEsp(req))) {
            return { status: 403, body: { error: "team_esp_disabled" } };
        }
        const config = await updateEspConfig(teamId, params.espId, body);
        if (!config) return { status: 404, body: { error: "ESP not found" } };
        invalidateEspTransport(teamId, config.id);
        captureUpsert(config, "settings.esps.update");
        return { status: 200, body: toPublicShape(config) };
    },
    remove: async ({ params, req }) => {
        const teamId = (req as any).teamId;
        if (!(await canManageTeamEsp(req))) {
            return { status: 403, body: { error: "team_esp_disabled" } };
        }
        const config = await getEspConfigByEspId(teamId, params.espId);
        if (!config) return { status: 404, body: { error: "ESP not found" } };
        try {
            await deleteEspConfig(teamId, params.espId);
        } catch (err: any) {
            if (err.message === "delivery_source_in_use") {
                return {
                    status: 409,
                    body: { error: "delivery_source_in_use" },
                };
            }
            throw err;
        }
        invalidateEspTransport(teamId, config.id);
        captureEvent({
            event: "esp_config_removed",
            source: "settings.esps.remove",
            teamId,
            properties: { esp_id: config.espId },
        });
        return { status: 204, body: undefined };
    },
    test: async ({ params, body, req }) => {
        if (!(await canManageTeamEsp(req))) {
            return { status: 403, body: { error: "team_esp_disabled" } };
        }
        const config = await getEspConfigByEspId(
            (req as any).teamId,
            params.espId,
        );
        if (!config) return { status: 404, body: { error: "ESP not found" } };
        return testConfig({
            config,
            to: body.to,
            account: (req as any).user,
        });
    },
    activate: async ({ params, req }) => {
        if (!(await canManageTeamEsp(req))) {
            return { status: 403, body: { error: "team_esp_disabled" } };
        }
        const config = await getEspConfigByEspId(
            (req as any).teamId,
            params.espId,
        );
        if (!config) {
            return { status: 404, body: { error: "esp_not_found" } };
        }
        try {
            const updated = await transitionEspConfig(config, "activate");
            return { status: 200, body: toPublicShape(updated) };
        } catch (error: any) {
            if (error.message === "esp_verification_required") {
                return {
                    status: 422,
                    body: { error: "esp_verification_required" },
                };
            }
            return {
                status: 409,
                body: { error: "invalid_lifecycle_transition" },
            };
        }
    },
    suspend: async ({ params, req }) => {
        if (!(await canManageTeamEsp(req))) {
            return { status: 403, body: { error: "team_esp_disabled" } };
        }
        const config = await getEspConfigByEspId(
            (req as any).teamId,
            params.espId,
        );
        if (!config) return { status: 404, body: { error: "esp_not_found" } };
        try {
            const updated = await transitionEspConfig(config, "suspend");
            return { status: 200, body: toPublicShape(updated) };
        } catch {
            return {
                status: 409,
                body: { error: "invalid_lifecycle_transition" },
            };
        }
    },
    resume: async ({ params, req }) => {
        if (!(await canManageTeamEsp(req))) {
            return { status: 403, body: { error: "team_esp_disabled" } };
        }
        const config = await getEspConfigByEspId(
            (req as any).teamId,
            params.espId,
        );
        if (!config) return { status: 404, body: { error: "esp_not_found" } };
        try {
            const updated = await transitionEspConfig(config, "resume");
            return { status: 200, body: toPublicShape(updated) };
        } catch {
            return {
                status: 409,
                body: { error: "invalid_lifecycle_transition" },
            };
        }
    },
    retire: async ({ params, body, req }) => {
        if (!(await canManageTeamEsp(req))) {
            return { status: 403, body: { error: "team_esp_disabled" } };
        }
        const config = await getEspConfigByEspId(
            (req as any).teamId,
            params.espId,
        );
        if (!config) return { status: 404, body: { error: "esp_not_found" } };
        try {
            const updated = await transitionEspConfig(config, "retire", {
                cancel: body.transition === "cancel",
                drainUntil:
                    body.transition === "drain" && body.drainUntil
                        ? new Date(body.drainUntil)
                        : undefined,
            });
            return { status: 200, body: toPublicShape(updated) };
        } catch {
            return {
                status: 409,
                body: { error: "invalid_lifecycle_transition" },
            };
        }
    },
});

createExpressEndpoints(contract.settings.esps, collectionImpl, router);

export default router;
