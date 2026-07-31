import { Router } from "express";
import { createExpressEndpoints, initServer } from "@ts-rest/express";
import { contract } from "@sendlit/api-contract";
import { requireAuth } from "../auth/middleware";
import {
    addOrganizationMemberByEmail,
    closeOrganization,
    createOrganization,
    getOrganizationByPublicId,
    getOrganizationMembership,
    listOrganizationMembers,
    listOrganizationsForUser,
    removeOrganizationMember,
    updateOrganizationMemberRole,
    updateOrganizationName,
    type Organization,
    type OrganizationMember,
} from "./queries";
import {
    createOrganizationApiKey,
    getOrganizationApiKeys,
    revokeOrganizationApiKey,
} from "../apikey/queries";
import {
    createOrganizationEspConfig,
    deleteOrganizationEspConfig,
    getOrganizationEspConfigByEspId,
    listOrganizationEspConfigs,
    transitionEspConfig,
    updateOrganizationEspConfig,
    type EspConfig,
    type EspProvider,
} from "../settings/esp/queries";
import { testEspConfig } from "../settings/esp/test";
import {
    canActivateForOrganization,
    requiresFeedbackForOrganization,
} from "../settings/esp/provider-capabilities";
import {
    decryptFeedbackCredentials,
    disableOrganizationFeedbackConnection,
    getActiveFeedbackConnectionForEspConfig,
    getFeedbackConnectionForOrganizationEsp,
    recordFeedbackConnectionVerified,
    upsertOrganizationFeedbackConnection,
    type FeedbackConnection,
} from "../delivery-feedback/feedback-connection-queries";
import {
    getEspGrantView,
    getOrganizationDeliveryPolicyView,
    transitionEspGrant,
    updateOrganizationDeliveryPolicy,
    upsertEspGrant,
} from "../delivery/queries";
import { getOrganizationQuotaUsage } from "../delivery/quota";
import {
    archiveTeam,
    createTeam,
    getTeamByTeamId,
    listTeamsForOrganization,
    renameTeam,
} from "../team/queries";
import { feedbackCapableProviders } from "../config/constants";
import { getSiteUrl } from "../utils/mail";
import { listOrganizationAuditEvents } from "./audit";
import { recordOrganizationAuditEvent } from "./audit";
import { db } from "../db/client";

const router = Router();
router.use("/organizations", requireAuth);
const s = initServer();

function serializeOrganization(organization: Organization) {
    return {
        organizationId: organization.organizationId,
        name: organization.name,
        status: organization.status as "active" | "suspended" | "closed",
        createdAt: organization.createdAt.toISOString(),
        updatedAt: organization.updatedAt.toISOString(),
    };
}

function serializeMember(
    member: Awaited<ReturnType<typeof listOrganizationMembers>>[number],
) {
    return {
        ...member,
        role: member.role as "owner" | "admin" | "member",
        createdAt: member.createdAt.toISOString(),
        updatedAt: member.updatedAt.toISOString(),
    };
}

function isHuman(req: any): boolean {
    return req.authKind === "session" || req.authKind === "oauth";
}

/** Records the minimal Phase 1 security activity log without ever copying
 * secrets, credential data, or internal IDs into metadata. */
async function auditOrganizationMutation(
    req: any,
    organizationId: string,
    action: string,
    refs: {
        teamId?: string;
        espConfigId?: string;
        espGrantId?: string;
        metadata?: Record<string, unknown>;
    } = {},
): Promise<void> {
    await recordOrganizationAuditEvent(db, {
        organizationId,
        actor:
            req.authKind === "organization_key"
                ? { type: "organization_key", id: req.organizationApiKeyId }
                : { type: "user", id: req.userId },
        action,
        ...refs,
    });
}

async function resolveAuthorization(
    req: any,
    publicOrganizationId: string,
): Promise<{
    organization: Organization;
    membership: OrganizationMember | null;
    keyScopes: string[] | null;
} | null> {
    const organization = await getOrganizationByPublicId(publicOrganizationId);
    if (!organization) return null;
    if (req.authKind === "organization_key") {
        if (req.organizationId !== organization.id) return null;
        return {
            organization,
            membership: null,
            keyScopes: req.organizationScopes,
        };
    }
    if (!isHuman(req) || !req.userId) return null;
    const membership = await getOrganizationMembership(
        organization.id,
        req.userId,
    );
    if (!membership) return null;
    return { organization, membership, keyScopes: null };
}

function hasRole(
    authorization: NonNullable<
        Awaited<ReturnType<typeof resolveAuthorization>>
    >,
    roles: Array<"owner" | "admin" | "member">,
): boolean {
    return Boolean(
        authorization.membership &&
        roles.includes(
            authorization.membership.role as "owner" | "admin" | "member",
        ),
    );
}

function serializeOrganizationKey(
    key: Awaited<ReturnType<typeof getOrganizationApiKeys>>[number],
) {
    return {
        keyId: key.organizationApiKeyId,
        name: key.name,
        keyPrefix: key.keyPrefix,
        scopes: key.scopes as Array<
            | "organization:read"
            | "teams:provision"
            | "teams:read"
            | "teams:manage"
            | "teams:keys"
            | "esps:read"
            | "esps:manage"
            | "grants:manage"
            | "usage:read"
        >,
        expiresAt: key.expiresAt?.toISOString() ?? null,
        lastUsedAt: key.lastUsedAt?.toISOString() ?? null,
        revokedAt: key.revokedAt?.toISOString() ?? null,
        createdAt: key.createdAt.toISOString(),
    };
}

/** Organization-authorized view. Never reused for team/grant projections. */
function serializeOrganizationEsp(config: EspConfig) {
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
        updatedAt: config.updatedAt.toISOString(),
    };
}

function serializeOrganizationFeedback(
    espId: string,
    connection: FeedbackConnection,
) {
    return {
        connectionId: connection.connectionId,
        espId,
        provider: connection.provider,
        webhookUrl: `${getSiteUrl()}/webhooks/esp/${connection.provider}/${connection.connectionId}`,
        hasCredential: Boolean(connection.encryptedCredentials),
        status: connection.status as
            "pending" | "healthy" | "stale" | "error" | "retiring" | "disabled",
        lastReceivedAt: connection.lastReceivedAt?.toISOString() ?? null,
        lastVerifiedAt: connection.lastVerifiedAt?.toISOString() ?? null,
        lastErrorCode: connection.lastErrorCode,
        createdAt: connection.createdAt?.toISOString(),
        updatedAt: connection.updatedAt?.toISOString(),
    };
}

function mayReadOrganizationEsp(
    authorization: NonNullable<
        Awaited<ReturnType<typeof resolveAuthorization>>
    >,
): boolean {
    return (
        hasRole(authorization, ["owner", "admin"]) ||
        Boolean(authorization.keyScopes?.includes("esps:read")) ||
        Boolean(authorization.keyScopes?.includes("esps:manage"))
    );
}

function mayManageOrganizationEsp(
    authorization: NonNullable<
        Awaited<ReturnType<typeof resolveAuthorization>>
    >,
): boolean {
    return (
        hasRole(authorization, ["owner", "admin"]) ||
        Boolean(authorization.keyScopes?.includes("esps:manage"))
    );
}

function serializeDeliveryPolicy(
    view: NonNullable<
        Awaited<ReturnType<typeof getOrganizationDeliveryPolicyView>>
    >,
) {
    return {
        defaultEspId: view.defaultEspId,
        autoGrantDefaultEsp: view.policy.autoGrantDefaultEsp,
        defaultDailyLimit: view.policy.defaultDailyLimit,
        defaultMonthlyLimit: view.policy.defaultMonthlyLimit,
        aggregateDailyLimit: view.policy.aggregateDailyLimit,
        aggregateMonthlyLimit: view.policy.aggregateMonthlyLimit,
        teamEspEnabledByDefault: view.policy.teamEspEnabledByDefault,
        teamCanChangeDefault: view.policy.teamCanChangeDefault,
        updatedAt: view.policy.updatedAt.toISOString(),
    };
}

function serializeGrant(
    view: NonNullable<Awaited<ReturnType<typeof getEspGrantView>>>,
) {
    return {
        grantId: view.grant.grantId,
        teamId: view.teamPublicId,
        espId: view.espPublicId,
        status: view.grant.status as
            "active" | "draining" | "suspended" | "revoked",
        drainUntil: view.grant.drainUntil?.toISOString() ?? null,
        fromName: view.grant.fromName,
        replyTo: view.grant.replyTo,
        dailyLimit: view.grant.dailyLimit,
        monthlyLimit: view.grant.monthlyLimit,
        createdAt: view.grant.createdAt.toISOString(),
        updatedAt: view.grant.updatedAt.toISOString(),
    };
}

function serializeTeam(team: {
    teamId: string;
    name: string;
    status: string;
    externalId: string | null;
    createdAt: Date | null;
    updatedAt: Date | null;
}) {
    return {
        teamId: team.teamId,
        name: team.name,
        status: team.status as "active" | "sending_suspended" | "archived",
        externalId: team.externalId,
        createdAt: team.createdAt?.toISOString() ?? null,
        updatedAt: team.updatedAt?.toISOString() ?? null,
    };
}

function mayReadTeams(
    authorization: NonNullable<
        Awaited<ReturnType<typeof resolveAuthorization>>
    >,
) {
    return (
        Boolean(authorization.membership) ||
        Boolean(authorization.keyScopes?.includes("teams:read")) ||
        Boolean(authorization.keyScopes?.includes("teams:manage"))
    );
}

function mayManageTeams(
    authorization: NonNullable<
        Awaited<ReturnType<typeof resolveAuthorization>>
    >,
) {
    return (
        hasRole(authorization, ["owner", "admin"]) ||
        Boolean(authorization.keyScopes?.includes("teams:manage"))
    );
}

const impl = s.router(contract.organizations, {
    list: async ({ req }) => {
        if (!isHuman(req as any)) {
            return {
                status: 403 as const,
                body: { error: "user_auth_required" },
            };
        }
        const organizations = await listOrganizationsForUser(
            (req as any).userId,
        );
        return {
            status: 200,
            body: { items: organizations.map(serializeOrganization) },
        };
    },
    create: async ({ req, body }) => {
        if (!isHuman(req as any)) {
            return {
                status: 403 as const,
                body: { error: "user_auth_required" },
            };
        }
        const organization = await createOrganization(
            (req as any).userId,
            body.name,
        );
        return { status: 201, body: serializeOrganization(organization) };
    },
    get: async ({ req, params }) => {
        const authorization = await resolveAuthorization(
            req,
            params.organizationId,
        );
        if (!authorization) {
            return { status: 404, body: { error: "organization_not_found" } };
        }
        if (
            authorization.keyScopes &&
            !authorization.keyScopes.includes("organization:read")
        ) {
            return {
                status: 403,
                body: { error: "organization_scope_required" },
            };
        }
        return {
            status: 200,
            body: serializeOrganization(authorization.organization),
        };
    },
    update: async ({ req, params, body }) => {
        const authorization = await resolveAuthorization(
            req,
            params.organizationId,
        );
        if (!authorization) {
            return { status: 404, body: { error: "organization_not_found" } };
        }
        if (!hasRole(authorization, ["owner", "admin"])) {
            return {
                status: 403,
                body: { error: "organization_permission_required" },
            };
        }
        const updated = await updateOrganizationName(
            authorization.organization.id,
            body.name,
        );
        if (!updated) {
            return { status: 404, body: { error: "organization_not_found" } };
        }
        await auditOrganizationMutation(
            req,
            authorization.organization.id,
            "organization.renamed",
            { metadata: { name: updated.name } },
        );
        return { status: 200, body: serializeOrganization(updated) };
    },
    close: async ({ req, params }) => {
        const authorization = await resolveAuthorization(
            req,
            params.organizationId,
        );
        if (!authorization) {
            return { status: 404, body: { error: "organization_not_found" } };
        }
        if (!hasRole(authorization, ["owner"])) {
            return {
                status: 403,
                body: { error: "organization_owner_required" },
            };
        }
        await closeOrganization(authorization.organization.id, {
            type: "user",
            id: (req as any).userId,
        });
        return { status: 204, body: undefined };
    },
    listMembers: async ({ req, params }) => {
        const authorization = await resolveAuthorization(
            req,
            params.organizationId,
        );
        if (!authorization) {
            return { status: 404, body: { error: "organization_not_found" } };
        }
        if (!authorization.membership) {
            return {
                status: 403,
                body: { error: "organization_membership_required" },
            };
        }
        const members = await listOrganizationMembers(
            authorization.organization.id,
        );
        return {
            status: 200,
            body: { items: members.map(serializeMember) },
        };
    },
    addMember: async ({ req, params, body }) => {
        const authorization = await resolveAuthorization(
            req,
            params.organizationId,
        );
        if (!authorization) {
            return { status: 404, body: { error: "organization_not_found" } };
        }
        const callerRole = authorization.membership?.role;
        if (
            !callerRole ||
            !["owner", "admin"].includes(callerRole) ||
            (body.role === "owner" && callerRole !== "owner")
        ) {
            return {
                status: 403,
                body: { error: "organization_permission_required" },
            };
        }
        try {
            const member = await addOrganizationMemberByEmail(
                authorization.organization.id,
                body.email,
                body.role,
            );
            if (!member) {
                return { status: 404, body: { error: "user_not_found" } };
            }
            await auditOrganizationMutation(
                req,
                authorization.organization.id,
                "organization.member_added",
                { metadata: { userId: member.userId, role: member.role } },
            );
            return { status: 201, body: serializeMember(member) };
        } catch (error: any) {
            if (error?.code === "23505") {
                return { status: 409, body: { error: "member_exists" } };
            }
            throw error;
        }
    },
    updateMember: async ({ req, params, body }) => {
        const authorization = await resolveAuthorization(
            req,
            params.organizationId,
        );
        if (!authorization) {
            return { status: 404, body: { error: "organization_not_found" } };
        }
        const target = await getOrganizationMembership(
            authorization.organization.id,
            params.userId,
        );
        if (!target) {
            return { status: 404, body: { error: "member_not_found" } };
        }
        const callerRole = authorization.membership?.role;
        const ownerMutation = target.role === "owner" || body.role === "owner";
        if (
            !callerRole ||
            !["owner", "admin"].includes(callerRole) ||
            (ownerMutation && callerRole !== "owner")
        ) {
            return {
                status: 403,
                body: { error: "organization_permission_required" },
            };
        }
        try {
            const member = await updateOrganizationMemberRole(
                authorization.organization.id,
                params.userId,
                body.role,
            );
            await auditOrganizationMutation(
                req,
                authorization.organization.id,
                "organization.member_role_updated",
                { metadata: { userId: params.userId, role: body.role } },
            );
            return { status: 200, body: serializeMember(member!) };
        } catch (error: any) {
            if (error?.message === "last_organization_owner") {
                return {
                    status: 409,
                    body: { error: "last_organization_owner" },
                };
            }
            throw error;
        }
    },
    removeMember: async ({ req, params }) => {
        const authorization = await resolveAuthorization(
            req,
            params.organizationId,
        );
        if (!authorization) {
            return { status: 404, body: { error: "organization_not_found" } };
        }
        const target = await getOrganizationMembership(
            authorization.organization.id,
            params.userId,
        );
        if (!target) {
            return { status: 404, body: { error: "member_not_found" } };
        }
        const callerRole = authorization.membership?.role;
        if (
            !callerRole ||
            !["owner", "admin"].includes(callerRole) ||
            (target.role === "owner" && callerRole !== "owner")
        ) {
            return {
                status: 403,
                body: { error: "organization_permission_required" },
            };
        }
        try {
            await removeOrganizationMember(
                authorization.organization.id,
                params.userId,
            );
            await auditOrganizationMutation(
                req,
                authorization.organization.id,
                "organization.member_removed",
                { metadata: { userId: params.userId } },
            );
            return { status: 204, body: undefined };
        } catch (error: any) {
            if (error?.message === "last_organization_owner") {
                return {
                    status: 409,
                    body: { error: "last_organization_owner" },
                };
            }
            throw error;
        }
    },
    listTeams: async ({ req, params }) => {
        const authorization = await resolveAuthorization(
            req,
            params.organizationId,
        );
        if (!authorization)
            return { status: 404, body: { error: "organization_not_found" } };
        if (!mayReadTeams(authorization))
            return {
                status: 403,
                body: { error: "organization_permission_required" },
            };
        const teams = await listTeamsForOrganization(
            authorization.organization.id,
        );
        return { status: 200, body: { items: teams.map(serializeTeam) } };
    },
    createTeam: async ({ req, params, body }) => {
        const authorization = await resolveAuthorization(
            req,
            params.organizationId,
        );
        if (!authorization)
            return { status: 404, body: { error: "organization_not_found" } };
        if (!mayManageTeams(authorization))
            return {
                status: 403,
                body: { error: "organization_permission_required" },
            };
        try {
            const team = await createTeam({
                organizationId: authorization.organization.id,
                creatorUserId: authorization.membership?.userId,
                name: body.name,
                createdBy: authorization.membership
                    ? { type: "user", id: authorization.membership.userId }
                    : { type: "organization_key" },
            });
            await auditOrganizationMutation(
                req,
                authorization.organization.id,
                "team.created",
                { teamId: team.id, metadata: { name: team.name } },
            );
            return { status: 201, body: serializeTeam(team) };
        } catch (error: any) {
            return { status: 409, body: { error: error.message } };
        }
    },
    getTeam: async ({ req, params }) => {
        const authorization = await resolveAuthorization(
            req,
            params.organizationId,
        );
        if (!authorization)
            return { status: 404, body: { error: "organization_not_found" } };
        if (!mayReadTeams(authorization))
            return {
                status: 403,
                body: { error: "organization_permission_required" },
            };
        const team = await getTeamByTeamId(params.teamId);
        if (!team || team.organizationId !== authorization.organization.id)
            return { status: 404, body: { error: "team_not_found" } };
        return { status: 200, body: serializeTeam(team) };
    },
    updateTeam: async ({ req, params, body }) => {
        const authorization = await resolveAuthorization(
            req,
            params.organizationId,
        );
        if (!authorization)
            return { status: 404, body: { error: "organization_not_found" } };
        if (!mayManageTeams(authorization))
            return {
                status: 403,
                body: { error: "organization_permission_required" },
            };
        const team = await getTeamByTeamId(params.teamId);
        if (!team || team.organizationId !== authorization.organization.id)
            return { status: 404, body: { error: "team_not_found" } };
        const updated = await renameTeam(team.id, body.name);
        await auditOrganizationMutation(
            req,
            authorization.organization.id,
            "team.renamed",
            { teamId: team.id, metadata: { name: updated?.name ?? body.name } },
        );
        return { status: 200, body: serializeTeam(updated!) };
    },
    archiveTeam: async ({ req, params }) => {
        const authorization = await resolveAuthorization(
            req,
            params.organizationId,
        );
        if (!authorization)
            return { status: 404, body: { error: "organization_not_found" } };
        if (!mayManageTeams(authorization))
            return {
                status: 403,
                body: { error: "organization_permission_required" },
            };
        const team = await getTeamByTeamId(params.teamId);
        if (!team || team.organizationId !== authorization.organization.id)
            return { status: 404, body: { error: "team_not_found" } };
        await archiveTeam(team.id);
        await auditOrganizationMutation(
            req,
            authorization.organization.id,
            "team.archived",
            { teamId: team.id },
        );
        return { status: 204, body: undefined };
    },
    listKeys: async ({ req, params }) => {
        const authorization = await resolveAuthorization(
            req,
            params.organizationId,
        );
        if (!authorization) {
            return { status: 404, body: { error: "organization_not_found" } };
        }
        if (!hasRole(authorization, ["owner"])) {
            return {
                status: 403,
                body: { error: "organization_owner_required" },
            };
        }
        const keys = await getOrganizationApiKeys(
            authorization.organization.id,
        );
        return {
            status: 200,
            body: { items: keys.map(serializeOrganizationKey) },
        };
    },
    createKey: async ({ req, params, body }) => {
        const authorization = await resolveAuthorization(
            req,
            params.organizationId,
        );
        if (!authorization) {
            return { status: 404, body: { error: "organization_not_found" } };
        }
        if (!hasRole(authorization, ["owner"])) {
            return {
                status: 403,
                body: { error: "organization_owner_required" },
            };
        }
        const { apiKey, secret } = await createOrganizationApiKey(
            authorization.organization.id,
            body.name,
            body.scopes,
            (req as any).userId,
            body.expiresAt ? new Date(body.expiresAt) : null,
        );
        await auditOrganizationMutation(
            req,
            authorization.organization.id,
            "organization_key.created",
            {
                metadata: {
                    keyId: apiKey.organizationApiKeyId,
                    name: apiKey.name,
                    scopes: apiKey.scopes,
                },
            },
        );
        return {
            status: 201,
            body: { ...serializeOrganizationKey(apiKey), key: secret },
        };
    },
    revokeKey: async ({ req, params }) => {
        const authorization = await resolveAuthorization(
            req,
            params.organizationId,
        );
        if (!authorization) {
            return { status: 404, body: { error: "organization_not_found" } };
        }
        if (!hasRole(authorization, ["owner"])) {
            return {
                status: 403,
                body: { error: "organization_owner_required" },
            };
        }
        const revoked = await revokeOrganizationApiKey(
            authorization.organization.id,
            params.keyId,
        );
        if (!revoked) {
            return { status: 404, body: { error: "key_not_found" } };
        }
        await auditOrganizationMutation(
            req,
            authorization.organization.id,
            "organization_key.revoked",
            { metadata: { keyId: params.keyId } },
        );
        return { status: 204, body: undefined };
    },
    listEsps: async ({ req, params }) => {
        const authorization = await resolveAuthorization(
            req,
            params.organizationId,
        );
        if (!authorization) {
            return { status: 404, body: { error: "organization_not_found" } };
        }
        if (!mayReadOrganizationEsp(authorization)) {
            return {
                status: 403,
                body: { error: "organization_esp_permission_required" },
            };
        }
        const configs = await listOrganizationEspConfigs(
            authorization.organization.id,
        );
        return {
            status: 200,
            body: { items: configs.map(serializeOrganizationEsp) },
        };
    },
    createEsp: async ({ req, params, body }) => {
        const authorization = await resolveAuthorization(
            req,
            params.organizationId,
        );
        if (!authorization) {
            return { status: 404, body: { error: "organization_not_found" } };
        }
        if (!mayManageOrganizationEsp(authorization)) {
            return {
                status: 403,
                body: { error: "organization_esp_permission_required" },
            };
        }
        const config = await createOrganizationEspConfig(
            authorization.organization.id,
            body,
        );
        await auditOrganizationMutation(
            req,
            authorization.organization.id,
            "organization_esp.created",
            { espConfigId: config.id, metadata: { espId: config.espId } },
        );
        return { status: 201, body: serializeOrganizationEsp(config) };
    },
    getEsp: async ({ req, params }) => {
        const authorization = await resolveAuthorization(
            req,
            params.organizationId,
        );
        if (!authorization) {
            return { status: 404, body: { error: "organization_not_found" } };
        }
        if (!mayReadOrganizationEsp(authorization)) {
            return {
                status: 403,
                body: { error: "organization_esp_permission_required" },
            };
        }
        const config = await getOrganizationEspConfigByEspId(
            authorization.organization.id,
            params.espId,
        );
        if (!config) return { status: 404, body: { error: "esp_not_found" } };
        return { status: 200, body: serializeOrganizationEsp(config) };
    },
    updateEsp: async ({ req, params, body }) => {
        const authorization = await resolveAuthorization(
            req,
            params.organizationId,
        );
        if (!authorization) {
            return { status: 404, body: { error: "organization_not_found" } };
        }
        if (!mayManageOrganizationEsp(authorization)) {
            return {
                status: 403,
                body: { error: "organization_esp_permission_required" },
            };
        }
        try {
            const config = await updateOrganizationEspConfig(
                authorization.organization.id,
                params.espId,
                body,
            );
            if (!config)
                return { status: 404, body: { error: "esp_not_found" } };
            await auditOrganizationMutation(
                req,
                authorization.organization.id,
                "organization_esp.updated",
                { espConfigId: config.id, metadata: { espId: config.espId } },
            );
            return { status: 200, body: serializeOrganizationEsp(config) };
        } catch (error: any) {
            if (error.message === "invalid_lifecycle_transition") {
                return {
                    status: 409,
                    body: { error: "invalid_lifecycle_transition" },
                };
            }
            throw error;
        }
    },
    testEsp: async ({ req, params, body }) => {
        const authorization = await resolveAuthorization(
            req,
            params.organizationId,
        );
        if (!authorization) {
            return { status: 404, body: { error: "organization_not_found" } };
        }
        if (!mayManageOrganizationEsp(authorization)) {
            return {
                status: 403,
                body: { error: "organization_esp_permission_required" },
            };
        }
        const config = await getOrganizationEspConfigByEspId(
            authorization.organization.id,
            params.espId,
        );
        if (!config) return { status: 404, body: { error: "esp_not_found" } };
        const result = await testEspConfig({
            config,
            to: body.to,
            account: (req as any).user,
            source: "organizations.esps.test",
        });
        if (result.noDestination) {
            return { status: 400, body: { error: result.error! } };
        }
        if (result.mailingAddressRequired) {
            return { status: 422, body: { error: result.error! } };
        }
        if (!result.success) {
            return {
                status: 502,
                body: { success: false, error: result.error },
            };
        }
        await auditOrganizationMutation(
            req,
            authorization.organization.id,
            "organization_esp.test_succeeded",
            { espConfigId: config.id, metadata: { espId: config.espId } },
        );
        return { status: 200, body: { success: true } };
    },
    activateEsp: async ({ req, params }) => {
        const authorization = await resolveAuthorization(
            req,
            params.organizationId,
        );
        if (!authorization) {
            return { status: 404, body: { error: "organization_not_found" } };
        }
        if (!mayManageOrganizationEsp(authorization)) {
            return {
                status: 403,
                body: { error: "organization_esp_permission_required" },
            };
        }
        const config = await getOrganizationEspConfigByEspId(
            authorization.organization.id,
            params.espId,
        );
        if (!config) return { status: 404, body: { error: "esp_not_found" } };
        if (!canActivateForOrganization(config.provider as EspProvider)) {
            return {
                status: 422,
                body: { error: "provider_capability_required" },
            };
        }
        if (requiresFeedbackForOrganization(config.provider as EspProvider)) {
            const feedback = await getActiveFeedbackConnectionForEspConfig(
                config.id,
            );
            if (!feedback || feedback.status !== "healthy") {
                return {
                    status: 422,
                    body: { error: "feedback_verification_required" },
                };
            }
        }
        try {
            const updated = await transitionEspConfig(config, "activate");
            await auditOrganizationMutation(
                req,
                authorization.organization.id,
                "organization_esp.activated",
                { espConfigId: updated.id, metadata: { espId: updated.espId } },
            );
            return { status: 200, body: serializeOrganizationEsp(updated) };
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
    suspendEsp: async ({ req, params }) => {
        const authorization = await resolveAuthorization(
            req,
            params.organizationId,
        );
        if (!authorization) {
            return { status: 404, body: { error: "organization_not_found" } };
        }
        if (!mayManageOrganizationEsp(authorization)) {
            return {
                status: 403,
                body: { error: "organization_esp_permission_required" },
            };
        }
        const config = await getOrganizationEspConfigByEspId(
            authorization.organization.id,
            params.espId,
        );
        if (!config) return { status: 404, body: { error: "esp_not_found" } };
        try {
            const updated = await transitionEspConfig(config, "suspend");
            await auditOrganizationMutation(
                req,
                authorization.organization.id,
                "organization_esp.suspended",
                { espConfigId: updated.id, metadata: { espId: updated.espId } },
            );
            return { status: 200, body: serializeOrganizationEsp(updated) };
        } catch {
            return {
                status: 409,
                body: { error: "invalid_lifecycle_transition" },
            };
        }
    },
    resumeEsp: async ({ req, params }) => {
        const authorization = await resolveAuthorization(
            req,
            params.organizationId,
        );
        if (!authorization) {
            return { status: 404, body: { error: "organization_not_found" } };
        }
        if (!mayManageOrganizationEsp(authorization)) {
            return {
                status: 403,
                body: { error: "organization_esp_permission_required" },
            };
        }
        const config = await getOrganizationEspConfigByEspId(
            authorization.organization.id,
            params.espId,
        );
        if (!config) return { status: 404, body: { error: "esp_not_found" } };
        try {
            const updated = await transitionEspConfig(config, "resume");
            await auditOrganizationMutation(
                req,
                authorization.organization.id,
                "organization_esp.resumed",
                { espConfigId: updated.id, metadata: { espId: updated.espId } },
            );
            return { status: 200, body: serializeOrganizationEsp(updated) };
        } catch {
            return {
                status: 409,
                body: { error: "invalid_lifecycle_transition" },
            };
        }
    },
    retireEsp: async ({ req, params, body }) => {
        const authorization = await resolveAuthorization(
            req,
            params.organizationId,
        );
        if (!authorization) {
            return { status: 404, body: { error: "organization_not_found" } };
        }
        if (!hasRole(authorization, ["owner"])) {
            return {
                status: 403,
                body: { error: "organization_owner_required" },
            };
        }
        const config = await getOrganizationEspConfigByEspId(
            authorization.organization.id,
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
            await auditOrganizationMutation(
                req,
                authorization.organization.id,
                "organization_esp.retired",
                {
                    espConfigId: updated.id,
                    metadata: {
                        espId: updated.espId,
                        transition: body.transition,
                    },
                },
            );
            return { status: 200, body: serializeOrganizationEsp(updated) };
        } catch {
            return {
                status: 409,
                body: { error: "invalid_lifecycle_transition" },
            };
        }
    },
    deleteEsp: async ({ req, params }) => {
        const authorization = await resolveAuthorization(
            req,
            params.organizationId,
        );
        if (!authorization) {
            return { status: 404, body: { error: "organization_not_found" } };
        }
        if (!hasRole(authorization, ["owner"])) {
            return {
                status: 403,
                body: { error: "organization_owner_required" },
            };
        }
        const config = await getOrganizationEspConfigByEspId(
            authorization.organization.id,
            params.espId,
        );
        if (!config) return { status: 404, body: { error: "esp_not_found" } };
        try {
            await deleteOrganizationEspConfig(
                authorization.organization.id,
                params.espId,
            );
            await auditOrganizationMutation(
                req,
                authorization.organization.id,
                "organization_esp.deleted",
                { metadata: { espId: config.espId } },
            );
            return { status: 204, body: undefined };
        } catch (error: any) {
            if (error.message === "delivery_source_in_use") {
                return {
                    status: 409,
                    body: { error: "delivery_source_in_use" },
                };
            }
            throw error;
        }
    },
    getEspFeedback: async ({ req, params }) => {
        const authorization = await resolveAuthorization(
            req,
            params.organizationId,
        );
        if (!authorization)
            return { status: 404, body: { error: "organization_not_found" } };
        if (!mayReadOrganizationEsp(authorization))
            return {
                status: 403,
                body: { error: "organization_esp_permission_required" },
            };
        const esp = await getOrganizationEspConfigByEspId(
            authorization.organization.id,
            params.espId,
        );
        if (!esp) return { status: 404, body: { error: "esp_not_found" } };
        const connection = await getFeedbackConnectionForOrganizationEsp(
            authorization.organization.id,
            esp.id,
        );
        return {
            status: 200,
            body: connection
                ? serializeOrganizationFeedback(esp.espId, connection)
                : null,
        };
    },
    upsertEspFeedback: async ({ req, params, body }) => {
        const authorization = await resolveAuthorization(
            req,
            params.organizationId,
        );
        if (!authorization)
            return { status: 404, body: { error: "organization_not_found" } };
        if (!mayManageOrganizationEsp(authorization))
            return {
                status: 403,
                body: { error: "organization_esp_permission_required" },
            };
        const esp = await getOrganizationEspConfigByEspId(
            authorization.organization.id,
            params.espId,
        );
        if (!esp) return { status: 404, body: { error: "esp_not_found" } };
        if (
            !feedbackCapableProviders.includes(
                esp.provider as (typeof feedbackCapableProviders)[number],
            )
        )
            return {
                status: 400,
                body: { error: "feedback_not_supported" },
            };
        const connection = await upsertOrganizationFeedbackConnection({
            organizationId: authorization.organization.id,
            espConfigId: esp.id,
            provider: esp.provider as (typeof feedbackCapableProviders)[number],
            credential: body.credential,
            expectedTopicArn: body.expectedTopicArn,
        });
        return {
            status: 200,
            body: serializeOrganizationFeedback(esp.espId, connection),
        };
    },
    rotateEspFeedback: async ({ req, params, body }) => {
        const authorization = await resolveAuthorization(
            req,
            params.organizationId,
        );
        if (!authorization)
            return { status: 404, body: { error: "organization_not_found" } };
        if (!mayManageOrganizationEsp(authorization))
            return {
                status: 403,
                body: { error: "organization_esp_permission_required" },
            };
        const esp = await getOrganizationEspConfigByEspId(
            authorization.organization.id,
            params.espId,
        );
        if (!esp) return { status: 404, body: { error: "esp_not_found" } };
        const existing = await getFeedbackConnectionForOrganizationEsp(
            authorization.organization.id,
            esp.id,
        );
        if (!existing)
            return {
                status: 404,
                body: { error: "feedback_not_configured" },
            };
        const connection = await upsertOrganizationFeedbackConnection({
            organizationId: authorization.organization.id,
            espConfigId: esp.id,
            provider: esp.provider as (typeof feedbackCapableProviders)[number],
            credential: body.credential,
            expectedTopicArn: body.expectedTopicArn,
        });
        return {
            status: 200,
            body: serializeOrganizationFeedback(esp.espId, connection),
        };
    },
    testEspFeedback: async ({ req, params }) => {
        const authorization = await resolveAuthorization(
            req,
            params.organizationId,
        );
        if (!authorization)
            return { status: 404, body: { error: "organization_not_found" } };
        if (!mayManageOrganizationEsp(authorization))
            return {
                status: 403,
                body: { error: "organization_esp_permission_required" },
            };
        const esp = await getOrganizationEspConfigByEspId(
            authorization.organization.id,
            params.espId,
        );
        if (!esp) return { status: 404, body: { error: "esp_not_found" } };
        const connection = await getFeedbackConnectionForOrganizationEsp(
            authorization.organization.id,
            esp.id,
        );
        if (!connection)
            return {
                status: 404,
                body: { error: "feedback_not_configured" },
            };
        if (!decryptFeedbackCredentials(connection))
            return {
                status: 200,
                body: {
                    success: false,
                    error: "feedback_invalid_credentials",
                },
            };
        await recordFeedbackConnectionVerified(connection.id);
        return { status: 200, body: { success: true } };
    },
    removeEspFeedback: async ({ req, params }) => {
        const authorization = await resolveAuthorization(
            req,
            params.organizationId,
        );
        if (!authorization)
            return { status: 404, body: { error: "organization_not_found" } };
        if (!mayManageOrganizationEsp(authorization))
            return {
                status: 403,
                body: { error: "organization_esp_permission_required" },
            };
        const esp = await getOrganizationEspConfigByEspId(
            authorization.organization.id,
            params.espId,
        );
        if (!esp) return { status: 404, body: { error: "esp_not_found" } };
        const disabled = await disableOrganizationFeedbackConnection(
            authorization.organization.id,
            esp.id,
        );
        if (!disabled)
            return {
                status: 404,
                body: { error: "feedback_not_configured" },
            };
        return { status: 204, body: undefined };
    },
    getDeliveryPolicy: async ({ req, params }) => {
        const authorization = await resolveAuthorization(
            req,
            params.organizationId,
        );
        if (!authorization) {
            return { status: 404, body: { error: "organization_not_found" } };
        }
        if (!hasRole(authorization, ["owner", "admin"])) {
            return {
                status: 403,
                body: { error: "organization_permission_required" },
            };
        }
        const view = await getOrganizationDeliveryPolicyView(
            authorization.organization.id,
        );
        if (!view) {
            return {
                status: 404,
                body: { error: "delivery_policy_not_found" },
            };
        }
        return { status: 200, body: serializeDeliveryPolicy(view) };
    },
    updateDeliveryPolicy: async ({ req, params, body }) => {
        const authorization = await resolveAuthorization(
            req,
            params.organizationId,
        );
        if (!authorization) {
            return { status: 404, body: { error: "organization_not_found" } };
        }
        if (!hasRole(authorization, ["owner", "admin"])) {
            return {
                status: 403,
                body: { error: "organization_permission_required" },
            };
        }
        try {
            const view = await updateOrganizationDeliveryPolicy(
                authorization.organization.id,
                body,
            );
            if (!view) {
                return {
                    status: 404,
                    body: { error: "delivery_policy_not_found" },
                };
            }
            await auditOrganizationMutation(
                req,
                authorization.organization.id,
                "organization_delivery_policy.updated",
            );
            return { status: 200, body: serializeDeliveryPolicy(view) };
        } catch (error: any) {
            if (error.message === "organization_esp_unavailable") {
                return {
                    status: 422,
                    body: { error: "organization_esp_unavailable" },
                };
            }
            throw error;
        }
    },
    getUsage: async ({
        req,
        params,
    }: {
        req: any;
        params: { organizationId: string };
    }) => {
        const authorization = await resolveAuthorization(
            req,
            params.organizationId,
        );
        if (!authorization) {
            return { status: 404, body: { error: "organization_not_found" } };
        }
        const mayRead =
            hasRole(authorization, ["owner", "admin"]) ||
            Boolean(authorization.keyScopes?.includes("usage:read"));
        if (!mayRead) {
            return {
                status: 403,
                body: { error: "organization_permission_required" },
            };
        }
        const usage = await getOrganizationQuotaUsage(
            authorization.organization.id,
        );
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
    },
    listAuditEvents: async ({
        req,
        params,
    }: {
        req: any;
        params: { organizationId: string };
    }) => {
        const authorization = await resolveAuthorization(
            req,
            params.organizationId,
        );
        if (!authorization) {
            return { status: 404, body: { error: "organization_not_found" } };
        }
        const mayRead =
            hasRole(authorization, ["owner", "admin"]) ||
            Boolean(authorization.keyScopes?.includes("organization:read"));
        if (!mayRead) {
            return {
                status: 403,
                body: { error: "organization_permission_required" },
            };
        }
        const events = await listOrganizationAuditEvents(
            authorization.organization.id,
        );
        return {
            status: 200,
            body: {
                items: events.map((event) => ({
                    ...event,
                    createdAt: event.createdAt.toISOString(),
                })),
            },
        };
    },
    getEspGrant: async ({ req, params }) => {
        const authorization = await resolveAuthorization(
            req,
            params.organizationId,
        );
        if (!authorization) {
            return { status: 404, body: { error: "organization_not_found" } };
        }
        const mayRead =
            hasRole(authorization, ["owner", "admin"]) ||
            authorization.keyScopes?.includes("grants:manage");
        if (!mayRead) {
            return {
                status: 403,
                body: { error: "organization_permission_required" },
            };
        }
        const team = await getTeamByTeamId(params.teamId);
        if (!team || team.organizationId !== authorization.organization.id) {
            return { status: 404, body: { error: "team_not_found" } };
        }
        const view = await getEspGrantView(
            authorization.organization.id,
            team.id,
        );
        return {
            status: 200,
            body: view ? serializeGrant(view) : null,
        };
    },
    upsertEspGrant: async ({ req, params, body }) => {
        const authorization = await resolveAuthorization(
            req,
            params.organizationId,
        );
        if (!authorization) {
            return { status: 404, body: { error: "organization_not_found" } };
        }
        const mayManage =
            hasRole(authorization, ["owner", "admin"]) ||
            authorization.keyScopes?.includes("grants:manage");
        if (!mayManage) {
            return {
                status: 403,
                body: { error: "organization_permission_required" },
            };
        }
        const team = await getTeamByTeamId(params.teamId);
        if (!team || team.organizationId !== authorization.organization.id) {
            return { status: 404, body: { error: "team_not_found" } };
        }
        try {
            const view = await upsertEspGrant(
                authorization.organization.id,
                team.id,
                body,
                {
                    type:
                        (req as any).authKind === "organization_key"
                            ? "organization_key"
                            : "user",
                    id:
                        (req as any).organizationApiKeyId ??
                        (req as any).userId,
                },
            );
            return { status: 200, body: serializeGrant(view!) };
        } catch (error: any) {
            if (error.message === "organization_esp_unavailable") {
                return {
                    status: 422,
                    body: { error: "organization_esp_unavailable" },
                };
            }
            if (error.message === "delivery_source_in_use") {
                return {
                    status: 409,
                    body: { error: "delivery_source_in_use" },
                };
            }
            throw error;
        }
    },
    transitionEspGrant: async ({ req, params, body }) => {
        const authorization = await resolveAuthorization(
            req,
            params.organizationId,
        );
        if (!authorization) {
            return { status: 404, body: { error: "organization_not_found" } };
        }
        const mayManage =
            hasRole(authorization, ["owner", "admin"]) ||
            authorization.keyScopes?.includes("grants:manage");
        if (!mayManage) {
            return {
                status: 403,
                body: { error: "organization_permission_required" },
            };
        }
        const team = await getTeamByTeamId(params.teamId);
        if (!team || team.organizationId !== authorization.organization.id) {
            return { status: 404, body: { error: "team_not_found" } };
        }
        let drainUntil: Date | undefined;
        if (body.action === "drain" && body.drainUntil) {
            drainUntil = new Date(body.drainUntil);
            const duration = drainUntil.getTime() - Date.now();
            if (
                duration < 5 * 60 * 1000 ||
                duration > 7 * 24 * 60 * 60 * 1000
            ) {
                return {
                    status: 409,
                    body: { error: "invalid_lifecycle_transition" },
                };
            }
        }
        try {
            const view = await transitionEspGrant(
                authorization.organization.id,
                team.id,
                body.action,
                drainUntil,
                authorization.membership
                    ? { type: "user", id: (req as any).userId }
                    : {
                          type: "organization_key",
                          id: (req as any).organizationApiKeyId,
                      },
            );
            if (!view) {
                return { status: 404, body: { error: "grant_not_found" } };
            }
            return { status: 200, body: serializeGrant(view) };
        } catch (error: any) {
            if (error.message === "grant_not_found") {
                return { status: 404, body: { error: "grant_not_found" } };
            }
            return {
                status: 409,
                body: { error: "invalid_lifecycle_transition" },
            };
        }
    },
});

createExpressEndpoints(contract.organizations, impl, router);

export default router;
