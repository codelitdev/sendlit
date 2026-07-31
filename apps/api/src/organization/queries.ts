import { and, eq, isNull, ne } from "drizzle-orm";
import { db } from "../db/client";
import {
    organizationMembers,
    organizationApiKeys,
    organizationDeliveryPolicies,
    espConfigTeamGrants,
    organizations,
    teams,
    user,
} from "../db/schema";
import { recordOrganizationAuditEvent } from "./audit";
import { transitionEspGrant } from "../delivery/queries";
import { findUserByEmail } from "../user/queries";

export type Organization = typeof organizations.$inferSelect;
export type OrganizationMember = typeof organizationMembers.$inferSelect;
export type OrganizationRole = "owner" | "admin" | "member";

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
        .where(eq(organizationMembers.userId, userId));
    return rows.map((row) => row.organization);
}

export async function createOrganization(
    userId: string,
    name: string,
): Promise<Organization> {
    return db.transaction(async (tx) => {
        const [organization] = await tx
            .insert(organizations)
            .values({ name })
            .returning();
        await tx.insert(organizationMembers).values({
            organizationId: organization.id,
            userId,
            role: "owner",
        });
        await tx.insert(organizationDeliveryPolicies).values({
            organizationId: organization.id,
        });
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
): Promise<Organization | null> {
    const [row] = await db
        .update(organizations)
        .set({ name, updatedAt: new Date() })
        .where(
            and(
                eq(organizations.id, organizationId),
                eq(organizations.status, "active"),
            ),
        )
        .returning();
    return row ?? null;
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
    await db.transaction(async (tx) => {
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
    await db.insert(organizationMembers).values({
        organizationId,
        userId: identity.id,
        role,
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

export async function updateOrganizationMemberRole(
    organizationId: string,
    userId: string,
    role: OrganizationRole,
) {
    await db.transaction(async (tx) => {
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
        if (membership.role === "owner" && role !== "owner") {
            await assertNotLastOwner(tx, organizationId, userId);
        }
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
            if (existing) return existing;
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
