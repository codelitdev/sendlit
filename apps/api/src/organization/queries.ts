import { and, asc, eq, gt, inArray, isNull, ne, or, sql } from "drizzle-orm";
import { db } from "../db/client";
import {
    organizationMembers,
    billingCheckoutAttempts,
    organizationApiKeys,
    organizationDeliveryPolicies,
    espConfigTeamGrants,
    organizations,
    billingPlanStates,
    billingSubscriptions,
    settings,
    teams,
    teamDeliverySettings,
    teamMembers,
    user,
} from "../db/schema";
import { recordOrganizationAuditEvent } from "./audit";
import { transitionEspGrant } from "../delivery/queries";
import { findUserByEmail } from "../user/queries";
import { ensureOrganizationPlanState } from "../billing/entitlements";
import { resolveEntitlements } from "../billing/policies";
import { defaultTeamName } from "./default-team-name";

export type Organization = typeof organizations.$inferSelect;
export type OrganizationMember = typeof organizationMembers.$inferSelect;
export type OrganizationRole = "owner" | "admin" | "member";
type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Billing mutations lock live subscription rows before the organization so
 * they cannot deadlock with checkout, plan-change, or webhook projection. */
async function lockOrganizationSubscriptions(
    tx: Transaction,
    organizationId: string,
) {
    return tx
        .select({ id: billingSubscriptions.id })
        .from(billingSubscriptions)
        .where(eq(billingSubscriptions.billableEntityId, organizationId))
        .orderBy(asc(billingSubscriptions.id))
        .for("update");
}

export async function userOwnsFreeOrganization(
    userId: string,
): Promise<boolean> {
    return db.transaction((tx) => ownsEffectiveFreeOrganization(tx, userId));
}

async function ownsEffectiveFreeOrganization(
    tx: Transaction,
    userId: string,
    now = new Date(),
): Promise<boolean> {
    const owned = await tx
        .select({
            planState: billingPlanStates,
            subscription: billingSubscriptions,
        })
        .from(organizationMembers)
        .innerJoin(
            organizations,
            eq(organizations.id, organizationMembers.organizationId),
        )
        .innerJoin(
            billingPlanStates,
            eq(billingPlanStates.billableEntityId, organizations.id),
        )
        .leftJoin(
            billingSubscriptions,
            and(
                eq(billingSubscriptions.billableEntityId, organizations.id),
                eq(
                    billingSubscriptions.id,
                    billingPlanStates.activeSubscriptionId,
                ),
            ),
        )
        .where(
            and(
                eq(organizationMembers.userId, userId),
                eq(organizationMembers.role, "owner"),
                eq(organizations.status, "active"),
            ),
        );
    return owned.some(({ planState, subscription }) => {
        const entitlements = resolveEntitlements({
            organizationId: planState.billableEntityId,
            deploymentMode:
                process.env.SENDLIT_DEPLOYMENT_MODE === "cloud"
                    ? "cloud"
                    : "oss",
            planState: {
                plan: planState.plan as "free" | "pro" | "business",
                teamsLimitOverride: planState.teamsLimitOverride,
                contactsLimitOverride: planState.contactsLimitOverride,
            },
            subscription: subscription
                ? {
                      plan: subscription.plan as "pro" | "business",
                      billingInterval: subscription.billingInterval as
                          "month" | "year",
                      status: subscription.status as
                          | "pending"
                          | "trialing"
                          | "active"
                          | "past_due"
                          | "cancelled"
                          | "expired",
                      currentPeriodEndsAt: subscription.currentPeriodEndsAt,
                      paidThroughAt: subscription.paidThroughAt,
                      trialEndsAt: subscription.trialEndsAt,
                      graceEndsAt: subscription.graceEndsAt,
                      cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
                  }
                : null,
            now,
        });
        return entitlements.plan === "free";
    });
}

export async function getOrganization(
    id: string,
): Promise<Organization | null> {
    const [row] = await db
        .select()
        .from(organizations)
        .where(eq(organizations.id, id))
        .limit(1);
    return row ?? null;
}

export async function getOrganizationByPublicId(
    organizationId: string,
): Promise<Organization | null> {
    const [row] = await db
        .select()
        .from(organizations)
        .where(eq(organizations.organizationId, organizationId))
        .limit(1);
    return row ?? null;
}

export async function getOrganizationMembership(
    organizationId: string,
    userId: string,
): Promise<OrganizationMember | null> {
    const [row] = await db
        .select()
        .from(organizationMembers)
        .where(
            and(
                eq(organizationMembers.organizationId, organizationId),
                eq(organizationMembers.userId, userId),
            ),
        )
        .limit(1);
    return row ?? null;
}

export async function listOrganizationsForUser(
    userId: string,
): Promise<Organization[]> {
    const rows = await db
        .select({ organization: organizations })
        .from(organizationMembers)
        .innerJoin(
            organizations,
            eq(organizations.id, organizationMembers.organizationId),
        )
        .where(
            and(
                eq(organizationMembers.userId, userId),
                inArray(organizations.status, [
                    "pending_payment",
                    "active",
                    "suspended",
                ]),
            ),
        );
    return rows.map((row) => row.organization);
}

export async function createOrganization(
    userId: string,
    name: string,
    options: {
        createInitialTeam?: boolean;
        /** Used only by the paid-organization checkout. Pending rows do not
         * consume the user's one owned Free organization and cannot create a
         * team until a verified payment event activates them. */
        pendingPayment?: boolean;
    } = {},
): Promise<Organization> {
    return db.transaction(async (tx) => {
        const [identity] = await tx
            .select({ id: user.id })
            .from(user)
            .where(eq(user.id, userId))
            .limit(1)
            .for("update");
        if (!identity) throw new Error("user_not_found");
        const normalizedName = name.trim();
        if (!normalizedName) throw new Error("organization_name_required");
        if (options.pendingPayment && options.createInitialTeam) {
            throw new Error("pending_organization_cannot_create_team");
        }
        if (options.pendingPayment) {
            const [pending] = await tx
                .select({ id: organizations.id })
                .from(organizationMembers)
                .innerJoin(
                    organizations,
                    eq(organizations.id, organizationMembers.organizationId),
                )
                .where(
                    and(
                        eq(organizationMembers.userId, userId),
                        eq(organizationMembers.role, "owner"),
                        eq(organizations.status, "pending_payment"),
                    ),
                )
                .limit(1);
            if (pending) throw new Error("pending_organization_exists");
        }
        const [existingName] = await tx
            .select({ id: organizations.id })
            .from(organizationMembers)
            .innerJoin(
                organizations,
                eq(organizations.id, organizationMembers.organizationId),
            )
            .where(
                and(
                    eq(organizationMembers.userId, userId),
                    eq(organizationMembers.role, "owner"),
                    inArray(organizations.status, [
                        "pending_payment",
                        "active",
                        "suspended",
                    ]),
                    sql`lower(trim(${organizations.name})) = lower(trim(${normalizedName}))`,
                ),
            )
            .limit(1);
        if (existingName) throw new Error("organization_name_already_exists");
        if (
            process.env.SENDLIT_DEPLOYMENT_MODE === "cloud" &&
            !options.pendingPayment
        ) {
            if (await ownsEffectiveFreeOrganization(tx, userId)) {
                throw new Error("free_organization_already_owned");
            }
        }
        const [organization] = await tx
            .insert(organizations)
            .values({
                name: normalizedName,
                status: options.pendingPayment ? "pending_payment" : "active",
            })
            .returning();
        await tx.insert(organizationMembers).values({
            organizationId: organization.id,
            userId,
            role: "owner",
        });
        await tx.insert(organizationDeliveryPolicies).values({
            organizationId: organization.id,
        });
        await ensureOrganizationPlanState(tx, organization.id);
        if (options.createInitialTeam) {
            const [team] = await tx
                .insert(teams)
                .values({
                    organizationId: organization.id,
                    name: defaultTeamName(organization.name),
                })
                .returning();
            await tx.insert(settings).values({ teamId: team.id });
            await tx.insert(teamDeliverySettings).values({ teamId: team.id });
            await tx.insert(teamMembers).values({
                teamId: team.id,
                userId,
                role: "admin",
            });
        }
        await recordOrganizationAuditEvent(tx, {
            organizationId: organization.id,
            actor: { type: "user", id: userId },
            action: "organization.created",
        });
        return organization;
    });
}

export async function updateOrganizationName(
    organizationId: string,
    name: string,
    actorUserId?: string,
): Promise<Organization | null> {
    const normalizedName = name.trim();
    if (!normalizedName) throw new Error("organization_name_required");
    return db.transaction(async (tx) => {
        if (actorUserId) {
            await tx
                .select({ id: user.id })
                .from(user)
                .where(eq(user.id, actorUserId))
                .limit(1)
                .for("update");
        }
        const [current] = await tx
            .select()
            .from(organizations)
            .where(
                and(
                    eq(organizations.id, organizationId),
                    eq(organizations.status, "active"),
                ),
            )
            .limit(1)
            .for("update");
        if (!current) return null;
        if (actorUserId) {
            const [duplicate] = await tx
                .select({ id: organizations.id })
                .from(organizationMembers)
                .innerJoin(
                    organizations,
                    eq(organizations.id, organizationMembers.organizationId),
                )
                .where(
                    and(
                        eq(organizationMembers.userId, actorUserId),
                        eq(organizationMembers.role, "owner"),
                        ne(organizations.id, organizationId),
                        inArray(organizations.status, [
                            "pending_payment",
                            "active",
                            "suspended",
                        ]),
                        sql`lower(trim(${organizations.name})) = lower(trim(${normalizedName}))`,
                    ),
                )
                .limit(1);
            if (duplicate) throw new Error("organization_name_already_exists");
        }
        const [row] = await tx
            .update(organizations)
            .set({ name: normalizedName, updatedAt: new Date() })
            .where(eq(organizations.id, organizationId))
            .returning();
        return row ?? null;
    });
}

export async function abandonPendingOrganization(
    organizationId: string,
    actorId: string,
): Promise<void> {
    await db.transaction(async (tx) => {
        const [organization] = await tx
            .select()
            .from(organizations)
            .where(eq(organizations.id, organizationId))
            .limit(1)
            .for("update");
        if (!organization) throw new Error("organization_not_found");
        if (organization.status !== "pending_payment") {
            throw new Error("organization_not_pending_payment");
        }
        const [membership] = await tx
            .select({ role: organizationMembers.role })
            .from(organizationMembers)
            .where(
                and(
                    eq(organizationMembers.organizationId, organizationId),
                    eq(organizationMembers.userId, actorId),
                ),
            )
            .limit(1);
        if (membership?.role !== "owner") {
            throw new Error("organization_owner_required");
        }
        await tx
            .update(billingCheckoutAttempts)
            .set({
                status: "abandoned",
                checkoutUrlEncrypted: null,
                completedAt: new Date(),
                updatedAt: new Date(),
            })
            .where(
                and(
                    eq(
                        billingCheckoutAttempts.billableEntityId,
                        organizationId,
                    ),
                    inArray(billingCheckoutAttempts.status, [
                        "creating",
                        "open",
                    ]),
                ),
            );
        await tx
            .update(organizations)
            .set({ status: "abandoned", updatedAt: new Date() })
            .where(eq(organizations.id, organizationId));
        await recordOrganizationAuditEvent(tx, {
            organizationId,
            actor: { type: "user", id: actorId },
            action: "organization.pending_abandoned",
            metadata: {},
        });
    });
}

export async function closeOrganization(
    organizationId: string,
    actor: {
        type: "user" | "organization_key" | "team_key" | "system";
        id?: string | null;
    } = {
        type: "system",
    },
): Promise<void> {
    const { getBillingEngine } = await import("../billing/engine.js");
    const blockers = await getBillingEngine().getBillableEntityBillingBlockers(
        { kind: "organization", id: organizationId },
        new Date(),
    );
    if (
        blockers.includes("nonterminal_subscription") ||
        blockers.includes("future_paid_entitlement")
    ) {
        throw new Error("active_subscription_exists");
    }
    if (blockers.includes("live_checkout")) {
        throw new Error("billing_checkout_pending");
    }
    await db.transaction(async (tx) => {
        const liveSubscriptions = await tx
            .select({ id: billingSubscriptions.id })
            .from(billingSubscriptions)
            .where(
                and(
                    eq(billingSubscriptions.billableEntityId, organizationId),
                    or(
                        inArray(billingSubscriptions.status, [
                            "pending",
                            "trialing",
                            "active",
                            "past_due",
                        ]),
                        and(
                            eq(billingSubscriptions.status, "cancelled"),
                            eq(billingSubscriptions.cancelAtPeriodEnd, true),
                            gt(billingSubscriptions.paidThroughAt, new Date()),
                        ),
                    ),
                ),
            )
            .orderBy(asc(billingSubscriptions.id))
            .for("update");
        if (liveSubscriptions.length > 0) {
            throw new Error("active_subscription_exists");
        }
        const openCheckouts = await tx
            .select({ id: billingCheckoutAttempts.id })
            .from(billingCheckoutAttempts)
            .where(
                and(
                    eq(
                        billingCheckoutAttempts.billableEntityId,
                        organizationId,
                    ),
                    inArray(billingCheckoutAttempts.status, [
                        "creating",
                        "open",
                    ]),
                    gt(billingCheckoutAttempts.expiresAt, new Date()),
                ),
            )
            .orderBy(asc(billingCheckoutAttempts.id))
            .for("update");
        if (openCheckouts.length > 0) {
            throw new Error("billing_checkout_pending");
        }
        const [organization] = await tx
            .select({ id: organizations.id })
            .from(organizations)
            .where(eq(organizations.id, organizationId))
            .limit(1)
            .for("update");
        if (!organization) throw new Error("organization_not_found");
        await tx
            .update(organizations)
            .set({ status: "closed", updatedAt: new Date() })
            .where(eq(organizations.id, organizationId));
        await tx
            .update(organizationApiKeys)
            .set({ revokedAt: new Date() })
            .where(
                and(
                    eq(organizationApiKeys.organizationId, organizationId),
                    isNull(organizationApiKeys.revokedAt),
                ),
            );
        await tx
            .update(teams)
            .set({ status: "archived", updatedAt: new Date() })
            .where(
                and(
                    eq(teams.organizationId, organizationId),
                    ne(teams.status, "archived"),
                ),
            );
        await recordOrganizationAuditEvent(tx, {
            organizationId,
            actor,
            action: "organization.closed",
        });
    });
    // Closing is the immediate fail-closed boundary; cancellation afterwards
    // performs durable queue/quota cleanup using the same grant transition as
    // an explicit operator cancellation.
    const grants = await db
        .select({ teamId: espConfigTeamGrants.teamId })
        .from(espConfigTeamGrants)
        .where(
            and(
                eq(espConfigTeamGrants.organizationId, organizationId),
                ne(espConfigTeamGrants.status, "revoked"),
            ),
        );
    for (const grant of grants) {
        await transitionEspGrant(organizationId, grant.teamId, "cancel");
    }
}

export async function listOrganizationMembers(organizationId: string) {
    return db
        .select({
            userId: user.id,
            email: user.email,
            name: user.name,
            image: user.image,
            role: organizationMembers.role,
            createdAt: organizationMembers.createdAt,
            updatedAt: organizationMembers.updatedAt,
        })
        .from(organizationMembers)
        .innerJoin(user, eq(user.id, organizationMembers.userId))
        .where(eq(organizationMembers.organizationId, organizationId));
}

export async function getOrganizationMemberView(
    organizationId: string,
    userId: string,
) {
    const rows = await db
        .select({
            userId: user.id,
            email: user.email,
            name: user.name,
            image: user.image,
            role: organizationMembers.role,
            createdAt: organizationMembers.createdAt,
            updatedAt: organizationMembers.updatedAt,
        })
        .from(organizationMembers)
        .innerJoin(user, eq(user.id, organizationMembers.userId))
        .where(
            and(
                eq(organizationMembers.organizationId, organizationId),
                eq(organizationMembers.userId, userId),
            ),
        )
        .limit(1);
    return rows[0] ?? null;
}

export async function addOrganizationMemberByEmail(
    organizationId: string,
    email: string,
    role: OrganizationRole,
) {
    const identity = await findUserByEmail(email);
    if (!identity) return null;
    await db.transaction(async (tx) => {
        await tx
            .select({ id: user.id })
            .from(user)
            .where(eq(user.id, identity.id))
            .limit(1)
            .for("update");
        if (
            role === "owner" &&
            process.env.SENDLIT_DEPLOYMENT_MODE === "cloud"
        ) {
            if (await ownsEffectiveFreeOrganization(tx, identity.id)) {
                throw new Error("free_organization_already_owned");
            }
        }
        await tx
            .insert(organizationMembers)
            .values({ organizationId, userId: identity.id, role });
    });
    return getOrganizationMemberView(organizationId, identity.id);
}

async function assertNotLastOwner(
    tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
    organizationId: string,
    userId: string,
): Promise<void> {
    const owners = await tx
        .select({ userId: organizationMembers.userId })
        .from(organizationMembers)
        .where(
            and(
                eq(organizationMembers.organizationId, organizationId),
                eq(organizationMembers.role, "owner"),
            ),
        )
        .for("update");
    if (owners.length === 1 && owners[0].userId === userId) {
        throw new Error("last_organization_owner");
    }
}

async function assertBillingManagerRetained(
    tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
    organizationId: string,
    userId: string,
): Promise<void> {
    const [subscription] = await tx
        .select({ id: billingSubscriptions.id })
        .from(billingSubscriptions)
        .where(
            and(
                eq(billingSubscriptions.billableEntityId, organizationId),
                eq(billingSubscriptions.payerId, userId),
                or(
                    inArray(billingSubscriptions.status, [
                        "pending",
                        "trialing",
                        "active",
                        "past_due",
                    ]),
                    and(
                        eq(billingSubscriptions.status, "cancelled"),
                        eq(billingSubscriptions.cancelAtPeriodEnd, true),
                        gt(billingSubscriptions.paidThroughAt, new Date()),
                    ),
                ),
            ),
        )
        .limit(1)
        .for("update");
    if (subscription) throw new Error("billing_manager_required");
}

export async function updateOrganizationMemberRole(
    organizationId: string,
    userId: string,
    role: OrganizationRole,
) {
    await db.transaction(async (tx) => {
        await lockOrganizationSubscriptions(tx, organizationId);
        await tx
            .select({ id: organizations.id })
            .from(organizations)
            .where(eq(organizations.id, organizationId))
            .limit(1)
            .for("update");
        const [membership] = await tx
            .select()
            .from(organizationMembers)
            .where(
                and(
                    eq(organizationMembers.organizationId, organizationId),
                    eq(organizationMembers.userId, userId),
                ),
            )
            .limit(1)
            .for("update");
        if (!membership) throw new Error("member_not_found");
        if (
            membership.role !== "owner" &&
            role === "owner" &&
            process.env.SENDLIT_DEPLOYMENT_MODE === "cloud"
        ) {
            await tx
                .select({ id: user.id })
                .from(user)
                .where(eq(user.id, userId))
                .limit(1)
                .for("update");
            if (await ownsEffectiveFreeOrganization(tx, userId)) {
                throw new Error("free_organization_already_owned");
            }
        }
        if (membership.role === "owner" && role !== "owner") {
            await assertNotLastOwner(tx, organizationId, userId);
        }
        if (role !== "owner")
            await assertBillingManagerRetained(tx, organizationId, userId);
        await tx
            .update(organizationMembers)
            .set({ role, updatedAt: new Date() })
            .where(eq(organizationMembers.id, membership.id));
    });
    return getOrganizationMemberView(organizationId, userId);
}

export async function removeOrganizationMember(
    organizationId: string,
    userId: string,
): Promise<boolean> {
    return db.transaction(async (tx) => {
        await lockOrganizationSubscriptions(tx, organizationId);
        await tx
            .select({ id: organizations.id })
            .from(organizations)
            .where(eq(organizations.id, organizationId))
            .limit(1)
            .for("update");
        const [membership] = await tx
            .select()
            .from(organizationMembers)
            .where(
                and(
                    eq(organizationMembers.organizationId, organizationId),
                    eq(organizationMembers.userId, userId),
                ),
            )
            .limit(1)
            .for("update");
        if (!membership) return false;
        if (membership.role === "owner") {
            await assertNotLastOwner(tx, organizationId, userId);
        }
        await assertBillingManagerRetained(tx, organizationId, userId);
        await tx
            .delete(organizationMembers)
            .where(eq(organizationMembers.id, membership.id));
        return true;
    });
}

/**
 * Creates the first organization graph exactly once for a Better Auth user.
 * Authentication and application bootstrap are separate transactions, so
 * every auth resolution may safely retry this operation.
 */
export async function ensureDefaultOrganization(
    userId: string,
): Promise<Organization | null> {
    return db.transaction(async (tx) => {
        const [identity] = await tx
            .select()
            .from(user)
            .where(eq(user.id, userId))
            .limit(1)
            .for("update");
        if (!identity) return null;

        if (identity.defaultOrganizationId) {
            const [existing] = await tx
                .select()
                .from(organizations)
                .where(eq(organizations.id, identity.defaultOrganizationId))
                .limit(1);
            if (existing && ["active", "suspended"].includes(existing.status)) {
                const [team] = await tx
                    .select({ id: teams.id })
                    .from(teams)
                    .where(eq(teams.organizationId, existing.id))
                    .limit(1);
                if (!team) {
                    const [createdTeam] = await tx
                        .insert(teams)
                        .values({
                            organizationId: existing.id,
                            name: defaultTeamName(existing.name),
                        })
                        .returning();
                    await tx
                        .insert(settings)
                        .values({ teamId: createdTeam.id });
                    await tx
                        .insert(teamDeliverySettings)
                        .values({ teamId: createdTeam.id });
                    await tx.insert(teamMembers).values({
                        teamId: createdTeam.id,
                        userId: identity.id,
                        role: "admin",
                    });
                }
                return existing;
            }
        }

        // Auth bootstrap can run for users imported from an existing
        // organization graph. Reuse that membership instead of creating a
        // second organization (and, consequently, a second default team).
        const [existingMembership] = await tx
            .select({ organization: organizations })
            .from(organizationMembers)
            .innerJoin(
                organizations,
                eq(organizations.id, organizationMembers.organizationId),
            )
            .where(
                and(
                    eq(organizationMembers.userId, identity.id),
                    inArray(organizations.status, ["active", "suspended"]),
                ),
            )
            .limit(1);
        if (existingMembership) {
            await tx
                .update(user)
                .set({
                    defaultOrganizationId: existingMembership.organization.id,
                    updatedAt: new Date(),
                })
                .where(eq(user.id, identity.id));
            const [team] = await tx
                .select({ id: teams.id })
                .from(teams)
                .where(
                    eq(
                        teams.organizationId,
                        existingMembership.organization.id,
                    ),
                )
                .limit(1);
            if (!team) {
                const [createdTeam] = await tx
                    .insert(teams)
                    .values({
                        organizationId: existingMembership.organization.id,
                        name: defaultTeamName(
                            existingMembership.organization.name,
                        ),
                    })
                    .returning();
                await tx.insert(settings).values({ teamId: createdTeam.id });
                await tx
                    .insert(teamDeliverySettings)
                    .values({ teamId: createdTeam.id });
                await tx.insert(teamMembers).values({
                    teamId: createdTeam.id,
                    userId: identity.id,
                    role: "admin",
                });
            }
            return existingMembership.organization;
        }

        const organizationName = identity.name.trim()
            ? `${identity.name.trim()}'s Organization`
            : `${identity.email}'s Organization`;
        const [organization] = await tx
            .insert(organizations)
            .values({ name: organizationName })
            .returning();
        await tx.insert(organizationMembers).values({
            organizationId: organization.id,
            userId: identity.id,
            role: "owner",
        });
        await tx.insert(organizationDeliveryPolicies).values({
            organizationId: organization.id,
        });
        await ensureOrganizationPlanState(tx, organization.id);
        const [team] = await tx
            .insert(teams)
            .values({
                organizationId: organization.id,
                name: defaultTeamName(organization.name),
            })
            .returning();
        await tx.insert(settings).values({ teamId: team.id });
        await tx.insert(teamDeliverySettings).values({ teamId: team.id });
        await tx
            .insert(teamMembers)
            .values({ teamId: team.id, userId: identity.id, role: "admin" });
        await tx
            .update(user)
            .set({
                defaultOrganizationId: organization.id,
                updatedAt: new Date(),
            })
            .where(eq(user.id, identity.id));
        return organization;
    });
}
