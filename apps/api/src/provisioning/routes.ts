import { createHash } from "crypto";
import { Router } from "express";
import rateLimit from "express-rate-limit";
import { createExpressEndpoints, initServer } from "@ts-rest/express";
import { contract } from "@sendlit/api-contract";
import {
    archiveTeam,
    getProvisionedTeamView,
    getTeamForOrganization,
    setTeamSendingStatus,
    updateProvisionedTeam,
} from "../team/queries";
import { findOrCreateTeamByExternalId } from "../team/queries";
import { createApiKey } from "../apikey/queries";
import { db } from "../db/client";
import { teamApiKeys } from "../db/schema";
import { and, eq, isNull } from "drizzle-orm";
import { getTeamQuotaUsage } from "../delivery/quota";
import logger from "../services/log";
import { captureError, captureEvent } from "../observability/posthog";
import { requireAuth } from "../auth/middleware";
import { recordOrganizationAuditEvent } from "../organization/audit";

const router = Router();

const provisioningLimiter = rateLimit({
    windowMs: 60_000,
    max: 30,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => req.ip || "unknown",
    message: {
        error: "too_many_requests",
        error_description: "Too many requests.",
    },
});
// This router is mounted at the API root, so scope the limiter explicitly;
// an unqualified `router.use` would throttle every dashboard API request.
router.use("/provisioning", provisioningLimiter);
router.use("/provisioning", requireAuth);

const s = initServer();

function hasScope(req: any, scope: string): boolean {
    return (
        req.authKind === "organization_key" &&
        Array.isArray(req.organizationScopes) &&
        req.organizationScopes.includes(scope)
    );
}

async function resolveProvisionedTeam(req: any, publicTeamId: string) {
    if (req.authKind !== "organization_key") return null;
    return getTeamForOrganization(req.organizationId, publicTeamId);
}

function serializeProvisionedView(
    view: Awaited<ReturnType<typeof getProvisionedTeamView>>,
) {
    return {
        teamId: view.team.teamId,
        externalId: view.team.externalId!,
        name: view.team.name,
        deliverySource: { type: "organization" as const },
        status: view.team.status as "active" | "sending_suspended" | "archived",
        mailingAddress: view.general?.mailingAddress ?? null,
        teamEspEnabled: view.delivery?.teamEspEnabled ?? true,
        teamCanChangeDefault: view.delivery?.teamCanChangeDefault ?? true,
        createdAt: view.team.createdAt?.toISOString() ?? null,
        updatedAt: view.team.updatedAt?.toISOString() ?? null,
    };
}

async function auditProvisioningAction(
    req: any,
    team: { id: string },
    action: string,
    metadata: Record<string, unknown> = {},
) {
    await recordOrganizationAuditEvent(db, {
        organizationId: req.organizationId,
        actor: { type: "organization_key", id: req.organizationApiKeyId },
        action,
        teamId: team.id,
        metadata,
    });
}

/**
 * Server-to-server provisioning authenticated as one organization. The
 * organization is always derived from the key, never request input.
 */
const impl = s.router(contract.provisioning, {
    provisionTeam: async ({ body, req }) => {
        const authReq = req as any;
        if (authReq.authKind !== "organization_key") {
            return {
                status: 403,
                body: { error: "organization_key_required" },
            };
        }
        if (!hasScope(authReq, "teams:provision")) {
            return {
                status: 403,
                body: { error: "organization_scope_required" },
            };
        }

        try {
            const provisioningRequestHash = createHash("sha256")
                .update(JSON.stringify(body))
                .digest("hex");
            const team = await findOrCreateTeamByExternalId({
                organizationId: authReq.organizationId,
                externalId: body.externalId,
                name: body.name,
                provisioningRequestHash,
                sender: body.sender,
                mailingAddress: body.mailingAddress,
                delivery: body.delivery,
                quota: body.quota,
                createdBy: {
                    type: "organization_key",
                    id: authReq.organizationApiKeyId,
                },
            });
            // The API-key secret is only present on the call that created the
            // team, so it distinguishes a fresh provision from an idempotent
            // re-run.
            if (team.defaultApiKeySecret) {
                await auditProvisioningAction(
                    authReq,
                    team,
                    "team.provisioned",
                    {
                        externalId: team.externalId,
                    },
                );
                captureEvent({
                    event: "team_provisioned",
                    source: "provisioning.provision_team",
                    teamId: team.teamId,
                });
            }
            const base = {
                teamId: team.teamId,
                name: team.name,
                externalId: team.externalId!,
                deliverySource: { type: "organization" as const },
            };
            return team.defaultApiKeySecret
                ? {
                      status: 200,
                      body: {
                          ...base,
                          created: true as const,
                          apiKey: team.defaultApiKeySecret,
                      },
                  }
                : {
                      status: 200,
                      body: {
                          ...base,
                          created: false as const,
                          apiKey: null,
                      },
                  };
        } catch (err: any) {
            if (err.message === "provisioning_conflict") {
                return {
                    status: 409,
                    body: { error: "provisioning_conflict" },
                };
            }
            logger.error({ error: err.message }, "Team provisioning failed");
            captureError({
                error: err,
                source: "provisioning.provision_team",
                severity: "critical",
            });
            return { status: 500, body: { error: "server_error" } };
        }
    },
    getTeam: async ({ params, req }) => {
        const authReq = req as any;
        if (!hasScope(authReq, "teams:read"))
            return {
                status: 403,
                body: { error: "organization_scope_required" },
            };
        const team = await resolveProvisionedTeam(authReq, params.teamId);
        if (!team) return { status: 404, body: { error: "team_not_found" } };
        return {
            status: 200,
            body: serializeProvisionedView(await getProvisionedTeamView(team)),
        };
    },
    updateTeam: async ({ params, body, req }) => {
        const authReq = req as any;
        if (!hasScope(authReq, "teams:manage"))
            return {
                status: 403,
                body: { error: "organization_scope_required" },
            };
        const team = await resolveProvisionedTeam(authReq, params.teamId);
        if (!team) return { status: 404, body: { error: "team_not_found" } };
        try {
            const updated = await updateProvisionedTeam(team.id, body);
            if (!updated)
                return { status: 404, body: { error: "team_not_found" } };
            await auditProvisioningAction(authReq, updated, "team.updated");
            return {
                status: 200,
                body: serializeProvisionedView(
                    await getProvisionedTeamView(updated),
                ),
            };
        } catch (error: any) {
            return { status: 409, body: { error: error.message } };
        }
    },
    createTeamKey: async ({ params, body, req }) => {
        const authReq = req as any;
        if (!hasScope(authReq, "teams:keys"))
            return {
                status: 403,
                body: { error: "organization_scope_required" },
            };
        const team = await resolveProvisionedTeam(authReq, params.teamId);
        if (!team) return { status: 404, body: { error: "team_not_found" } };
        const result = await db.transaction(async (tx) => {
            await tx
                .update(teamApiKeys)
                .set({ revokedAt: new Date() })
                .where(
                    and(
                        eq(teamApiKeys.teamId, team.id),
                        eq(teamApiKeys.createdByType, "organization_key"),
                        isNull(teamApiKeys.revokedAt),
                    ),
                );
            return createApiKey(
                team.id,
                body.name,
                {
                    createdByType: "organization_key",
                    createdById: authReq.organizationApiKeyId,
                },
                tx,
            );
        });
        await auditProvisioningAction(authReq, team, "team.key_rotated", {
            keyId: result.apiKey.teamApiKeyId,
        });
        return {
            status: 201,
            body: {
                keyId: result.apiKey.teamApiKeyId,
                keyPrefix: result.apiKey.keyPrefix,
                name: result.apiKey.name,
                expiresAt: result.apiKey.expiresAt?.toISOString() ?? null,
                lastUsedAt: result.apiKey.lastUsedAt?.toISOString() ?? null,
                revokedAt: result.apiKey.revokedAt?.toISOString() ?? null,
                createdAt: result.apiKey.createdAt?.toISOString() ?? null,
                key: result.secret,
            },
        };
    },
    suspendTeam: async ({ params, req }) => {
        const authReq = req as any;
        if (!hasScope(authReq, "teams:manage"))
            return {
                status: 403,
                body: { error: "organization_scope_required" },
            };
        const team = await resolveProvisionedTeam(authReq, params.teamId);
        if (!team) return { status: 404, body: { error: "team_not_found" } };
        if (team.status !== "active")
            return {
                status: 409,
                body: { error: "invalid_lifecycle_transition" },
            };
        const updated = await setTeamSendingStatus(
            team.id,
            "sending_suspended",
        );
        await auditProvisioningAction(authReq, team, "team.suspended");
        return {
            status: 200,
            body: serializeProvisionedView(
                await getProvisionedTeamView(updated!),
            ),
        };
    },
    resumeTeam: async ({ params, req }) => {
        const authReq = req as any;
        if (!hasScope(authReq, "teams:manage"))
            return {
                status: 403,
                body: { error: "organization_scope_required" },
            };
        const team = await resolveProvisionedTeam(authReq, params.teamId);
        if (!team) return { status: 404, body: { error: "team_not_found" } };
        if (team.status !== "sending_suspended")
            return {
                status: 409,
                body: { error: "invalid_lifecycle_transition" },
            };
        const updated = await setTeamSendingStatus(team.id, "active");
        await auditProvisioningAction(authReq, team, "team.resumed");
        return {
            status: 200,
            body: serializeProvisionedView(
                await getProvisionedTeamView(updated!),
            ),
        };
    },
    archiveTeam: async ({ params, req }) => {
        const authReq = req as any;
        if (!hasScope(authReq, "teams:manage"))
            return {
                status: 403,
                body: { error: "organization_scope_required" },
            };
        const team = await resolveProvisionedTeam(authReq, params.teamId);
        if (!team) return { status: 404, body: { error: "team_not_found" } };
        await archiveTeam(team.id);
        await auditProvisioningAction(authReq, team, "team.archived");
        return { status: 204, body: undefined };
    },
    getTeamUsage: async ({ params, req }) => {
        const authReq = req as any;
        if (!hasScope(authReq, "usage:read"))
            return {
                status: 403,
                body: { error: "organization_scope_required" },
            };
        const team = await resolveProvisionedTeam(authReq, params.teamId);
        if (!team) return { status: 404, body: { error: "team_not_found" } };
        try {
            const usage = await getTeamQuotaUsage(team.id);
            return {
                status: 200,
                body: {
                    day: {
                        ...usage.day,
                        resetsAt: usage.day.resetsAt.toISOString(),
                    },
                    month: {
                        ...usage.month,
                        resetsAt: usage.month.resetsAt.toISOString(),
                    },
                },
            };
        } catch (error: any) {
            return { status: 404, body: { error: error.message } };
        }
    },
});

createExpressEndpoints(contract.provisioning, impl, router);

export default router;
