import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { db } from "../db/client";
import {
  abuseFlags,
  account,
  oauthAccessToken,
  oauthClient,
  oauthConsent,
  oauthRefreshToken,
  organizationMembers,
  organizations,
  session,
  teamMembers,
  teams,
  user,
  verification,
} from "../db/schema";
import { captureEvent } from "../observability";
import { recordOrganizationAuditEvent } from "../organization/audit";
import { deleteOrganization } from "../organization/delete";
import {
  isActiveBillingManager,
  organizationCloseBlocker,
  removeOrganizationMember,
} from "../organization/queries";
import { eraseOrganizationPersonalData } from "./erase";

/** What deleting the account does to one organization the person is in. */
export type AccountOrganizationAction =
  /** They are its last owner: it is deleted with its contacts' data. */
  | "delete"
  /** Someone else stays in charge: only their membership goes. */
  | "leave";

export type AccountDeletionBlocker =
  /** A paid subscription is running on an organization that would be deleted. */
  | "active_subscription_exists"
  | "billing_checkout_pending"
  /** They are the last owner and other people are still members. */
  | "last_organization_owner"
  /** They pay for a running subscription of an organization they would leave. */
  | "billing_manager_required";

export interface AccountDeletionOrganization {
  /** Internal id; routes map it to the public `org_` id. */
  id: string;
  organizationId: string;
  name: string;
  status: string;
  role: "owner" | "admin" | "member";
  action: AccountOrganizationAction;
  teamCount: number;
  blocker: AccountDeletionBlocker | null;
}

export interface AccountDeletionPreview {
  organizations: AccountDeletionOrganization[];
  blocked: boolean;
}

export class AccountDeletionBlockedError extends Error {
  constructor(readonly preview: AccountDeletionPreview) {
    super("account_deletion_blocked");
    this.name = "AccountDeletionBlockedError";
  }
}

/**
 * Lists every organization the person belongs to with what deleting their
 * account does to it, and what (if anything) has to happen first.
 * Organizations that are already deleted (closed) are still listed when
 * they were the last owner, because their contacts' data is erased too.
 */
export async function previewAccountDeletion(
  userId: string,
): Promise<AccountDeletionPreview> {
  const memberships = await db
    .select({
      id: organizations.id,
      organizationId: organizations.organizationId,
      name: organizations.name,
      status: organizations.status,
      role: organizationMembers.role,
    })
    .from(organizationMembers)
    .innerJoin(organizations, eq(organizations.id, organizationMembers.organizationId))
    .where(eq(organizationMembers.userId, userId))
    .orderBy(organizations.createdAt);

  const result: AccountDeletionOrganization[] = [];
  for (const membership of memberships) {
    const others = await db
      .select({ role: organizationMembers.role })
      .from(organizationMembers)
      .where(
        and(
          eq(organizationMembers.organizationId, membership.id),
          ne(organizationMembers.userId, userId),
        ),
      );
    const lastOwner =
      membership.role === "owner" && !others.some((other) => other.role === "owner");
    const closed = membership.status === "closed";
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(teams)
      .where(eq(teams.organizationId, membership.id));

    let blocker: AccountDeletionBlocker | null = null;
    if (!closed) {
      if (lastOwner) {
        blocker =
          others.length > 0
            ? "last_organization_owner"
            : await organizationCloseBlocker(membership.id);
      } else if (await isActiveBillingManager(db, membership.id, userId)) {
        blocker = "billing_manager_required";
      }
    }
    result.push({
      ...membership,
      role: membership.role as AccountDeletionOrganization["role"],
      action: lastOwner ? "delete" : "leave",
      teamCount: count,
      blocker,
    });
  }
  return {
    organizations: result,
    blocked: result.some((organization) => organization.blocker !== null),
  };
}

export interface AccountDeletionResult {
  organizationsDeleted: number;
  organizationsLeft: number;
  contactsErased: number;
  mediaDeleted: number;
  mediaFailed: number;
}

/**
 * Deletes a person's account (#134, ADR 0009). Throws
 * `AccountDeletionBlockedError` and changes nothing while billing or another
 * member depends on them. Otherwise:
 *
 * 1. every organization they are the last owner of is deleted
 *    (`deleteOrganization`) and its contacts' personal data erased;
 * 2. they leave every other organization and team;
 * 3. their sessions, sign-in methods, OAuth tokens, consents and clients
 *    and pending codes are deleted, so they are signed out everywhere;
 * 4. the `user` row becomes an anonymous tombstone: name and email erased,
 *    `deletedAt` set. Its id stays in billing, audit and trial records.
 *
 * Signing in again with the same email creates a new, empty account.
 */
export async function deleteAccount(userId: string): Promise<AccountDeletionResult> {
  const [identity] = await db.select().from(user).where(eq(user.id, userId)).limit(1);
  if (!identity || identity.deletedAt) throw new Error("account_not_found");

  const preview = await previewAccountDeletion(userId);
  if (preview.blocked) throw new AccountDeletionBlockedError(preview);

  const actor = { type: "user" as const, id: userId };
  const result: AccountDeletionResult = {
    organizationsDeleted: 0,
    organizationsLeft: 0,
    contactsErased: 0,
    mediaDeleted: 0,
    mediaFailed: 0,
  };
  for (const organization of preview.organizations) {
    if (organization.action === "leave") {
      await removeOrganizationMember(organization.id, userId);
      await recordOrganizationAuditEvent(db, {
        organizationId: organization.id,
        actor,
        action: "organization.member_account_deleted",
      });
      result.organizationsLeft += 1;
      continue;
    }
    const [current] = await db
      .select({ status: organizations.status })
      .from(organizations)
      .where(eq(organizations.id, organization.id));
    if (current?.status !== "closed") {
      try {
        const deleted = await deleteOrganization(organization.id, actor);
        result.mediaDeleted += deleted.mediaDeleted;
        result.mediaFailed += deleted.mediaFailed;
      } catch (error: any) {
        // Billing changed since the preview: report it like the preview would.
        if (
          error?.message === "active_subscription_exists" ||
          error?.message === "billing_checkout_pending"
        ) {
          throw new AccountDeletionBlockedError(await previewAccountDeletion(userId));
        }
        throw error;
      }
    }
    const erased = await eraseOrganizationPersonalData(organization.id);
    result.contactsErased += erased.contactsErased;
    result.organizationsDeleted += 1;
  }

  await eraseIdentity(identity);

  captureEvent({
    event: "account_deleted",
    source: "account",
    properties: {
      user_id: userId,
      organizations_deleted_count: result.organizationsDeleted,
      organizations_left_count: result.organizationsLeft,
      contacts_erased_count: result.contactsErased,
      count: result.mediaDeleted,
      media_failed_count: result.mediaFailed,
    },
  });
  return result;
}

const OTP_TYPES = ["sign-in", "email-verification", "forget-password", "change-email"];

async function eraseIdentity(identity: typeof user.$inferSelect): Promise<void> {
  const now = new Date();
  await db.transaction(async (tx) => {
    await tx.delete(teamMembers).where(eq(teamMembers.userId, identity.id));
    await tx
      .delete(organizationMembers)
      .where(eq(organizationMembers.userId, identity.id));
    await tx.delete(oauthAccessToken).where(eq(oauthAccessToken.userId, identity.id));
    await tx.delete(oauthRefreshToken).where(eq(oauthRefreshToken.userId, identity.id));
    await tx.delete(oauthConsent).where(eq(oauthConsent.userId, identity.id));
    await tx.delete(oauthClient).where(eq(oauthClient.userId, identity.id));
    await tx.delete(session).where(eq(session.userId, identity.id));
    await tx.delete(account).where(eq(account.userId, identity.id));
    await tx
      .delete(verification)
      .where(
        inArray(verification.identifier, [
          identity.email,
          ...OTP_TYPES.map((type) => `${type}-otp-${identity.email}`),
        ]),
      );
    // Abuse review keeps the flag and the opaque user id, not the person.
    await tx
      .update(abuseFlags)
      .set({ details: sql`${abuseFlags.details} - 'email' - 'ip'` })
      .where(eq(abuseFlags.userId, identity.id));
    await tx
      .update(user)
      .set({
        name: "Deleted user",
        email: `deleted-${identity.id}@deleted.invalid`,
        emailVerified: false,
        image: null,
        defaultOrganizationId: null,
        deletedAt: now,
        updatedAt: now,
      })
      .where(eq(user.id, identity.id));
  });
}
