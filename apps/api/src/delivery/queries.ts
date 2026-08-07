import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { db } from "../db/client";
import {
    espConfigs,
    espConfigTeamGrants,
    mailDispatchOutbox,
    outboundMessages,
    organizationDeliveryPolicies,
    organizations,
    teamDeliverySettings,
    teams,
    transactionalEmails,
} from "../db/schema";
import { releaseReservedQuotaForGrantInTransaction } from "./quota";
import { recordOrganizationAuditEvent } from "../organization/audit";

export type OrganizationDeliveryPolicy =
    typeof organizationDeliveryPolicies.$inferSelect;
export type EspGrant = typeof espConfigTeamGrants.$inferSelect;
export type TeamDeliverySetting = typeof teamDeliverySettings.$inferSelect;
export type DeliverySourceSelection =
    { type: "organization" } | { type: "team"; espId?: string };
export type ResolvedDeliverySource = {
    type: "organization" | "team";
    espConfigId: string;
    espGrantId: string | null;
    provider: string;
    secretVersion: number;
    fromName: string;
    fromEmail: string;
    replyTo: string | null;
};

/**
 * Resolves a public source selection into an immutable internal pin. This is
 * the only resolver used by activation/enqueue code; it has no first-row or
 * cross-source fallback.
 */
export async function resolveDeliverySource(
    teamId: string,
    requested?: DeliverySourceSelection,
): Promise<ResolvedDeliverySource> {
    const [context] = await db
        .select({
            team: teams,
            organizationStatus: organizations.status,
            setting: teamDeliverySettings,
        })
        .from(teams)
        .innerJoin(organizations, eq(organizations.id, teams.organizationId))
        .innerJoin(
            teamDeliverySettings,
            eq(teamDeliverySettings.teamId, teams.id),
        )
        .where(eq(teams.id, teamId))
        .limit(1);
    if (!context || context.team.status !== "active") {
        throw new Error("team_sending_suspended");
    }
    if (context.organizationStatus !== "active") {
        throw new Error("organization_sending_suspended");
    }

    let selection = requested;
    if (!selection && context.setting.defaultSource) {
        selection =
            context.setting.defaultSource === "organization"
                ? { type: "organization" }
                : { type: "team" };
    }
    if (!selection) {
        const grant = await getActiveEspGrantForTeam(teamId);
        const teamEsps = await db
            .select({ id: espConfigs.id })
            .from(espConfigs)
            .where(
                and(
                    eq(espConfigs.ownerScope, "team"),
                    eq(espConfigs.teamId, teamId),
                    eq(espConfigs.status, "active"),
                ),
            )
            .limit(2);
        const organizationUsable = grant?.status === "active";
        const teamUsable =
            context.setting.teamEspEnabled &&
            Boolean(
                context.setting.defaultTeamEspConfigId || teamEsps.length === 1,
            );
        if (!organizationUsable && !teamUsable) {
            throw new Error("delivery_source_unavailable");
        }
        if (organizationUsable && teamUsable) {
            throw new Error("delivery_source_required");
        }
        selection = organizationUsable
            ? { type: "organization" }
            : { type: "team" };
    }

    if (selection.type === "organization") {
        const [row] = await db
            .select({ grant: espConfigTeamGrants, esp: espConfigs })
            .from(espConfigTeamGrants)
            .innerJoin(
                espConfigs,
                eq(espConfigs.id, espConfigTeamGrants.espConfigId),
            )
            .where(
                and(
                    eq(espConfigTeamGrants.teamId, teamId),
                    eq(espConfigTeamGrants.status, "active"),
                    eq(espConfigs.ownerScope, "organization"),
                    eq(espConfigs.organizationId, context.team.organizationId),
                    eq(espConfigs.status, "active"),
                ),
            )
            .limit(1);
        if (!row?.esp.fromEmail) {
            throw new Error("organization_delivery_disabled");
        }
        return {
            type: "organization",
            espConfigId: row.esp.id,
            espGrantId: row.grant.id,
            provider: row.esp.provider,
            secretVersion: row.esp.secretVersion,
            fromName:
                row.grant.fromName ?? row.esp.fromName ?? context.team.name,
            fromEmail: row.esp.fromEmail,
            replyTo: row.grant.replyTo,
        };
    }

    if (!context.setting.teamEspEnabled) throw new Error("team_esp_disabled");
    const requestedEspId = selection.espId;
    let defaultId = context.setting.defaultTeamEspConfigId;
    if (!requestedEspId && !defaultId) {
        const active = await db
            .select({ id: espConfigs.id })
            .from(espConfigs)
            .where(
                and(
                    eq(espConfigs.ownerScope, "team"),
                    eq(espConfigs.teamId, teamId),
                    eq(espConfigs.status, "active"),
                ),
            )
            .limit(2);
        if (active.length === 0) {
            throw new Error("delivery_source_unavailable");
        }
        if (active.length !== 1) throw new Error("delivery_source_required");
        defaultId = active[0].id;
    }
    const [esp] = await db
        .select()
        .from(espConfigs)
        .where(
            and(
                eq(espConfigs.ownerScope, "team"),
                eq(espConfigs.teamId, teamId),
                eq(espConfigs.status, "active"),
                requestedEspId
                    ? eq(espConfigs.espId, requestedEspId)
                    : defaultId
                      ? eq(espConfigs.id, defaultId)
                      : sql`false`,
            ),
        )
        .limit(1);
    if (!esp?.fromEmail) throw new Error("esp_not_configured");
    return {
        type: "team",
        espConfigId: esp.id,
        espGrantId: null,
        provider: esp.provider,
        secretVersion: esp.secretVersion,
        fromName: esp.fromName ?? context.team.name,
        fromEmail: esp.fromEmail,
        replyTo: null,
    };
}

/** Revalidates a persisted pin for worker dispatch without consulting current
 * defaults. Draining grants remain usable until their deadline; suspended or
 * revoked pins fail closed. */
export async function resolvePinnedDeliverySource(input: {
    teamId: string;
    type: "organization" | "team";
    espConfigId: string;
    espGrantId: string | null;
}): Promise<ResolvedDeliverySource> {
    if (input.type === "team") {
        if (input.espGrantId) throw new Error("invalid_delivery_pin");
        const [row] = await db
            .select({ esp: espConfigs, team: teams })
            .from(espConfigs)
            .innerJoin(teams, eq(teams.id, espConfigs.teamId))
            .where(
                and(
                    eq(espConfigs.id, input.espConfigId),
                    eq(espConfigs.ownerScope, "team"),
                    eq(espConfigs.teamId, input.teamId),
                    eq(teams.status, "active"),
                ),
            )
            .limit(1);
        const dispatchableEsp =
            row?.esp.status === "active" ||
            (row?.esp.status === "draining" &&
                Boolean(
                    row.esp.drainUntil &&
                    row.esp.drainUntil.getTime() > Date.now(),
                ));
        if (!row?.esp.fromEmail || !dispatchableEsp)
            throw new Error("delivery_source_unavailable");
        return {
            type: "team",
            espConfigId: row.esp.id,
            espGrantId: null,
            provider: row.esp.provider,
            secretVersion: row.esp.secretVersion,
            fromName: row.esp.fromName ?? row.team.name,
            fromEmail: row.esp.fromEmail,
            replyTo: null,
        };
    }
    if (!input.espGrantId) throw new Error("invalid_delivery_pin");
    const [row] = await db
        .select({
            grant: espConfigTeamGrants,
            esp: espConfigs,
            team: teams,
            organizationStatus: organizations.status,
        })
        .from(espConfigTeamGrants)
        .innerJoin(
            espConfigs,
            eq(espConfigs.id, espConfigTeamGrants.espConfigId),
        )
        .innerJoin(teams, eq(teams.id, espConfigTeamGrants.teamId))
        .innerJoin(
            organizations,
            eq(organizations.id, espConfigTeamGrants.organizationId),
        )
        .where(
            and(
                eq(espConfigTeamGrants.id, input.espGrantId),
                eq(espConfigTeamGrants.teamId, input.teamId),
                eq(espConfigTeamGrants.espConfigId, input.espConfigId),
            ),
        )
        .limit(1);
    const dispatchableGrant =
        row?.grant.status === "active" ||
        (row?.grant.status === "draining" &&
            Boolean(
                row.grant.drainUntil &&
                row.grant.drainUntil.getTime() > Date.now(),
            ));
    const dispatchableEsp =
        row?.esp.status === "active" ||
        (row?.esp.status === "draining" &&
            Boolean(
                row.esp.drainUntil && row.esp.drainUntil.getTime() > Date.now(),
            ));
    if (
        !row ||
        !dispatchableGrant ||
        row.esp.ownerScope !== "organization" ||
        !dispatchableEsp ||
        row.team.status !== "active" ||
        row.organizationStatus !== "active" ||
        !row.esp.fromEmail
    ) {
        throw new Error("delivery_source_unavailable");
    }
    return {
        type: "organization",
        espConfigId: row.esp.id,
        espGrantId: row.grant.id,
        provider: row.esp.provider,
        secretVersion: row.esp.secretVersion,
        fromName: row.grant.fromName ?? row.esp.fromName ?? row.team.name,
        fromEmail: row.esp.fromEmail,
        replyTo: row.grant.replyTo,
    };
}

export async function getOrganizationDeliveryPolicy(
    organizationId: string,
): Promise<OrganizationDeliveryPolicy | null> {
    const [row] = await db
        .select()
        .from(organizationDeliveryPolicies)
        .where(eq(organizationDeliveryPolicies.organizationId, organizationId))
        .limit(1);
    return row ?? null;
}

export async function getOrganizationDeliveryPolicyView(
    organizationId: string,
) {
    const policy = await getOrganizationDeliveryPolicy(organizationId);
    if (!policy) return null;
    let defaultEspId: string | null = null;
    if (policy.defaultEspConfigId) {
        const [esp] = await db
            .select({ espId: espConfigs.espId })
            .from(espConfigs)
            .where(eq(espConfigs.id, policy.defaultEspConfigId))
            .limit(1);
        defaultEspId = esp?.espId ?? null;
    }
    return { policy, defaultEspId };
}

export async function updateOrganizationDeliveryPolicy(
    organizationId: string,
    input: {
        defaultEspId?: string | null;
        autoGrantDefaultEsp?: boolean;
        defaultDailyLimit?: number | null;
        defaultMonthlyLimit?: number | null;
        aggregateDailyLimit?: number | null;
        aggregateMonthlyLimit?: number | null;
        teamEspEnabledByDefault?: boolean;
        teamCanChangeDefault?: boolean;
    },
): Promise<Awaited<ReturnType<typeof getOrganizationDeliveryPolicyView>>> {
    const values: Partial<typeof organizationDeliveryPolicies.$inferInsert> = {
        updatedAt: new Date(),
    };
    if (input.defaultEspId !== undefined) {
        if (input.defaultEspId === null) {
            values.defaultEspConfigId = null;
        } else {
            const [esp] = await db
                .select({ id: espConfigs.id })
                .from(espConfigs)
                .where(
                    and(
                        eq(espConfigs.organizationId, organizationId),
                        eq(espConfigs.ownerScope, "organization"),
                        eq(espConfigs.espId, input.defaultEspId),
                        eq(espConfigs.status, "active"),
                    ),
                )
                .limit(1);
            if (!esp) throw new Error("organization_esp_unavailable");
            values.defaultEspConfigId = esp.id;
        }
    }
    for (const field of [
        "autoGrantDefaultEsp",
        "defaultDailyLimit",
        "defaultMonthlyLimit",
        "aggregateDailyLimit",
        "aggregateMonthlyLimit",
        "teamEspEnabledByDefault",
        "teamCanChangeDefault",
    ] as const) {
        if (input[field] !== undefined) values[field] = input[field] as never;
    }
    await db
        .update(organizationDeliveryPolicies)
        .set(values)
        .where(eq(organizationDeliveryPolicies.organizationId, organizationId));
    return getOrganizationDeliveryPolicyView(organizationId);
}

export async function getTeamDeliverySetting(
    teamId: string,
): Promise<TeamDeliverySetting | null> {
    const [row] = await db
        .select()
        .from(teamDeliverySettings)
        .where(eq(teamDeliverySettings.teamId, teamId))
        .limit(1);
    return row ?? null;
}

export async function getTeamDeliverySettingView(teamId: string) {
    const setting = await getTeamDeliverySetting(teamId);
    if (!setting) return null;
    let defaultTeamEspId: string | null = null;
    if (setting.defaultTeamEspConfigId) {
        const [esp] = await db
            .select({ espId: espConfigs.espId })
            .from(espConfigs)
            .where(eq(espConfigs.id, setting.defaultTeamEspConfigId))
            .limit(1);
        defaultTeamEspId = esp?.espId ?? null;
    }
    return { setting, defaultTeamEspId };
}

export async function getActiveEspGrantForTeam(
    teamId: string,
): Promise<EspGrant | null> {
    const [row] = await db
        .select()
        .from(espConfigTeamGrants)
        .where(
            and(
                eq(espConfigTeamGrants.teamId, teamId),
                ne(espConfigTeamGrants.status, "revoked"),
            ),
        )
        .limit(1);
    return row ?? null;
}

export async function getEspGrantView(organizationId: string, teamId: string) {
    const [row] = await db
        .select({
            grant: espConfigTeamGrants,
            teamPublicId: teams.teamId,
            espPublicId: espConfigs.espId,
        })
        .from(espConfigTeamGrants)
        .innerJoin(teams, eq(teams.id, espConfigTeamGrants.teamId))
        .innerJoin(
            espConfigs,
            eq(espConfigs.id, espConfigTeamGrants.espConfigId),
        )
        .where(
            and(
                eq(espConfigTeamGrants.organizationId, organizationId),
                eq(espConfigTeamGrants.teamId, teamId),
                ne(espConfigTeamGrants.status, "revoked"),
            ),
        )
        .limit(1);
    return row ?? null;
}

export async function upsertEspGrant(
    organizationId: string,
    teamId: string,
    input: {
        espId: string;
        fromName?: string | null;
        replyTo?: string | null;
        dailyLimit?: number | null;
        monthlyLimit?: number | null;
        makeDefault?: boolean;
    },
    actor: {
        type: "user" | "organization_key" | "system";
        id?: string;
    },
) {
    return db
        .transaction(async (tx) => {
            const [team] = await tx
                .select({ id: teams.id })
                .from(teams)
                .where(
                    and(
                        eq(teams.id, teamId),
                        eq(teams.organizationId, organizationId),
                    ),
                )
                .limit(1);
            if (!team) throw new Error("team_not_found");
            const [esp] = await tx
                .select({ id: espConfigs.id })
                .from(espConfigs)
                .where(
                    and(
                        eq(espConfigs.espId, input.espId),
                        eq(espConfigs.organizationId, organizationId),
                        eq(espConfigs.ownerScope, "organization"),
                        eq(espConfigs.status, "active"),
                    ),
                )
                .limit(1);
            if (!esp) throw new Error("organization_esp_unavailable");

            const [existing] = await tx
                .select()
                .from(espConfigTeamGrants)
                .where(
                    and(
                        eq(espConfigTeamGrants.teamId, teamId),
                        ne(espConfigTeamGrants.status, "revoked"),
                    ),
                )
                .limit(1)
                .for("update");
            if (existing && existing.espConfigId !== esp.id) {
                throw new Error("delivery_source_in_use");
            }
            if (existing) {
                await tx
                    .update(espConfigTeamGrants)
                    .set({
                        fromName: input.fromName,
                        replyTo: input.replyTo,
                        dailyLimit: input.dailyLimit,
                        monthlyLimit: input.monthlyLimit,
                        updatedAt: new Date(),
                    })
                    .where(eq(espConfigTeamGrants.id, existing.id));
            } else {
                await tx.insert(espConfigTeamGrants).values({
                    organizationId,
                    espConfigId: esp.id,
                    teamId,
                    fromName: input.fromName,
                    replyTo: input.replyTo,
                    dailyLimit: input.dailyLimit,
                    monthlyLimit: input.monthlyLimit,
                    createdByType: actor.type,
                    createdById: actor.id,
                });
            }
            if (input.makeDefault) {
                await tx
                    .update(teamDeliverySettings)
                    .set({
                        defaultSource: "organization",
                        defaultTeamEspConfigId: null,
                        updatedAt: new Date(),
                    })
                    .where(eq(teamDeliverySettings.teamId, teamId));
            }
        })
        .then(() => getEspGrantView(organizationId, teamId));
}

/** Stop only work that has not reached the provider. Accepted delivery is
 * historical fact and must neither be cancelled nor have its quota refunded. */
export async function cancelQueuedWorkForGrantInTransaction(
    tx: any,
    grantId: string,
    reason: string,
) {
    const queued = await tx
        .select({
            id: outboundMessages.id,
            transactionalEmailId: outboundMessages.transactionalEmailId,
        })
        .from(outboundMessages)
        .where(
            and(
                eq(outboundMessages.espGrantId, grantId),
                eq(outboundMessages.deliveryStatus, "queued"),
            ),
        )
        .for("update");
    if (!queued.length) return;
    const outboundIds = queued.map((row: { id: string }) => row.id);
    const transactionalIds = queued
        .map(
            (row: { transactionalEmailId: string | null }) =>
                row.transactionalEmailId,
        )
        .filter((id: string | null): id is string => Boolean(id));
    const now = new Date();
    await tx
        .update(outboundMessages)
        .set({ deliveryStatus: "cancelled", updatedAt: now })
        .where(inArray(outboundMessages.id, outboundIds));
    if (transactionalIds.length) {
        await tx
            .update(transactionalEmails)
            .set({ status: "cancelled", error: reason, updatedAt: now })
            .where(
                and(
                    inArray(transactionalEmails.id, transactionalIds),
                    eq(transactionalEmails.status, "queued"),
                ),
            );
    }
    await tx
        .update(mailDispatchOutbox)
        .set({ state: "cancelled", lastError: reason, updatedAt: now })
        .where(inArray(mailDispatchOutbox.outboundMessageId, outboundIds));
}

export async function transitionEspGrant(
    organizationId: string,
    teamId: string,
    action: "suspend" | "resume" | "drain" | "cancel",
    drainUntil?: Date,
    actor: {
        type: "user" | "organization_key" | "team_key" | "system";
        id?: string | null;
    } = { type: "system" },
) {
    await db.transaction(async (tx) => {
        const [grant] = await tx
            .select()
            .from(espConfigTeamGrants)
            .where(
                and(
                    eq(espConfigTeamGrants.organizationId, organizationId),
                    eq(espConfigTeamGrants.teamId, teamId),
                    ne(espConfigTeamGrants.status, "revoked"),
                ),
            )
            .limit(1)
            .for("update");
        if (!grant) throw new Error("grant_not_found");

        let status: "active" | "suspended" | "draining" | "revoked";
        if (action === "suspend" && grant.status === "active") {
            status = "suspended";
        } else if (action === "resume" && grant.status === "suspended") {
            status = "active";
        } else if (
            action === "drain" &&
            ["active", "suspended"].includes(grant.status)
        ) {
            status = "draining";
        } else if (action === "cancel") {
            status = "revoked";
        } else {
            throw new Error("invalid_lifecycle_transition");
        }
        await tx
            .update(espConfigTeamGrants)
            .set({
                status,
                drainUntil:
                    status === "draining"
                        ? (drainUntil ??
                          new Date(Date.now() + 24 * 60 * 60 * 1000))
                        : null,
                updatedAt: new Date(),
            })
            .where(eq(espConfigTeamGrants.id, grant.id));
        if (status === "draining" || status === "revoked") {
            await tx
                .update(teamDeliverySettings)
                .set({
                    defaultSource: null,
                    updatedAt: new Date(),
                })
                .where(
                    and(
                        eq(teamDeliverySettings.teamId, teamId),
                        eq(teamDeliverySettings.defaultSource, "organization"),
                    ),
                );
        }
        if (status === "revoked") {
            await cancelQueuedWorkForGrantInTransaction(
                tx,
                grant.id,
                "delivery_source_cancelled",
            );
            await releaseReservedQuotaForGrantInTransaction(
                tx,
                grant.id,
                "delivery_source_cancelled",
            );
        }
        await recordOrganizationAuditEvent(tx, {
            organizationId,
            actor,
            action: `delivery_grant.${action}`,
            teamId,
            espConfigId: grant.espConfigId,
            espGrantId: grant.id,
            metadata:
                status === "draining" && drainUntil
                    ? { drainUntil: drainUntil.toISOString() }
                    : {},
        });
    });
    if (action === "cancel") {
        const [row] = await db
            .select({
                grant: espConfigTeamGrants,
                teamPublicId: teams.teamId,
                espPublicId: espConfigs.espId,
            })
            .from(espConfigTeamGrants)
            .innerJoin(teams, eq(teams.id, espConfigTeamGrants.teamId))
            .innerJoin(
                espConfigs,
                eq(espConfigs.id, espConfigTeamGrants.espConfigId),
            )
            .where(
                and(
                    eq(espConfigTeamGrants.organizationId, organizationId),
                    eq(espConfigTeamGrants.teamId, teamId),
                ),
            )
            .orderBy(espConfigTeamGrants.updatedAt)
            .limit(1);
        return row ?? null;
    }
    return getEspGrantView(organizationId, teamId);
}

export async function updateTeamDeliverySource(
    teamId: string,
    source: { type: "organization" } | { type: "team"; espId: string },
): Promise<Awaited<ReturnType<typeof getTeamDeliverySettingView>>> {
    const setting = await getTeamDeliverySetting(teamId);
    if (!setting) throw new Error("delivery_settings_not_found");
    if (!setting.teamCanChangeDefault) {
        throw new Error("team_default_change_forbidden");
    }
    if (source.type === "organization") {
        const grant = await getActiveEspGrantForTeam(teamId);
        if (!grant || grant.status !== "active") {
            throw new Error("organization_delivery_disabled");
        }
        const [esp] = await db
            .select({ status: espConfigs.status })
            .from(espConfigs)
            .where(eq(espConfigs.id, grant.espConfigId))
            .limit(1);
        if (esp?.status !== "active") {
            throw new Error("organization_esp_unavailable");
        }
        await db
            .update(teamDeliverySettings)
            .set({
                defaultSource: "organization",
                defaultTeamEspConfigId: null,
                updatedAt: new Date(),
            })
            .where(eq(teamDeliverySettings.teamId, teamId));
    } else {
        if (!setting.teamEspEnabled) throw new Error("team_esp_disabled");
        const [esp] = await db
            .select({ id: espConfigs.id, status: espConfigs.status })
            .from(espConfigs)
            .where(
                and(
                    eq(espConfigs.teamId, teamId),
                    eq(espConfigs.ownerScope, "team"),
                    eq(espConfigs.espId, source.espId),
                ),
            )
            .limit(1);
        if (!esp) throw new Error("esp_not_found");
        if (esp.status !== "active") throw new Error("esp_not_active");
        await db
            .update(teamDeliverySettings)
            .set({
                defaultSource: "team",
                defaultTeamEspConfigId: esp.id,
                updatedAt: new Date(),
            })
            .where(eq(teamDeliverySettings.teamId, teamId));
    }
    return getTeamDeliverySettingView(teamId);
}

export async function listSendingOptions(teamId: string) {
    const setting = await getTeamDeliverySetting(teamId);
    if (!setting) return [];
    const options: Array<Record<string, unknown>> = [];
    const [organizationOption] = await db
        .select({
            grant: espConfigTeamGrants,
            esp: espConfigs,
        })
        .from(espConfigTeamGrants)
        .innerJoin(
            espConfigs,
            eq(espConfigs.id, espConfigTeamGrants.espConfigId),
        )
        .where(
            and(
                eq(espConfigTeamGrants.teamId, teamId),
                ne(espConfigTeamGrants.status, "revoked"),
            ),
        )
        .limit(1);
    if (organizationOption) {
        options.push({
            type: "organization",
            name: organizationOption.esp.name,
            fromName:
                organizationOption.grant.fromName ??
                organizationOption.esp.fromName,
            fromEmail: organizationOption.esp.fromEmail,
            replyTo: organizationOption.grant.replyTo,
            isDefault: setting.defaultSource === "organization",
            available:
                organizationOption.grant.status === "active" &&
                organizationOption.esp.status === "active",
            countsAgainstQuota: true,
        });
    }
    const teamEsps = await db
        .select()
        .from(espConfigs)
        .where(
            and(
                eq(espConfigs.ownerScope, "team"),
                eq(espConfigs.teamId, teamId),
            ),
        );
    for (const esp of teamEsps) {
        options.push({
            type: "team",
            espId: esp.espId,
            name: esp.name,
            fromName: esp.fromName,
            fromEmail: esp.fromEmail,
            isDefault:
                setting.defaultSource === "team" &&
                setting.defaultTeamEspConfigId === esp.id,
            available: setting.teamEspEnabled && esp.status === "active",
            countsAgainstQuota: false,
        });
    }
    return options;
}
