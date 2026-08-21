import { and, eq, inArray, ne } from "drizzle-orm";
import { db } from "../db/client";
import {
    oauthPostLoginTeamSelections,
    espConfigTeamGrants,
    espConfigs,
    organizationDeliveryPolicies,
    organizations,
    settings,
    teamDeliverySettings,
    teamMembers,
    teams,
} from "../db/schema";
import { transitionEspGrant } from "../delivery/queries";
import { createApiKey } from "../apikey/queries";

export type Team = typeof teams.$inferSelect;
export type TeamMember = typeof teamMembers.$inferSelect;
export type TeamWithOrganization = Team & {
    organizationPublicId: string;
    organizationName: string;
};

/** `defaultApiKeySecret` is the one-time plaintext of the team's default API
 * key — keys are stored hashed, so this is the only moment it exists. Present
 * only when the team was actually created (not on find-or-create hits). */
export type CreatedTeam = Team & { defaultApiKeySecret?: string };

export async function getTeam(id: string): Promise<Team | null> {
    const [row] = await db
        .select()
        .from(teams)
        .where(eq(teams.id, id))
        .limit(1);
    return row ?? null;
}

/** Public-id lookup — used at the outermost edges (auth header, route
 * params, provisioning) that speak the public `teamId`, never the internal
 * `id`. See `apps/api/AGENTS.md`/`SCHEMA_ID_REFACTOR_PLAN.md` Task B. */
export async function getTeamByTeamId(teamId: string): Promise<Team | null> {
    const [row] = await db
        .select()
        .from(teams)
        .where(eq(teams.teamId, teamId))
        .limit(1);
    return row ?? null;
}

export async function getTeamByExternalId(
    organizationId: string,
    externalId: string,
): Promise<Team | null> {
    const [row] = await db
        .select()
        .from(teams)
        .where(
            and(
                eq(teams.organizationId, organizationId),
                eq(teams.externalId, externalId),
            ),
        )
        .limit(1);
    return row ?? null;
}

export async function getTeamForOrganization(
    organizationId: string,
    publicTeamId: string,
): Promise<Team | null> {
    const [row] = await db
        .select()
        .from(teams)
        .where(
            and(
                eq(teams.organizationId, organizationId),
                eq(teams.teamId, publicTeamId),
            ),
        )
        .limit(1);
    return row ?? null;
}

export async function listTeamsForOrganization(
    organizationId: string,
): Promise<Team[]> {
    return db
        .select()
        .from(teams)
        .where(eq(teams.organizationId, organizationId));
}

export async function setTeamSendingStatus(
    teamId: string,
    status: "active" | "sending_suspended" | "archived",
): Promise<Team | null> {
    const [row] = await db
        .update(teams)
        .set({ status, updatedAt: new Date() })
        .where(eq(teams.id, teamId))
        .returning();
    return row ?? null;
}

/** Explicit lifecycle update used by an organization integration. It is
 * deliberately unable to alter externalId, ownership, or grant ESP. */
export async function updateProvisionedTeam(
    teamId: string,
    input: {
        name?: string;
        sender?: { fromName?: string | null; replyTo?: string | null };
        mailingAddress?: string | null;
        delivery?: { teamEspEnabled?: boolean; teamCanChangeDefault?: boolean };
        quota?: { dailyLimit?: number | null; monthlyLimit?: number | null };
    },
): Promise<Team | null> {
    return db.transaction(async (tx) => {
        const [team] = await tx
            .select()
            .from(teams)
            .where(eq(teams.id, teamId))
            .limit(1)
            .for("update");
        if (!team) return null;
        if (team.status === "archived") throw new Error("team_archived");
        if (input.name !== undefined) {
            await tx
                .update(teams)
                .set({ name: input.name, updatedAt: new Date() })
                .where(eq(teams.id, team.id));
        }
        if (input.mailingAddress !== undefined) {
            await tx
                .update(settings)
                .set({
                    mailingAddress: input.mailingAddress,
                    updatedAt: new Date(),
                })
                .where(eq(settings.teamId, team.id));
        }
        if (input.delivery) {
            await tx
                .update(teamDeliverySettings)
                .set({ ...input.delivery, updatedAt: new Date() })
                .where(eq(teamDeliverySettings.teamId, team.id));
        }
        if (input.sender || input.quota) {
            const [grant] = await tx
                .select()
                .from(espConfigTeamGrants)
                .where(
                    and(
                        eq(espConfigTeamGrants.teamId, team.id),
                        eq(
                            espConfigTeamGrants.organizationId,
                            team.organizationId,
                        ),
                        // Provisioning updates only the current grant;
                        // revoked records are historical.
                        ne(espConfigTeamGrants.status, "revoked"),
                    ),
                )
                .limit(1)
                .for("update");
            if (!grant) throw new Error("organization_delivery_disabled");
            await tx
                .update(espConfigTeamGrants)
                .set({
                    ...(input.sender?.fromName !== undefined
                        ? { fromName: input.sender.fromName }
                        : {}),
                    ...(input.sender?.replyTo !== undefined
                        ? { replyTo: input.sender.replyTo }
                        : {}),
                    ...(input.quota?.dailyLimit !== undefined
                        ? { dailyLimit: input.quota.dailyLimit }
                        : {}),
                    ...(input.quota?.monthlyLimit !== undefined
                        ? { monthlyLimit: input.quota.monthlyLimit }
                        : {}),
                    updatedAt: new Date(),
                })
                .where(eq(espConfigTeamGrants.id, grant.id));
        }
        const [updated] = await tx
            .select()
            .from(teams)
            .where(eq(teams.id, team.id))
            .limit(1);
        return updated ?? null;
    });
}

export async function getProvisionedTeamView(team: Team) {
    const [[general], [delivery]] = await Promise.all([
        db.select().from(settings).where(eq(settings.teamId, team.id)).limit(1),
        db
            .select()
            .from(teamDeliverySettings)
            .where(eq(teamDeliverySettings.teamId, team.id))
            .limit(1),
    ]);
    return { team, general: general ?? null, delivery: delivery ?? null };
}

/**
 * Creates a team inside one organization. Human-created teams explicitly add
 * their creator as a team admin; provisioned teams pass no creator and gain no
 * human access as a side effect.
 *
 * `withDefaultApiKey` opts into also minting a "Default" API key for the new
 * team — only worth doing when the caller has an actual way to hand the
 * one-time secret to whoever needs it (provisioning's response body,
 * bootstrap's startup log). Dashboard/MCP-driven team creation has no such
 * surface, so it defaults to `false`: better to have the user mint a key
 * explicitly (and see it) than to silently burn one they'll never see.
 */
export async function createTeam({
    organizationId,
    creatorUserId,
    name,
    externalId,
    provisioningRequestHash,
    sender,
    mailingAddress,
    delivery,
    quota,
    createdBy,
    withDefaultApiKey = false,
}: {
    organizationId: string;
    creatorUserId?: string;
    name: string;
    externalId?: string;
    provisioningRequestHash?: string;
    sender?: { fromName?: string; replyTo?: string };
    mailingAddress?: string;
    delivery?: {
        useOrganizationDefault?: boolean;
        teamEspEnabled?: boolean;
        teamCanChangeDefault?: boolean;
    };
    quota?: { dailyLimit?: number | null; monthlyLimit?: number | null };
    createdBy?: {
        type: "user" | "organization_key" | "system";
        id?: string;
    };
    withDefaultApiKey?: boolean;
}): Promise<CreatedTeam> {
    return db.transaction(async (tx) => {
        const [policy] = await tx
            .select()
            .from(organizationDeliveryPolicies)
            .where(
                eq(organizationDeliveryPolicies.organizationId, organizationId),
            )
            .limit(1);
        const [created] = await tx
            .insert(teams)
            .values({
                organizationId,
                name,
                externalId,
                provisioningRequestHash,
            })
            .returning();
        await tx.insert(settings).values({
            teamId: created.id,
            mailingAddress,
        });
        const teamEspEnabled =
            delivery?.teamEspEnabled ?? policy?.teamEspEnabledByDefault ?? true;
        const teamCanChangeDefault =
            delivery?.teamCanChangeDefault ??
            policy?.teamCanChangeDefault ??
            true;
        const useOrganizationDefault =
            delivery?.useOrganizationDefault ??
            policy?.autoGrantDefaultEsp ??
            false;
        let defaultSource: "organization" | null = null;
        if (useOrganizationDefault) {
            if (!policy?.defaultEspConfigId) {
                throw new Error("organization_esp_unavailable");
            }
            const [organizationEsp] = await tx
                .select({ id: espConfigs.id })
                .from(espConfigs)
                .where(
                    and(
                        eq(espConfigs.id, policy.defaultEspConfigId),
                        eq(espConfigs.organizationId, organizationId),
                        eq(espConfigs.ownerScope, "organization"),
                        eq(espConfigs.status, "active"),
                    ),
                )
                .limit(1);
            if (!organizationEsp) {
                throw new Error("organization_esp_unavailable");
            }
            await tx.insert(espConfigTeamGrants).values({
                organizationId,
                espConfigId: organizationEsp.id,
                teamId: created.id,
                fromName: sender?.fromName,
                replyTo: sender?.replyTo,
                dailyLimit:
                    quota?.dailyLimit ?? policy.defaultDailyLimit ?? null,
                monthlyLimit:
                    quota?.monthlyLimit ?? policy.defaultMonthlyLimit ?? null,
                createdByType:
                    createdBy?.type ?? (creatorUserId ? "user" : "system"),
                createdById: createdBy?.id ?? creatorUserId,
            });
            defaultSource = "organization";
        }
        await tx.insert(teamDeliverySettings).values({
            teamId: created.id,
            teamEspEnabled,
            teamCanChangeDefault,
            defaultSource,
        });
        if (creatorUserId) {
            await tx.insert(teamMembers).values({
                teamId: created.id,
                userId: creatorUserId,
                role: "admin",
            });
        }
        if (!withDefaultApiKey) return created;
        const { secret } = await createApiKey(
            created.id,
            "Default",
            {
                createdByType:
                    createdBy?.type ?? (creatorUserId ? "user" : "system"),
                createdById: createdBy?.id ?? creatorUserId,
            },
            tx,
        );
        return { ...created, defaultApiKeySecret: secret };
    });
}

/**
 * Idempotent find-or-create keyed by a consumer-supplied `externalId` (e.g.
 * `courselit:<domainId>`) — used by `provisioning/routes.ts` so a
 * multi-tenant consumer can safely call this on every request without
 * tracking "have I already provisioned this tenant" state itself. Note this
 * intentionally does *not* key off `ownerEmail`, since two of the consumer's
 * own tenants may share an owner email — that would incorrectly merge them
 * into one team.
 */
export async function findOrCreateTeamByExternalId({
    organizationId,
    externalId,
    name,
    provisioningRequestHash,
    sender,
    mailingAddress,
    delivery,
    quota,
    createdBy,
}: {
    organizationId: string;
    externalId: string;
    name: string;
    provisioningRequestHash: string;
    sender?: { fromName?: string; replyTo?: string };
    mailingAddress?: string;
    delivery?: {
        useOrganizationDefault?: boolean;
        teamEspEnabled?: boolean;
        teamCanChangeDefault?: boolean;
    };
    quota?: { dailyLimit?: number | null; monthlyLimit?: number | null };
    createdBy?: {
        type: "organization_key" | "system";
        id?: string;
    };
}): Promise<CreatedTeam> {
    const existing = await getTeamByExternalId(organizationId, externalId);
    if (existing) {
        if (existing.provisioningRequestHash !== provisioningRequestHash) {
            throw new Error("provisioning_conflict");
        }
        return existing;
    }
    // Provisioning's response body is the consumer's only way to receive the
    // key, so this path always mints one (unlike other `createTeam` callers).
    try {
        return await createTeam({
            organizationId,
            name,
            externalId,
            provisioningRequestHash,
            sender,
            mailingAddress,
            delivery,
            quota,
            createdBy,
            withDefaultApiKey: true,
        });
    } catch (error: any) {
        if (error?.code !== "23505") throw error;
        const raced = await getTeamByExternalId(organizationId, externalId);
        if (!raced) throw error;
        if (raced.provisioningRequestHash !== provisioningRequestHash) {
            throw new Error("provisioning_conflict");
        }
        return raced;
    }
}

export async function renameTeam(
    teamId: string,
    name: string,
): Promise<Team | null> {
    const [row] = await db
        .update(teams)
        .set({ name, updatedAt: new Date() })
        .where(eq(teams.id, teamId))
        .returning();
    return row ?? null;
}

export async function archiveTeam(teamId: string): Promise<void> {
    const [team] = await db
        .select({ id: teams.id, organizationId: teams.organizationId })
        .from(teams)
        .where(eq(teams.id, teamId))
        .limit(1);
    if (!team) return;
    await db
        .update(teams)
        .set({ status: "archived", updatedAt: new Date() })
        .where(eq(teams.id, teamId));
    const [grant] = await db
        .select({ id: espConfigTeamGrants.id })
        .from(espConfigTeamGrants)
        .where(
            and(
                eq(espConfigTeamGrants.teamId, teamId),
                ne(espConfigTeamGrants.status, "revoked"),
            ),
        )
        .limit(1);
    if (grant) {
        await transitionEspGrant(team.organizationId, teamId, "cancel");
    }
}

export async function listTeamsForUser(userId: string): Promise<Team[]> {
    const rows = await db
        .select({ team: teams })
        .from(teamMembers)
        .innerJoin(teams, eq(teams.id, teamMembers.teamId))
        .where(and(eq(teamMembers.userId, userId), eq(teams.status, "active")));
    return rows.map((r) => r.team);
}

/** User-facing team enumeration includes the public organization identifier.
 * A team is still individually authorized; this field only lets the dashboard
 * partition teams into a coherent organization workspace. */
export async function listTeamViewsForUser(
    userId: string,
): Promise<TeamWithOrganization[]> {
    const rows = await db
        .select({
            team: teams,
            organizationPublicId: organizations.organizationId,
            organizationName: organizations.name,
        })
        .from(teamMembers)
        .innerJoin(teams, eq(teams.id, teamMembers.teamId))
        .innerJoin(organizations, eq(organizations.id, teams.organizationId))
        .where(and(eq(teamMembers.userId, userId), eq(teams.status, "active")));
    return rows.map((row) => ({
        ...row.team,
        organizationPublicId: row.organizationPublicId,
        organizationName: row.organizationName,
    }));
}

export async function getTeamMembership(
    teamId: string,
    userId: string,
): Promise<TeamMember | null> {
    const [row] = await db
        .select()
        .from(teamMembers)
        .where(
            and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, userId)),
        )
        .limit(1);
    return row ?? null;
}

/** Internal team ids the user already belongs to, used to flag org team
 * lists without a second round-trip per row. */
export async function listMemberTeamIdsForUser(
    userId: string,
    teamIds: string[],
): Promise<Set<string>> {
    if (teamIds.length === 0) return new Set();
    const rows = await db
        .select({ teamId: teamMembers.teamId })
        .from(teamMembers)
        .where(
            and(
                eq(teamMembers.userId, userId),
                inArray(teamMembers.teamId, teamIds),
            ),
        );
    return new Set(rows.map((row) => row.teamId));
}

/** Inserts `team_members` if missing. Unique `(team_id, user_id)` makes a
 * concurrent insert collapse to the existing row without a second grant. */
export async function ensureTeamMembership({
    teamId,
    userId,
    role,
}: {
    teamId: string;
    userId: string;
    role: "admin" | "member";
}): Promise<{ membership: TeamMember; created: boolean }> {
    const existing = await getTeamMembership(teamId, userId);
    if (existing) return { membership: existing, created: false };
    try {
        const [row] = await db
            .insert(teamMembers)
            .values({ teamId, userId, role })
            .returning();
        return { membership: row, created: true };
    } catch (error: any) {
        if (error?.code !== "23505") throw error;
        const raced = await getTeamMembership(teamId, userId);
        if (!raced) throw error;
        return { membership: raced, created: false };
    }
}

/** Persists the team an OAuth end-user picked on the post-login "select a
 * team" screen, keyed by their Better Auth session — see
 * `db/schema.ts#oauthPostLoginTeamSelections`. Upserts so re-visiting the
 * picker (e.g. to switch teams before finishing consent) overwrites the
 * prior choice rather than erroring. */
export async function setOAuthTeamSelection(
    sessionId: string,
    teamId: string,
): Promise<void> {
    await db
        .insert(oauthPostLoginTeamSelections)
        .values({ sessionId, teamId })
        .onConflictDoUpdate({
            target: oauthPostLoginTeamSelections.sessionId,
            set: { teamId, updatedAt: new Date() },
        });
}

/** Returns the internal team id picked for this session, or `null` if the
 * user hasn't been through the picker (yet, or ever — single-team accounts
 * never see it). */
export async function getOAuthTeamSelection(
    sessionId: string,
): Promise<string | null> {
    const [row] = await db
        .select({ teamId: oauthPostLoginTeamSelections.teamId })
        .from(oauthPostLoginTeamSelections)
        .where(eq(oauthPostLoginTeamSelections.sessionId, sessionId))
        .limit(1);
    return row?.teamId ?? null;
}
