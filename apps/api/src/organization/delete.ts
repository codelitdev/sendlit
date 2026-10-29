import { and, eq, inArray, isNotNull, isNull, ne, or } from "drizzle-orm";
import { db } from "../db/client";
import { espConfigs, sendingDomains, teamApiKeys, teams } from "../db/schema";
import { deleteTeamMediaFiles } from "../media/queries";
import { captureEvent } from "../observability";
import { transitionEspConfig } from "../settings/esp/queries";
import { closeOrganization } from "./queries";

type Actor = Parameters<typeof closeOrganization>[1];

export interface OrganizationDeletionResult {
  teamCount: number;
  mediaDeleted: number;
  mediaFailed: number;
}

/**
 * Deletes an organization for its owner (dashboard danger zone, and later
 * account deletion, #134).
 *
 * The organization is closed rather than hard-deleted: billing history,
 * audit events, delivery reporting and suppressions stay, because
 * compliance and the billing engine need them and they are only reachable
 * through the closed organization. Everything that could still send mail,
 * act on the organization's behalf or cost storage is retired:
 *
 * - billing blocks first: an active or paid-through subscription, or an
 *   open checkout, throws (`active_subscription_exists`,
 *   `billing_checkout_pending`) and nothing changes;
 * - the organization is closed, its teams archived, organization keys
 *   revoked and ESP grants cancelled (`closeOrganization`);
 * - team API keys are revoked, sending domains revoked, and every ESP
 *   config (shared and team-owned) retired with its credentials wiped;
 * - every `media` row of its teams is deleted with its MediaLit file. A
 *   MediaLit failure does not undo the deletion: the file is queued for
 *   retry (`media/deletion-queue.ts`) and the error goes to `captureError`.
 */
export async function deleteOrganization(
  organizationId: string,
  actor: Actor,
): Promise<OrganizationDeletionResult> {
  await closeOrganization(organizationId, actor);

  const teamRows = await db
    .select({ id: teams.id })
    .from(teams)
    .where(eq(teams.organizationId, organizationId));
  const teamIds = teamRows.map((team) => team.id);
  const now = new Date();

  if (teamIds.length > 0) {
    await db
      .update(teamApiKeys)
      .set({ revokedAt: now })
      .where(and(inArray(teamApiKeys.teamId, teamIds), isNull(teamApiKeys.revokedAt)));
  }
  await db
    .update(sendingDomains)
    .set({ status: "revoked", nextCheckAt: null, updatedAt: now })
    .where(
      and(
        eq(sendingDomains.organizationId, organizationId),
        ne(sendingDomains.status, "revoked"),
      ),
    );

  const ownership =
    teamIds.length > 0
      ? or(
          eq(espConfigs.organizationId, organizationId),
          inArray(espConfigs.teamId, teamIds),
        )
      : eq(espConfigs.organizationId, organizationId);
  const configs = await db
    .select()
    .from(espConfigs)
    .where(and(ownership, ne(espConfigs.status, "retired")));
  for (const config of configs) {
    if (["active", "suspended", "draining"].includes(config.status)) {
      // Also cancels the queued work and grants that still point at it.
      await transitionEspConfig(config, "retire", { cancel: true });
    }
  }
  await db
    .update(espConfigs)
    .set({ status: "retired", retiredAt: now, drainUntil: null, updatedAt: now })
    .where(and(ownership, ne(espConfigs.status, "retired")));
  await db
    .update(espConfigs)
    .set({ encryptedSecret: null, updatedAt: now })
    .where(and(ownership, isNotNull(espConfigs.encryptedSecret)));

  let mediaDeleted = 0;
  let mediaFailed = 0;
  for (const teamId of teamIds) {
    const result = await deleteTeamMediaFiles(teamId);
    mediaDeleted += result.deleted;
    mediaFailed += result.failed;
  }

  captureEvent({
    event: "organization_deleted",
    source: "organization",
    properties: {
      organization_id: organizationId,
      teams_count: teamIds.length,
      count: mediaDeleted,
      media_failed_count: mediaFailed,
    },
  });

  return { teamCount: teamIds.length, mediaDeleted, mediaFailed };
}
