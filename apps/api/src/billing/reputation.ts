import { and, count, eq, gt, gte, lt, sql } from "drizzle-orm";
import { db } from "../db/client";
import logger from "../services/log";
import {
    billingPlanStates,
    organizationAuditEvents,
    outboundMessages,
    planSendReservations,
    teamSendingControls,
    teams,
} from "../db/schema";
import { getOrganizationEntitlements } from "./entitlements";
import { readReputationConfig } from "./reputation-config";
import { notifyReputationChange } from "./notifications";
import {
    reputationDecision,
    type ReputationMetrics,
} from "./reputation-policy";
export { readReputationConfig } from "./reputation-config";

export type SendingControlStatus =
    "normal" | "warned" | "marketing_paused" | "all_paused";

function utcDayStart(now: Date): Date {
    return new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
    );
}

function sameUtcDay(a: Date | null, b: Date): boolean {
    return Boolean(a && utcDayStart(a).getTime() === utcDayStart(b).getTime());
}

async function rollingMetrics(
    teamId: string,
    now: Date,
): Promise<ReputationMetrics> {
    const since = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const [row] = await db
        .select({
            accepted: count(
                sql`CASE WHEN ${outboundMessages.acceptedAt} IS NOT NULL THEN 1 END`,
            ),
            bounced: count(
                sql`CASE WHEN ${outboundMessages.acceptedAt} IS NOT NULL AND ${outboundMessages.deliveryStatus} = 'bounced' THEN 1 END`,
            ),
            complained: count(
                sql`CASE WHEN ${outboundMessages.acceptedAt} IS NOT NULL AND ${outboundMessages.feedbackStatus} = 'complained' THEN 1 END`,
            ),
        })
        .from(outboundMessages)
        .where(
            and(
                eq(outboundMessages.teamId, teamId),
                gte(outboundMessages.acceptedAt, since),
                lt(outboundMessages.acceptedAt, now),
            ),
        );
    return {
        accepted: Number(row?.accepted ?? 0),
        bounced: Number(row?.bounced ?? 0),
        complained: Number(row?.complained ?? 0),
    };
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
    const entitlements = await getOrganizationEntitlements(
        team.organizationId,
        now,
    );
    if (!entitlements.fairUse) return;

    const metrics = await rollingMetrics(teamId, now);
    const config = readReputationConfig();
    const evaluateRates = metrics.accepted >= config.minimumAccepted;
    if (!evaluateRates && metrics.complained < config.complaintStopAbsolute)
        return;
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
        // its minimum hold has elapsed.
        const alreadyEvaluatedToday = sameUtcDay(control.evaluatedAt, now);
        let nextStatus = desired.status;
        let cleanDays = control.cleanEvaluationDays;
        let reason = desired.reason;
        let minimumHoldUntil = control.minimumHoldUntil;
        const rank = (status: SendingControlStatus) =>
            status === "all_paused"
                ? 3
                : status === "marketing_paused"
                  ? 2
                  : status === "warned"
                    ? 1
                    : 0;
        if (
            rank(desired.status) > rank(control.status as SendingControlStatus)
        ) {
            cleanDays = 0;
            if (desired.status === "marketing_paused") {
                minimumHoldUntil = new Date(
                    now.getTime() + config.minimumHoldHours * 60 * 60 * 1000,
                );
            }
        } else if (
            rank(desired.status) < rank(control.status as SendingControlStatus)
        ) {
            // Recovery never skips the current hold. marketing_paused stays
            // paused until 72 hours plus seven clean days; warned needs seven
            // clean days. Weaker samples cannot drop a pause to warned.
            if (
                control.status === "marketing_paused" ||
                control.status === "warned"
            ) {
                if (desired.status === "normal" && !alreadyEvaluatedToday) {
                    cleanDays += 1;
                } else if (desired.status !== "normal") {
                    cleanDays = 0;
                }
                const holdElapsed =
                    !minimumHoldUntil ||
                    minimumHoldUntil.getTime() <= now.getTime();
                if (cleanDays >= config.recoveryCleanDays && holdElapsed) {
                    nextStatus = "normal";
                    reason = "reputation_recovered";
                    minimumHoldUntil = null;
                } else {
                    nextStatus = control.status as SendingControlStatus;
                    reason = control.reasonCode ?? "reputation_pause";
                }
            }
        } else if (
            desired.status === "warned" ||
            desired.status === "marketing_paused"
        ) {
            cleanDays = 0;
        }

        if (nextStatus !== control.status || !alreadyEvaluatedToday) {
            const enteredAt =
                nextStatus !== control.status ? now : control.enteredAt;
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
export async function evaluateAllTeamReputations(
    now = new Date(),
): Promise<void> {
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
    if (!reason || reason.length > 500)
        throw new Error("operator_reason_invalid");
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
    if (!reason || reason.length > 500)
        throw new Error("operator_reason_invalid");
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
        if (!control || control.status !== "all_paused") return false;
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
