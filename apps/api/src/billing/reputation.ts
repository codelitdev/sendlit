import { and, count, eq, gt, gte, inArray, lt, sql } from "drizzle-orm";
import { db } from "../db/client";
import {
  billingPlanStates,
  organizationAuditEvents,
  outboundMessages,
  planSendReservations,
  teamSendingControls,
  teams,
} from "../db/schema";
import logger from "../services/log";
import { getOrganizationEntitlements } from "./entitlements";
import { notifyReputationChange } from "./notifications";
import { readReputationConfig } from "./reputation-config";
import {
  advanceControlState,
  type ReputationMetrics,
  reputationDecision,
  utcDayStart,
} from "./reputation-policy";

export { readReputationConfig } from "./reputation-config";

export type SendingControlStatus =
  | "normal"
  | "warned"
  | "marketing_paused"
  | "all_paused";

const WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/** Count fragments over the outbound ledger: bounced and complained sends. */
export const BOUNCED = sql`CASE WHEN ${outboundMessages.deliveryStatus} = 'bounced' THEN 1 END`;
export const COMPLAINED = sql`CASE WHEN ${outboundMessages.feedbackStatus} = 'complained' THEN 1 END`;

export type LedgerCounts = ReputationMetrics & { teamId: string };

/**
 * Each team's seven-day accepted, bounced and complained counts from the
 * deduplicated outbound ledger, so retries and duplicate provider events
 * can't inflate rates. `since` narrows the window but never widens it.
 * With `espConfigId`, only sends through that ESP from the given delivery
 * source count; otherwise every delivery source does.
 */
export async function ledgerCounts(options: {
  now: Date;
  since?: Date;
  teamIds?: string[];
  espConfigId?: string;
  deliverySource?: "organization";
  /** A transaction to read in, instead of the pool. */
  executor?: Pick<typeof db, "select">;
}): Promise<LedgerCounts[]> {
  const { now } = options;
  const windowStart = new Date(now.getTime() - WINDOW_MS);
  const since =
    options.since && options.since > windowStart ? options.since : windowStart;
  const rows = await (options.executor ?? db)
    .select({
      teamId: outboundMessages.teamId,
      accepted: count(),
      bounced: count(BOUNCED),
      complained: count(COMPLAINED),
    })
    .from(outboundMessages)
    .where(
      and(
        options.teamIds ? inArray(outboundMessages.teamId, options.teamIds) : undefined,
        options.espConfigId
          ? eq(outboundMessages.espConfigId, options.espConfigId)
          : undefined,
        options.deliverySource
          ? eq(outboundMessages.deliverySourceType, options.deliverySource)
          : undefined,
        gte(outboundMessages.acceptedAt, since),
        lt(outboundMessages.acceptedAt, now),
      ),
    )
    .groupBy(outboundMessages.teamId);
  return rows.map((row) => ({
    teamId: row.teamId,
    accepted: Number(row.accepted),
    bounced: Number(row.bounced),
    complained: Number(row.complained),
  }));
}

/**
 * Re-evaluates one team's seven-day reputation window. The state transition is
 * idempotent and row-locked; all-pause is deliberately sticky until an
 * operator releases it. Metrics are based on the deduplicated outbound ledger
 * projection, so retries and duplicate provider events cannot inflate rates.
 */
export async function evaluateTeamReputation(
  teamId: string,
  now = new Date(),
): Promise<void> {
  if (process.env.SENDLIT_DEPLOYMENT_MODE !== "cloud") return;
  const [team] = await db
    .select({ id: teams.id, organizationId: teams.organizationId })
    .from(teams)
    .where(eq(teams.id, teamId))
    .limit(1);
  if (!team) return;
  const entitlements = await getOrganizationEntitlements(team.organizationId, now);
  if (!entitlements.fairUse) return;

  const [metrics = { accepted: 0, bounced: 0, complained: 0 }] = await ledgerCounts({
    now,
    teamIds: [teamId],
  });
  const config = readReputationConfig();
  const evaluateRates = metrics.accepted >= config.minimumAccepted;
  if (!evaluateRates && metrics.complained < config.complaintStopAbsolute) return;
  const desired = reputationDecision(metrics, config, evaluateRates);

  await db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(teamSendingControls)
      .where(eq(teamSendingControls.teamId, teamId))
      .limit(1)
      .for("update");
    const control =
      existing ??
      (
        await tx
          .insert(teamSendingControls)
          .values({ teamId, status: "normal" })
          .returning()
      )[0];
    if (!control) throw new Error("sending_control_unavailable");
    if (control.status === "all_paused") return;

    // Recovery streaks advance at most once per UTC day. Any breach resets
    // the streak immediately, and a marketing pause cannot recover before
    // its minimum hold has elapsed (72 hours plus seven clean days).
    const transition = advanceControlState(
      {
        status: control.status as SendingControlStatus,
        reasonCode: control.reasonCode,
        evaluatedAt: control.evaluatedAt,
        cleanEvaluationDays: control.cleanEvaluationDays,
        minimumHoldUntil: control.minimumHoldUntil,
      },
      desired,
      now,
      {
        minimumHoldHours: config.minimumHoldHours,
        recoveryCleanDays: config.recoveryCleanDays,
        recoveredReason: "reputation_recovered",
        heldReason: "reputation_pause",
      },
    );
    const {
      alreadyEvaluatedToday,
      status: nextStatus,
      reason,
      minimumHoldUntil,
      cleanEvaluationDays: cleanDays,
    } = transition;

    if (nextStatus !== control.status || !alreadyEvaluatedToday) {
      const enteredAt = nextStatus !== control.status ? now : control.enteredAt;
      await tx
        .update(teamSendingControls)
        .set({
          status: nextStatus,
          reasonCode: reason,
          source: "automatic",
          enteredAt,
          evaluatedAt: now,
          minimumHoldUntil,
          cleanEvaluationDays: cleanDays,
          updatedAt: now,
        })
        .where(eq(teamSendingControls.id, control.id));
      if (nextStatus !== control.status) {
        await tx.insert(organizationAuditEvents).values({
          organizationId: team.organizationId,
          teamId,
          actorType: "system",
          action: `reputation_${nextStatus}`,
          metadata: {
            reason,
            accepted: metrics.accepted,
            bounced: metrics.bounced,
            complained: metrics.complained,
          },
        });
        void notifyReputationChange({
          organizationId: team.organizationId,
          teamId,
          status: nextStatus,
          reason,
        }).catch(() => undefined);
      }
    }
  });
}

/** Hourly sweep; event processing also calls the single-team evaluator. */
export async function evaluateAllTeamReputations(now = new Date()): Promise<void> {
  if (process.env.SENDLIT_DEPLOYMENT_MODE !== "cloud") return;
  const rows = await db
    .select({ id: teams.id })
    .from(teams)
    .innerJoin(
      billingPlanStates,
      eq(billingPlanStates.billableEntityId, teams.organizationId),
    )
    .where(sql`${teams.status} IN ('active', 'sending_suspended')`);
  for (const row of rows) {
    await evaluateTeamReputation(row.id, now).catch(() => {
      logger.warn(
        { billing_reputation_team: row.id },
        "team reputation evaluation failed",
      );
    });
  }
}

/** Audited operator release for a sticky all-pause. It starts at warned so a
 * subsequent clean streak is observable; payment entitlements remain the
 * independent final authority and are never changed by this operation. */
export async function applyTeamSendingControl(
  teamId: string,
  status: SendingControlStatus,
  operatorUserId: string,
  operatorReason: string,
): Promise<boolean> {
  const reason = operatorReason.trim();
  if (!reason || reason.length > 500) throw new Error("operator_reason_invalid");
  if (status === "normal") {
    throw new Error("operator_must_release_all_pause");
  }
  return db.transaction(async (tx) => {
    const [team] = await tx
      .select({ organizationId: teams.organizationId })
      .from(teams)
      .where(eq(teams.id, teamId))
      .limit(1)
      .for("update");
    if (!team) return false;
    const [existing] = await tx
      .select()
      .from(teamSendingControls)
      .where(eq(teamSendingControls.teamId, teamId))
      .limit(1)
      .for("update");
    const now = new Date();
    if (existing) {
      await tx
        .update(teamSendingControls)
        .set({
          status,
          source: "operator",
          operatorUserId,
          operatorReason: reason,
          overriddenAt: now,
          enteredAt: now,
          evaluatedAt: now,
          cleanEvaluationDays: 0,
          updatedAt: now,
        })
        .where(eq(teamSendingControls.id, existing.id));
    } else {
      await tx.insert(teamSendingControls).values({
        teamId,
        status,
        source: "operator",
        operatorUserId,
        operatorReason: reason,
        overriddenAt: now,
      });
    }
    await tx.insert(organizationAuditEvents).values({
      organizationId: team.organizationId,
      teamId,
      actorType: "user",
      actorId: operatorUserId,
      action: "reputation_operator_apply",
      metadata: { reason, status },
    });
    return true;
  });
}

export async function releaseTeamSendingControl(
  teamId: string,
  operatorUserId: string,
  operatorReason: string,
): Promise<boolean> {
  const reason = operatorReason.trim();
  if (!reason || reason.length > 500) throw new Error("operator_reason_invalid");
  return db.transaction(async (tx) => {
    const [team] = await tx
      .select({ organizationId: teams.organizationId })
      .from(teams)
      .where(eq(teams.id, teamId))
      .limit(1)
      .for("update");
    if (!team) return false;
    const [control] = await tx
      .select()
      .from(teamSendingControls)
      .where(eq(teamSendingControls.teamId, teamId))
      .limit(1)
      .for("update");
    if (control?.status !== "all_paused") return false;
    const now = new Date();
    await tx
      .update(teamSendingControls)
      .set({
        status: "warned",
        source: "operator",
        operatorUserId,
        operatorReason: reason,
        overriddenAt: now,
        enteredAt: now,
        evaluatedAt: now,
        cleanEvaluationDays: 0,
        updatedAt: now,
      })
      .where(eq(teamSendingControls.id, control.id));
    await tx.insert(organizationAuditEvents).values({
      organizationId: team.organizationId,
      teamId,
      actorType: "user",
      actorId: operatorUserId,
      action: "reputation_operator_release",
      metadata: { reason },
    });
    return true;
  });
}

export async function transactionalUsageToday(
  teamId: string,
  now = new Date(),
): Promise<{ accepted: number; reserved: number }> {
  const start = utcDayStart(now);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  const [[accepted], [reserved]] = await Promise.all([
    db
      .select({ value: count() })
      .from(outboundMessages)
      .where(
        and(
          eq(outboundMessages.teamId, teamId),
          eq(outboundMessages.sourceType, "transactional"),
          gte(outboundMessages.acceptedAt, start),
          lt(outboundMessages.acceptedAt, end),
        ),
      ),
    db
      .select({ value: count() })
      .from(outboundMessages)
      .innerJoin(
        planSendReservations,
        eq(planSendReservations.outboundMessageId, outboundMessages.id),
      )
      .where(
        and(
          eq(outboundMessages.teamId, teamId),
          eq(outboundMessages.sourceType, "transactional"),
          eq(planSendReservations.state, "reserved"),
          gt(planSendReservations.expiresAt, now),
          gte(planSendReservations.updatedAt, start),
          lt(planSendReservations.updatedAt, end),
        ),
      ),
  ]);
  return {
    accepted: Number(accepted?.value ?? 0),
    reserved: Number(reserved?.value ?? 0),
  };
}
