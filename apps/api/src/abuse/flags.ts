import { and, desc, eq, inArray } from "drizzle-orm";
import { releaseTeamSendingControl } from "../billing/reputation";
import { db } from "../db/client";
import {
  abuseFlags,
  organizationAuditEvents,
  organizations,
  sequenceEmails,
  teamSendingControls,
  teams,
} from "../db/schema";
import { captureEvent } from "../observability";
import { emailOperators, operatorRecipients } from "../operations/alerts";
import logger from "../services/log";

export type AbuseFlag = typeof abuseFlags.$inferSelect;
export type AbuseFlagKind = "signup" | "content" | "import";
export type AbuseSeverity = "low" | "medium" | "high";

function alertRecipients(): string[] {
  const operators = operatorRecipients("OPERATOR_ALERT_EMAIL");
  return operators.length ? operators : operatorRecipients("BILLING_ALERT_EMAIL");
}

/**
 * Adds a flag to the operators' review queue and emails them, unless the
 * same thing is already flagged and open (same organization, kind, email and
 * content). Returns the open flag either way.
 */
export async function raiseAbuseFlag(input: {
  organizationId: string;
  teamId?: string | null;
  userId?: string | null;
  kind: AbuseFlagKind;
  severity: AbuseSeverity;
  reason: string;
  details?: Record<string, unknown>;
  sequenceEmailId?: string | null;
  contentHash?: string | null;
}): Promise<AbuseFlag> {
  const [existing] = await db
    .select()
    .from(abuseFlags)
    .where(
      and(
        eq(abuseFlags.organizationId, input.organizationId),
        eq(abuseFlags.kind, input.kind),
        eq(abuseFlags.status, "open"),
        input.sequenceEmailId
          ? eq(abuseFlags.sequenceEmailId, input.sequenceEmailId)
          : undefined,
        input.contentHash ? eq(abuseFlags.contentHash, input.contentHash) : undefined,
      ),
    )
    .limit(1);
  if (existing) return existing;

  const [flag] = await db
    .insert(abuseFlags)
    .values({
      organizationId: input.organizationId,
      teamId: input.teamId ?? null,
      userId: input.userId ?? null,
      kind: input.kind,
      severity: input.severity,
      reason: input.reason,
      details: input.details ?? {},
      sequenceEmailId: input.sequenceEmailId ?? null,
      contentHash: input.contentHash ?? null,
    })
    .returning();
  const [organization] = await db
    .select({ publicId: organizations.organizationId, name: organizations.name })
    .from(organizations)
    .where(eq(organizations.id, input.organizationId))
    .limit(1);
  logger.warn(
    { abuse_flag: flag.flagId, kind: flag.kind, severity: flag.severity },
    "abuse flag raised",
  );
  captureEvent({
    event: "abuse_flag_raised",
    source: "abuse.flags",
    teamId: input.teamId ?? undefined,
    properties: { kind: flag.kind, severity: flag.severity },
  });
  await emailOperators(
    alertRecipients(),
    `[SendLit abuse] ${flag.severity} ${flag.kind}: ${organization?.name ?? input.organizationId}`,
    [
      `${flag.reason}`,
      `Flag: ${flag.flagId}`,
      `Organization: ${organization?.name} (${organization?.publicId})`,
      `Details: ${JSON.stringify(flag.details, null, 2)}`,
      "",
      `Review with: bun scripts/abuse.ts show ${flag.flagId}`,
    ].join("\n"),
  ).catch((error) => logger.error({ error }, "abuse alert email failed"));
  return flag;
}

export async function hasOpenAbuseFlag(
  organizationId: string,
  kind: AbuseFlagKind,
): Promise<boolean> {
  const [row] = await db
    .select({ id: abuseFlags.id })
    .from(abuseFlags)
    .where(
      and(
        eq(abuseFlags.organizationId, organizationId),
        eq(abuseFlags.kind, kind),
        eq(abuseFlags.status, "open"),
      ),
    )
    .limit(1);
  return Boolean(row);
}

export async function listAbuseFlags(status: "open" | "all" = "open") {
  return db
    .select({
      flag: abuseFlags,
      organizationPublicId: organizations.organizationId,
      organizationName: organizations.name,
    })
    .from(abuseFlags)
    .innerJoin(organizations, eq(organizations.id, abuseFlags.organizationId))
    .where(status === "open" ? eq(abuseFlags.status, "open") : undefined)
    .orderBy(desc(abuseFlags.createdAt))
    .limit(500);
}

export async function getAbuseFlag(flagId: string): Promise<AbuseFlag | null> {
  const [row] = await db
    .select()
    .from(abuseFlags)
    .where(eq(abuseFlags.flagId, flagId))
    .limit(1);
  return row ?? null;
}

/**
 * Pauses a team's sending for review without an operator: `all_paused` is
 * sticky (the reputation evaluator leaves it alone) until an operator
 * releases it. The organization sees a neutral audit entry.
 */
export async function pauseTeamForReview(
  teamId: string,
  reasonCode: "content_review" | "signup_review",
): Promise<void> {
  const now = new Date();
  await db.transaction(async (tx) => {
    const [team] = await tx
      .select({ organizationId: teams.organizationId })
      .from(teams)
      .where(eq(teams.id, teamId))
      .limit(1)
      .for("update");
    if (!team) return;
    await tx
      .insert(teamSendingControls)
      .values({
        teamId,
        status: "all_paused",
        reasonCode,
        source: "abuse",
        enteredAt: now,
        evaluatedAt: now,
      })
      .onConflictDoUpdate({
        target: teamSendingControls.teamId,
        set: {
          status: "all_paused",
          reasonCode,
          source: "abuse",
          enteredAt: now,
          evaluatedAt: now,
          cleanEvaluationDays: 0,
          updatedAt: now,
        },
      });
    await tx.insert(organizationAuditEvents).values({
      organizationId: team.organizationId,
      teamId,
      actorType: "system",
      action: "team.sending_paused_for_review",
      metadata: { reason: reasonCode },
    });
  });
}

/**
 * Closes a flag. `released` lets the organization continue: approved content
 * can be started, a held import no longer blocks campaigns, and teams paused
 * for this review are released. `confirmed` suspends the organization's
 * sending. Returns the updated flag, or null if it doesn't exist or is closed.
 */
export async function resolveAbuseFlag(input: {
  flagId: string;
  resolution: "released" | "confirmed";
  operatorUserId: string;
  note: string;
}): Promise<AbuseFlag | null> {
  const flag = await getAbuseFlag(input.flagId);
  if (flag?.status !== "open") return null;
  const now = new Date();
  const [updated] = await db
    .update(abuseFlags)
    .set({
      status: input.resolution,
      resolvedAt: now,
      resolvedBy: input.operatorUserId,
      resolutionNote: input.note,
      updatedAt: now,
    })
    .where(and(eq(abuseFlags.id, flag.id), eq(abuseFlags.status, "open")))
    .returning();
  if (!updated) return null;

  if (input.resolution === "confirmed") {
    await setOrganizationSuspended(flag.organizationId, true, input.operatorUserId);
    return updated;
  }
  if (flag.kind === "content" && flag.sequenceEmailId && flag.contentHash) {
    await db
      .update(sequenceEmails)
      .set({ contentScanVerdict: "approved", contentScannedAt: now })
      .where(
        and(
          eq(sequenceEmails.id, flag.sequenceEmailId),
          eq(sequenceEmails.contentScanHash, flag.contentHash),
        ),
      );
  }
  const pausedTeams = await db
    .select({ teamId: teamSendingControls.teamId })
    .from(teamSendingControls)
    .innerJoin(teams, eq(teams.id, teamSendingControls.teamId))
    .where(
      and(
        eq(teams.organizationId, flag.organizationId),
        eq(teamSendingControls.source, "abuse"),
        eq(teamSendingControls.status, "all_paused"),
        inArray(teamSendingControls.reasonCode, [
          flag.kind === "content" ? "content_review" : "signup_review",
        ]),
      ),
    );
  for (const { teamId } of pausedTeams) {
    await releaseTeamSendingControl(teamId, input.operatorUserId, input.note);
  }
  return updated;
}

/** Stops (or restores) all sending of an organization. Nothing else sets
 * `organizations.status = 'suspended'`, and billing never undoes it. */
export async function setOrganizationSuspended(
  organizationId: string,
  suspended: boolean,
  operatorUserId: string,
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [organization] = await tx
      .select({ status: organizations.status })
      .from(organizations)
      .where(eq(organizations.id, organizationId))
      .limit(1)
      .for("update");
    if (!organization) return false;
    const from = suspended ? "active" : "suspended";
    if (organization.status !== from) return false;
    await tx
      .update(organizations)
      .set({ status: suspended ? "suspended" : "active", updatedAt: new Date() })
      .where(eq(organizations.id, organizationId));
    await tx.insert(organizationAuditEvents).values({
      organizationId,
      actorType: "user",
      actorId: operatorUserId,
      action: suspended ? "organization.suspended" : "organization.unsuspended",
      metadata: {},
    });
    return true;
  });
}
