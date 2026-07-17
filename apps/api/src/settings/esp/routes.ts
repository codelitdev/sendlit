import { Router } from "express";
import { createExpressEndpoints, initServer } from "@ts-rest/express";
import { contract } from "@sendlit/api-contract";
import { requireAuth } from "../../auth/middleware";
import { requireTeam } from "../../auth/require-team";
import {
    createEspConfig,
    deleteEspConfig,
    getEspConfig,
    getEspConfigByEspId,
    listEspConfigs,
    updateEspConfig,
    upsertEspConfig,
    type EspConfig,
} from "./queries";
import {
    invalidateEspTransport,
    invalidateTeamTransport,
} from "../../mail/transport";
import { testEspConfig } from "./test";
import { captureEvent } from "../../observability/posthog";

const router = Router();
router.use(requireAuth);
router.use(requireTeam);

const s = initServer();

function toPublicShape(config: EspConfig) {
    return {
        espId: config.espId,
        name: config.name,
        isDefault: config.isDefault,
        provider: config.provider,
        host: config.host,
        port: config.port,
        secure: config.secure,
        username: config.username,
        hasPassword: Boolean(config.encryptedSecret),
        fromName: config.fromName,
        fromEmail: config.fromEmail,
        lastTestedAt: config.lastTestedAt?.toISOString() ?? null,
        lastTestStatus: config.lastTestStatus as "success" | "failed" | null,
        lastTestError: config.lastTestError,
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
            is_default: config.isDefault,
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
        const config = await updateEspConfig(teamId, params.espId, body);
        if (!config) return { status: 404, body: { error: "ESP not found" } };
        invalidateEspTransport(teamId, config.id);
        if (body.isDefault) invalidateTeamTransport(teamId);
        captureUpsert(config, "settings.esps.update");
        return { status: 200, body: toPublicShape(config) };
    },
    remove: async ({ params, req }) => {
        const teamId = (req as any).teamId;
        const config = await getEspConfigByEspId(teamId, params.espId);
        if (!config) return { status: 404, body: { error: "ESP not found" } };
        try {
            await deleteEspConfig(teamId, params.espId);
        } catch (err: any) {
            if (err.message === "esp_in_use") {
                return {
                    status: 409,
                    body: { error: "ESP is in use and cannot be removed" },
                };
            }
            throw err;
        }
        invalidateEspTransport(teamId, config.id);
        if (config.isDefault) invalidateTeamTransport(teamId);
        captureEvent({
            event: "esp_config_removed",
            source: "settings.esps.remove",
            teamId,
            properties: { esp_id: config.espId },
        });
        return { status: 204, body: undefined };
    },
    test: async ({ params, body, req }) => {
        const config = await getEspConfigByEspId(
            (req as any).teamId,
            params.espId,
        );
        if (!config) return { status: 404, body: { error: "ESP not found" } };
        return testConfig({
            config,
            to: body.to,
            account: (req as any).account,
        });
    },
});

/** Advisory compatibility adapter: singleton operations target the default. */
const legacyImpl = s.router(contract.settings.esp, {
    get: async ({ req }) => {
        const config = await getEspConfig((req as any).teamId);
        return {
            status: 200,
            body: config ? toPublicShape(config) : null,
        };
    },
    upsert: async ({ body, req }) => {
        const teamId = (req as any).teamId;
        const config = await upsertEspConfig(teamId, body);
        invalidateTeamTransport(teamId);
        captureUpsert(config, "settings.esp.upsert");
        return { status: 200, body: toPublicShape(config) };
    },
    remove: async ({ req }) => {
        const teamId = (req as any).teamId;
        try {
            await deleteEspConfig(teamId);
        } catch (err: any) {
            if (err.message === "esp_in_use") {
                return {
                    status: 409,
                    body: { error: "ESP is in use and cannot be removed" },
                };
            }
            throw err;
        }
        invalidateTeamTransport(teamId);
        captureEvent({
            event: "esp_config_removed",
            source: "settings.esp.remove",
            teamId,
        });
        return { status: 204, body: undefined };
    },
    test: async ({ body, req }) => {
        const config = await getEspConfig((req as any).teamId);
        if (!config) {
            return {
                status: 400,
                body: { error: "No ESP configured for this team yet." },
            };
        }
        return testConfig({
            config,
            to: body.to,
            account: (req as any).account,
        });
    },
});

createExpressEndpoints(contract.settings.esps, collectionImpl, router);
createExpressEndpoints(contract.settings.esp, legacyImpl, router);

export default router;
