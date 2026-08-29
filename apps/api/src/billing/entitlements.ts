import { and, count, eq, gt, gte, inArray, lt, sql } from "drizzle-orm";
import { db } from "../db/client";
import {
    billingCheckoutAttempts,
    contacts,
    organizationPlanStates,
    organizationSubscriptions,
    organizations,
    outboundMessages,
    planSendReservations,
    planSendUsageBuckets,
    teamSendingControls,
    teams,
} from "../db/schema";
import {
    resolveEntitlements,
    marketingRampDailyLimit,
    type OrganizationEntitlements,
    type PlanStateLike,
    type SubscriptionLike,
} from "./policies";
import { PlanGateError } from "./errors";
import { readReputationConfig } from "./reputation-config";
export { PlanGateError } from "./errors";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

function deploymentMode(): "oss" | "cloud" {
    const mode = process.env.SENDLIT_DEPLOYMENT_MODE;
    if (mode === "cloud") return "cloud";
    if (mode === "oss") return "oss";
    throw new Error("SENDLIT_DEPLOYMENT_MODE_must_be_oss_or_cloud");
}

/** Creates the Free projection row as part of organization creation/backfill. */
export async function ensureOrganizationPlanState(
    tx: Transaction,
    organizationId: string,
) {
    const [existing] = await tx
        .select()
        .from(organizationPlanStates)
        .where(eq(organizationPlanStates.organizationId, organizationId))
        .limit(1)
        .for("update");
    if (existing) return existing;
    const [created] = await tx
        .insert(organizationPlanStates)
        .values({ organizationId, plan: "free" })
        .onConflictDoNothing({ target: organizationPlanStates.organizationId })
        .returning();
    if (created) return created;
    const [raced] = await tx
        .select()
        .from(organizationPlanStates)
        .where(eq(organizationPlanStates.organizationId, organizationId))
        .limit(1)
        .for("update");
    if (!raced) throw new Error("organization_plan_state_unavailable");
    return raced;
}

export async function getOrganizationEntitlements(
    organizationId: string,
    now = new Date(),
): Promise<OrganizationEntitlements> {
    const [state] = await db
        .select()
        .from(organizationPlanStates)
        .where(eq(organizationPlanStates.organizationId, organizationId))
        .limit(1);

    let subscription: SubscriptionLike | null = null;
    if (state?.activeSubscriptionId) {
        const [row] = await db
            .select()
            .from(organizationSubscriptions)
            .where(eq(organizationSubscriptions.id, state.activeSubscriptionId))
            .limit(1);
        subscription = row
            ? {
                  plan: row.plan as "pro" | "business",
                  billingInterval: row.billingInterval as "month" | "year",
                  status: row.status as SubscriptionLike["status"],
                  currentPeriodEndsAt: row.currentPeriodEndsAt,
                  paidThroughAt: row.paidThroughAt,
                  trialEndsAt: row.trialEndsAt,
                  graceEndsAt: row.graceEndsAt,
                  cancelAtPeriodEnd: row.cancelAtPeriodEnd,
              }
            : null;
    }

    const [pending] = await db
        .select({ id: billingCheckoutAttempts.id })
        .from(billingCheckoutAttempts)
        .where(
            and(
                eq(billingCheckoutAttempts.organizationId, organizationId),
                inArray(billingCheckoutAttempts.status, ["creating", "open"]),
            ),
        )
        .limit(1);

    return resolveEntitlements({
        organizationId,
        deploymentMode: deploymentMode(),
        planState: (state as PlanStateLike | undefined) ?? null,
        subscription,
        checkoutPending: Boolean(pending),
        now,
    });
}

export async function getOrganizationEntitlementsInTransaction(
    tx: Transaction,
    organizationId: string,
    now = new Date(),
): Promise<OrganizationEntitlements> {
    const state = await ensureOrganizationPlanState(tx, organizationId);
    const [row] = state.activeSubscriptionId
        ? await tx
              .select()
              .from(organizationSubscriptions)
              .where(
                  eq(organizationSubscriptions.id, state.activeSubscriptionId),
              )
              .limit(1)
        : [];
    const [pending] = await tx
        .select({ id: billingCheckoutAttempts.id })
        .from(billingCheckoutAttempts)
        .where(
            and(
                eq(billingCheckoutAttempts.organizationId, organizationId),
                inArray(billingCheckoutAttempts.status, ["creating", "open"]),
            ),
        )
        .limit(1);
    return resolveEntitlements({
        organizationId,
        deploymentMode: deploymentMode(),
        planState: state as PlanStateLike,
        subscription: (row as SubscriptionLike | undefined) ?? null,
        checkoutPending: Boolean(pending),
        now,
    });
}

export async function reserveTeamSlot(
    tx: Transaction,
    organizationId: string,
): Promise<OrganizationEntitlements> {
    const [organization] = await tx
        .select({ status: organizations.status })
        .from(organizations)
        .where(eq(organizations.id, organizationId))
        .limit(1);
    if (!organization || organization.status !== "active") {
        throw new PlanGateError("payment_required", {
            reason: "organization_not_active",
            organizationId,
        });
    }
    const entitlements = await getOrganizationEntitlementsInTransaction(
        tx,
        organizationId,
    );
    if (entitlements.teamsLimit === null) return entitlements;
    const [{ value }] = await tx
        .select({ value: count() })
        .from(teams)
        .where(
            and(
                eq(teams.organizationId, organizationId),
                inArray(teams.status, ["active", "sending_suspended"]),
            ),
        );
    const usage = Number(value);
    if (usage >= entitlements.teamsLimit) {
        throw new PlanGateError("plan_limit_reached", {
            organizationId,
            capability: "teams",
            limit: entitlements.teamsLimit,
            usage,
            plan: entitlements.plan,
            requiredPlan: entitlements.plan === "free" ? "pro" : "business",
        });
    }
    return entitlements;
}

export async function reserveSubscribedContactSlot(
    tx: Transaction,
    organizationId: string,
    teamId: string,
): Promise<OrganizationEntitlements> {
    const [team] = await tx
        .select({ id: teams.id })
        .from(teams)
        .where(
            and(eq(teams.id, teamId), eq(teams.organizationId, organizationId)),
        )
        .limit(1);
    if (!team) throw new Error("team_organization_mismatch");
    const entitlements = await getOrganizationEntitlementsInTransaction(
        tx,
        organizationId,
    );
    if (entitlements.subscribedContactsLimit === null) return entitlements;
    const [{ value }] = await tx
        .select({ value: count() })
        .from(contacts)
        .innerJoin(teams, eq(teams.id, contacts.teamId))
        .where(
            and(
                eq(teams.organizationId, organizationId),
                eq(contacts.subscribed, true),
            ),
        );
    const usage = Number(value);
    if (usage >= entitlements.subscribedContactsLimit) {
        throw new PlanGateError("plan_limit_reached", {
            organizationId,
            capability: "subscribed_contacts",
            limit: entitlements.subscribedContactsLimit,
            usage,
            plan: entitlements.plan,
            requiredPlan: entitlements.plan === "free" ? "pro" : "business",
        });
    }
    return entitlements;
}

export async function countSubscribedContacts(
    tx: Transaction,
    organizationId: string,
): Promise<number> {
    const [{ value }] = await tx
        .select({ value: count() })
        .from(contacts)
        .innerJoin(teams, eq(teams.id, contacts.teamId))
        .where(
            and(
                eq(teams.organizationId, organizationId),
                eq(contacts.subscribed, true),
            ),
        );
    return Number(value);
}

export async function assertMarketingAllowedForContactUsage(
    tx: Transaction,
    organizationId: string,
    entitlements?: OrganizationEntitlements,
): Promise<void> {
    const snapshot =
        entitlements ??
        (await getOrganizationEntitlementsInTransaction(tx, organizationId));
    if (snapshot.subscribedContactsLimit === null) return;
    const usage = await countSubscribedContacts(tx, organizationId);
    if (usage > snapshot.subscribedContactsLimit) {
        throw new PlanGateError("plan_limit_reached", {
            organizationId,
            capability: "subscribed_contacts",
            limit: snapshot.subscribedContactsLimit,
            usage,
            plan: snapshot.plan,
            requiredPlan: snapshot.plan === "free" ? "pro" : "business",
        });
    }
}

export function assertCapability(
    entitlements: OrganizationEntitlements,
    capability:
        | "shared_organization_mailbox"
        | "provisioning"
        | "organization_api_keys",
): void {
    const enabled =
        capability === "shared_organization_mailbox"
            ? entitlements.sharedOrganizationMailbox
            : capability === "provisioning"
              ? entitlements.provisioning
              : entitlements.organizationApiKeys;
    if (!enabled) {
        throw new PlanGateError("plan_feature_unavailable", {
            organizationId: entitlements.organizationId,
            capability,
            plan: entitlements.plan,
        });
    }
}

async function advanceMarketingRamp(
    tx: Transaction,
    state: {
        id: string;
        rampStage: number;
        rampCleanStageDays: number;
        rampEvaluatedAt: Date | null;
    },
    organizationId: string,
    now: Date,
): Promise<number> {
    const day = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
    );
    const evaluatedDay = state.rampEvaluatedAt
        ? new Date(
              Date.UTC(
                  state.rampEvaluatedAt.getUTCFullYear(),
                  state.rampEvaluatedAt.getUTCMonth(),
                  state.rampEvaluatedAt.getUTCDate(),
              ),
          )
        : null;
    if (evaluatedDay?.getTime() === day.getTime()) return state.rampStage;
    const [breach] = await tx
        .select({ id: teamSendingControls.id })
        .from(teamSendingControls)
        .innerJoin(teams, eq(teams.id, teamSendingControls.teamId))
        .where(
            and(
                eq(teams.organizationId, organizationId),
                sql`${teamSendingControls.status} <> 'normal'`,
            ),
        )
        .limit(1);
    let stage = state.rampStage;
    let cleanDays = breach ? 0 : state.rampCleanStageDays + 1;
    const requiredDays = stage === 0 ? 3 : stage === 1 ? 4 : 7;
    if (!breach && stage < 3 && cleanDays >= requiredDays) {
        stage += 1;
        cleanDays = 0;
    }
    await tx
        .update(organizationPlanStates)
        .set({
            rampStage: stage,
            rampCleanStageDays: cleanDays,
            rampEvaluatedAt: now,
            updatedAt: now,
        })
        .where(eq(organizationPlanStates.id, state.id));
    return stage;
}

/** Atomically reserve plan-governed sends.  The reservation is keyed by the
 * outbound identity, so retries and concurrent queueing cannot double count. */
export async function reserveSend(
    tx: Transaction,
    input: {
        organizationId: string;
        outboundMessageId: string;
        purpose: "marketing" | "transactional";
        amount?: number;
    },
): Promise<void> {
    const amount = input.amount ?? 1;
    if (!Number.isSafeInteger(amount) || amount <= 0) {
        throw new Error("send_reservation_amount_invalid");
    }
    const [outbound] = await tx
        .select({ teamId: outboundMessages.teamId })
        .from(outboundMessages)
        .where(eq(outboundMessages.id, input.outboundMessageId))
        .limit(1)
        .for("update");
    const reservationNow = new Date();
    const [existing] = await tx
        .select()
        .from(planSendReservations)
        .where(
            eq(planSendReservations.outboundMessageId, input.outboundMessageId),
        )
        .limit(1)
        .for("update");
    if (existing?.state === "committed") return;
    if (existing?.state === "reserved" && existing.expiresAt > reservationNow)
        return;
    const entitlements = await getOrganizationEntitlementsInTransaction(
        tx,
        input.organizationId,
    );
    if (!entitlements.canSend) {
        throw new PlanGateError("sending_paused", {
            organizationId: entitlements.organizationId,
            plan: entitlements.plan,
            graceEndsAt: entitlements.graceEndsAt?.toISOString() ?? null,
        });
    }
    if (input.purpose === "marketing") {
        await assertMarketingAllowedForContactUsage(
            tx,
            input.organizationId,
            entitlements,
        );
    }
    let controlStatus: string | null = null;
    if (entitlements.fairUse && outbound) {
        // Lock the team row so concurrent reservations cannot both consume the
        // degraded transactional allowance after observing the same count.
        await tx
            .select({ id: teams.id })
            .from(teams)
            .where(eq(teams.id, outbound.teamId))
            .limit(1)
            .for("update");
        const [control] = await tx
            .select({ status: teamSendingControls.status })
            .from(teamSendingControls)
            .where(eq(teamSendingControls.teamId, outbound.teamId))
            .limit(1)
            .for("update");
        controlStatus = control?.status ?? null;
        if (
            controlStatus === "all_paused" ||
            (input.purpose === "marketing" &&
                controlStatus === "marketing_paused")
        ) {
            throw new PlanGateError("sending_paused", {
                organizationId: entitlements.organizationId,
                reason: controlStatus,
                plan: entitlements.plan,
            });
        }
        if (
            input.purpose === "transactional" &&
            controlStatus === "marketing_paused"
        ) {
            const now = new Date();
            const dayStart = new Date(
                Date.UTC(
                    now.getUTCFullYear(),
                    now.getUTCMonth(),
                    now.getUTCDate(),
                ),
            );
            const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
            const [[accepted], [reserved]] = await Promise.all([
                tx
                    .select({ value: count() })
                    .from(outboundMessages)
                    .where(
                        and(
                            eq(outboundMessages.teamId, outbound.teamId),
                            eq(outboundMessages.sourceType, "transactional"),
                            gte(outboundMessages.acceptedAt, dayStart),
                            lt(outboundMessages.acceptedAt, dayEnd),
                        ),
                    ),
                tx
                    .select({ value: count() })
                    .from(outboundMessages)
                    .innerJoin(
                        planSendReservations,
                        eq(
                            planSendReservations.outboundMessageId,
                            outboundMessages.id,
                        ),
                    )
                    .where(
                        and(
                            eq(outboundMessages.teamId, outbound.teamId),
                            eq(outboundMessages.sourceType, "transactional"),
                            eq(planSendReservations.state, "reserved"),
                            gt(planSendReservations.expiresAt, now),
                            gte(planSendReservations.updatedAt, dayStart),
                            lt(planSendReservations.updatedAt, dayEnd),
                        ),
                    ),
            ]);
            const usage =
                Number(accepted?.value ?? 0) + Number(reserved?.value ?? 0);
            const limit = readReputationConfig().transactionalDailyLimit;
            if (usage >= limit) {
                throw new PlanGateError("plan_limit_reached", {
                    organizationId: entitlements.organizationId,
                    capability: "transactional_degraded_daily",
                    limit,
                    usage,
                    plan: entitlements.plan,
                    requiredPlan: entitlements.plan,
                });
            }
        }
    }
    if (entitlements.fairUse && input.purpose === "marketing") {
        const [rampState] = await tx
            .select({
                id: organizationPlanStates.id,
                rampStage: organizationPlanStates.rampStage,
                rampCleanStageDays: organizationPlanStates.rampCleanStageDays,
                rampEvaluatedAt: organizationPlanStates.rampEvaluatedAt,
            })
            .from(organizationPlanStates)
            .where(
                eq(organizationPlanStates.organizationId, input.organizationId),
            )
            .limit(1)
            .for("update");
        const stage = rampState
            ? await advanceMarketingRamp(
                  tx,
                  rampState,
                  input.organizationId,
                  new Date(),
              )
            : 0;
        const dailyLimit = marketingRampDailyLimit(stage);
        if (dailyLimit !== null) {
            const now = new Date();
            const dayStart = new Date(
                Date.UTC(
                    now.getUTCFullYear(),
                    now.getUTCMonth(),
                    now.getUTCDate(),
                ),
            );
            const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
            const [[accepted], [reserved]] = await Promise.all([
                tx
                    .select({ value: count() })
                    .from(outboundMessages)
                    .innerJoin(teams, eq(teams.id, outboundMessages.teamId))
                    .where(
                        and(
                            eq(teams.organizationId, input.organizationId),
                            eq(outboundMessages.sourceType, "campaign"),
                            gte(outboundMessages.acceptedAt, dayStart),
                            lt(outboundMessages.acceptedAt, dayEnd),
                        ),
                    ),
                tx
                    .select({ value: count() })
                    .from(outboundMessages)
                    .innerJoin(teams, eq(teams.id, outboundMessages.teamId))
                    .innerJoin(
                        planSendReservations,
                        eq(
                            planSendReservations.outboundMessageId,
                            outboundMessages.id,
                        ),
                    )
                    .where(
                        and(
                            eq(teams.organizationId, input.organizationId),
                            eq(outboundMessages.sourceType, "campaign"),
                            eq(planSendReservations.state, "reserved"),
                            gt(planSendReservations.expiresAt, now),
                            gte(planSendReservations.updatedAt, dayStart),
                            lt(planSendReservations.updatedAt, dayEnd),
                        ),
                    ),
            ]);
            const usage =
                Number(accepted?.value ?? 0) + Number(reserved?.value ?? 0);
            if (usage + amount > dailyLimit) {
                throw new PlanGateError("plan_limit_reached", {
                    organizationId: entitlements.organizationId,
                    capability: "marketing_daily_ramp",
                    limit: dailyLimit,
                    usage,
                    plan: entitlements.plan,
                    requiredPlan: entitlements.plan,
                });
            }
        }
    }
    // Expired live reservations are released after the outbound/reservation
    // and plan-state locks, and before a replacement bucket lock, so retries
    // cannot invert send lock order against settlement.
    if (existing?.state === "reserved") {
        const [oldBucket] = await tx
            .select()
            .from(planSendUsageBuckets)
            .where(eq(planSendUsageBuckets.id, existing.bucketId))
            .limit(1)
            .for("update");
        if (!oldBucket) throw new Error("send_usage_bucket_unavailable");
        await tx
            .update(planSendUsageBuckets)
            .set({
                reserved: Math.max(0, oldBucket.reserved - existing.amount),
                updatedAt: reservationNow,
            })
            .where(eq(planSendUsageBuckets.id, oldBucket.id));
        await tx
            .update(planSendReservations)
            .set({
                state: "released",
                releasedAt: reservationNow,
                updatedAt: reservationNow,
            })
            .where(eq(planSendReservations.id, existing.id));
    }
    // OSS has no cloud usage accounting. Paid fair-use plans retain a
    // reservation even without a monthly cap so degraded transactional sends
    // remain atomic and retries stay idempotent.
    if (entitlements.monthlySendsLimit === null && !entitlements.fairUse)
        return;
    const now = reservationNow;
    const bucketMonth = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
    );
    const [createdBucket] = await tx
        .insert(planSendUsageBuckets)
        .values({ organizationId: input.organizationId, bucketMonth })
        .onConflictDoNothing()
        .returning();
    const bucket =
        createdBucket ??
        (
            await tx
                .select()
                .from(planSendUsageBuckets)
                .where(
                    and(
                        eq(
                            planSendUsageBuckets.organizationId,
                            input.organizationId,
                        ),
                        eq(planSendUsageBuckets.bucketMonth, bucketMonth),
                    ),
                )
                .limit(1)
                .for("update")
        )[0];
    if (!bucket) throw new Error("send_usage_bucket_unavailable");
    // Retries reuse the durable outbound identity. Re-open a released or
    // expired reservation inside this transaction so a retry cannot bypass
    // the monthly quota by observing an old row and returning early.
    if (existing) {
        await tx
            .update(planSendReservations)
            .set({
                bucketId: bucket.id,
                amount,
                state: "reserved",
                expiresAt: new Date(now.getTime() + 60 * 60 * 1000),
                releasedAt: null,
                committedAt: null,
                updatedAt: now,
            })
            .where(eq(planSendReservations.id, existing.id));
    } else {
        await tx.insert(planSendReservations).values({
            organizationId: input.organizationId,
            outboundMessageId: input.outboundMessageId,
            bucketId: bucket.id,
            amount,
            state: "reserved",
            expiresAt: new Date(now.getTime() + 60 * 60 * 1000),
        });
    }
    if (
        entitlements.monthlySendsLimit !== null &&
        bucket.committed + bucket.reserved + amount >
            entitlements.monthlySendsLimit
    ) {
        throw new PlanGateError("plan_limit_reached", {
            organizationId: entitlements.organizationId,
            capability: "monthly_sends",
            limit: entitlements.monthlySendsLimit,
            usage: bucket.committed + bucket.reserved,
            plan: entitlements.plan,
            requiredPlan: "pro",
        });
    }
    await tx
        .update(planSendUsageBuckets)
        .set({
            reserved: sql`${planSendUsageBuckets.reserved} + ${amount}`,
            updatedAt: new Date(),
        })
        .where(eq(planSendUsageBuckets.id, bucket.id));
}

/** Final transport-boundary check; queued work must not bypass a later
 * payment or reputation stop. */
export async function assertSendAllowedForTeam(
    teamId: string,
    purpose: "marketing" | "transactional",
): Promise<void> {
    const [team] = await db
        .select({ organizationId: teams.organizationId })
        .from(teams)
        .where(eq(teams.id, teamId))
        .limit(1);
    if (!team) throw new Error("team_not_found");
    const entitlements = await getOrganizationEntitlements(team.organizationId);
    if (!entitlements.canSend) {
        throw new PlanGateError("sending_paused", {
            organizationId: entitlements.organizationId,
            plan: entitlements.plan,
            graceEndsAt: entitlements.graceEndsAt?.toISOString() ?? null,
        });
    }
    if (purpose === "marketing") {
        await db.transaction(async (tx) => {
            await assertMarketingAllowedForContactUsage(
                tx,
                team.organizationId,
                entitlements,
            );
        });
    }
    const [control] = await db
        .select({ status: teamSendingControls.status })
        .from(teamSendingControls)
        .where(eq(teamSendingControls.teamId, teamId))
        .limit(1);
    if (
        control?.status === "all_paused" ||
        (purpose === "marketing" && control?.status === "marketing_paused")
    ) {
        throw new PlanGateError("sending_paused", {
            organizationId: entitlements.organizationId,
            reason: control.status,
            plan: entitlements.plan,
        });
    }
    if (purpose === "transactional" && control?.status === "marketing_paused") {
        const now = new Date();
        const dayStart = new Date(
            Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
        );
        const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
        const [[accepted], [reserved]] = await Promise.all([
            db
                .select({ value: count() })
                .from(outboundMessages)
                .where(
                    and(
                        eq(outboundMessages.teamId, teamId),
                        eq(outboundMessages.sourceType, "transactional"),
                        gte(outboundMessages.acceptedAt, dayStart),
                        lt(outboundMessages.acceptedAt, dayEnd),
                    ),
                ),
            db
                .select({ value: count() })
                .from(outboundMessages)
                .innerJoin(
                    planSendReservations,
                    eq(
                        planSendReservations.outboundMessageId,
                        outboundMessages.id,
                    ),
                )
                .where(
                    and(
                        eq(outboundMessages.teamId, teamId),
                        eq(outboundMessages.sourceType, "transactional"),
                        eq(planSendReservations.state, "reserved"),
                        gt(planSendReservations.expiresAt, now),
                        gte(planSendReservations.updatedAt, dayStart),
                        lt(planSendReservations.updatedAt, dayEnd),
                    ),
                ),
        ]);
        const usage =
            Number(accepted?.value ?? 0) + Number(reserved?.value ?? 0);
        const limit = readReputationConfig().transactionalDailyLimit;
        if (usage >= limit) {
            throw new PlanGateError("plan_limit_reached", {
                organizationId: entitlements.organizationId,
                capability: "transactional_degraded_daily",
                limit,
                usage,
                plan: entitlements.plan,
                requiredPlan: entitlements.plan,
            });
        }
    }
}

export async function commitSendReservation(
    outboundMessageId: string,
): Promise<void> {
    await db.transaction(async (tx) => {
        const [reservation] = await tx
            .select()
            .from(planSendReservations)
            .where(
                eq(planSendReservations.outboundMessageId, outboundMessageId),
            )
            .limit(1)
            .for("update");
        if (!reservation || reservation.state !== "reserved") return;
        const [bucket] = await tx
            .select()
            .from(planSendUsageBuckets)
            .where(eq(planSendUsageBuckets.id, reservation.bucketId))
            .limit(1)
            .for("update");
        if (!bucket) throw new Error("send_usage_bucket_unavailable");
        await tx
            .update(planSendReservations)
            .set({
                state: "committed",
                committedAt: new Date(),
                updatedAt: new Date(),
            })
            .where(eq(planSendReservations.id, reservation.id));
        await tx
            .update(planSendUsageBuckets)
            .set({
                reserved: Math.max(0, bucket.reserved - reservation.amount),
                committed: bucket.committed + reservation.amount,
                updatedAt: new Date(),
            })
            .where(eq(planSendUsageBuckets.id, bucket.id));
    });
}

export async function releaseSendReservation(
    outboundMessageId: string,
): Promise<void> {
    await db.transaction(async (tx) => {
        const [reservation] = await tx
            .select()
            .from(planSendReservations)
            .where(
                eq(planSendReservations.outboundMessageId, outboundMessageId),
            )
            .limit(1)
            .for("update");
        if (!reservation || reservation.state !== "reserved") return;
        const [bucket] = await tx
            .select()
            .from(planSendUsageBuckets)
            .where(eq(planSendUsageBuckets.id, reservation.bucketId))
            .limit(1)
            .for("update");
        if (!bucket) throw new Error("send_usage_bucket_unavailable");
        await tx
            .update(planSendReservations)
            .set({
                state: "released",
                releasedAt: new Date(),
                updatedAt: new Date(),
            })
            .where(eq(planSendReservations.id, reservation.id));
        await tx
            .update(planSendUsageBuckets)
            .set({
                reserved: Math.max(0, bucket.reserved - reservation.amount),
                updatedAt: new Date(),
            })
            .where(eq(planSendUsageBuckets.id, bucket.id));
    });
}

/** Reconcile an expired reservation after a worker crash. An outbound row
 * already recorded as accepted must consume quota; otherwise the abandoned
 * reservation is released. The outbound and reservation are locked together
 * so an acceptance update cannot race the decision. */
export async function settleExpiredSendReservation(
    outboundMessageId: string,
    now = new Date(),
): Promise<void> {
    await db.transaction(async (tx) => {
        const [outbound] = await tx
            .select({ deliveryStatus: outboundMessages.deliveryStatus })
            .from(outboundMessages)
            .where(eq(outboundMessages.id, outboundMessageId))
            .limit(1)
            .for("update");
        const [reservation] = await tx
            .select()
            .from(planSendReservations)
            .where(
                eq(planSendReservations.outboundMessageId, outboundMessageId),
            )
            .limit(1)
            .for("update");
        if (
            !reservation ||
            reservation.state !== "reserved" ||
            reservation.expiresAt > now
        ) {
            return;
        }
        const [bucket] = await tx
            .select()
            .from(planSendUsageBuckets)
            .where(eq(planSendUsageBuckets.id, reservation.bucketId))
            .limit(1)
            .for("update");
        if (!bucket) throw new Error("send_usage_bucket_unavailable");
        const accepted = outbound?.deliveryStatus === "accepted";
        await tx
            .update(planSendReservations)
            .set(
                accepted
                    ? {
                          state: "committed",
                          committedAt: now,
                          updatedAt: now,
                      }
                    : {
                          state: "released",
                          releasedAt: now,
                          updatedAt: now,
                      },
            )
            .where(eq(planSendReservations.id, reservation.id));
        await tx
            .update(planSendUsageBuckets)
            .set({
                reserved: Math.max(0, bucket.reserved - reservation.amount),
                committed: accepted
                    ? bucket.committed + reservation.amount
                    : bucket.committed,
                updatedAt: now,
            })
            .where(eq(planSendUsageBuckets.id, bucket.id));
    });
}
