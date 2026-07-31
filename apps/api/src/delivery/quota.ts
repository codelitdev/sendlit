import { and, eq, or } from "drizzle-orm";
import { db } from "../db/client";
import {
    espConfigTeamGrants,
    organizationDeliveryPolicies,
    organizationEspQuotaReservations,
    organizationEspUsageBuckets,
} from "../db/schema";

type Executor = typeof db | any;

function utcPeriods(now = new Date()) {
    const day = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
    );
    const month = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
    );
    const nextDay = new Date(day);
    nextDay.setUTCDate(nextDay.getUTCDate() + 1);
    const nextMonth = new Date(month);
    nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1);
    return { day, month, nextDay, nextMonth };
}

async function ensureBucket(
    tx: Executor,
    input: {
        scope: "grant" | "organization";
        organizationId: string;
        grantId: string | null;
        periodType: "day" | "month";
        periodStart: Date;
    },
) {
    await tx
        .insert(organizationEspUsageBuckets)
        .values({
            bucketScope: input.scope,
            organizationId: input.organizationId,
            grantId: input.grantId,
            periodType: input.periodType,
            periodStart: input.periodStart,
        })
        .onConflictDoNothing();
    const [bucket] = await tx
        .select()
        .from(organizationEspUsageBuckets)
        .where(
            and(
                eq(
                    organizationEspUsageBuckets.organizationId,
                    input.organizationId,
                ),
                eq(organizationEspUsageBuckets.bucketScope, input.scope),
                eq(organizationEspUsageBuckets.periodType, input.periodType),
                eq(organizationEspUsageBuckets.periodStart, input.periodStart),
                input.grantId
                    ? eq(organizationEspUsageBuckets.grantId, input.grantId)
                    : undefined,
            ),
        )
        .limit(1)
        .for("update");
    if (!bucket) throw new Error("quota_bucket_not_created");
    return bucket;
}

export async function reserveOrganizationQuota(
    tx: Executor,
    input: {
        outboundMessageId: string;
        grantId: string;
    },
) {
    const [context] = await tx
        .select({
            grant: espConfigTeamGrants,
            policy: organizationDeliveryPolicies,
        })
        .from(espConfigTeamGrants)
        .innerJoin(
            organizationDeliveryPolicies,
            eq(
                organizationDeliveryPolicies.organizationId,
                espConfigTeamGrants.organizationId,
            ),
        )
        .where(eq(espConfigTeamGrants.id, input.grantId))
        .limit(1)
        .for("update");
    if (!context || context.grant.status !== "active") {
        throw new Error("organization_delivery_disabled");
    }

    const periods = utcPeriods();
    const specs = [
        {
            scope: "grant" as const,
            grantId: context.grant.id,
            periodType: "day" as const,
            periodStart: periods.day,
            limit: context.grant.dailyLimit,
            error: "organization_team_quota_exhausted",
            resetAt: periods.nextDay,
        },
        {
            scope: "grant" as const,
            grantId: context.grant.id,
            periodType: "month" as const,
            periodStart: periods.month,
            limit: context.grant.monthlyLimit,
            error: "organization_team_quota_exhausted",
            resetAt: periods.nextMonth,
        },
        {
            scope: "organization" as const,
            grantId: null,
            periodType: "day" as const,
            periodStart: periods.day,
            limit: context.policy.aggregateDailyLimit,
            error: "organization_quota_exhausted",
            resetAt: periods.nextDay,
        },
        {
            scope: "organization" as const,
            grantId: null,
            periodType: "month" as const,
            periodStart: periods.month,
            limit: context.policy.aggregateMonthlyLimit,
            error: "organization_quota_exhausted",
            resetAt: periods.nextMonth,
        },
    ];
    const buckets = [];
    for (const spec of specs) {
        const bucket = await ensureBucket(tx, {
            scope: spec.scope,
            organizationId: context.grant.organizationId,
            grantId: spec.grantId,
            periodType: spec.periodType,
            periodStart: spec.periodStart,
        });
        if (
            spec.limit !== null &&
            bucket.acceptedCount + bucket.reservedCount >= spec.limit
        ) {
            const error = new Error(spec.error) as Error & {
                retryAfter?: number;
            };
            error.retryAfter = Math.max(
                1,
                Math.ceil((spec.resetAt.getTime() - Date.now()) / 1000),
            );
            throw error;
        }
        buckets.push(bucket);
    }

    for (const bucket of buckets) {
        await tx
            .update(organizationEspUsageBuckets)
            .set({
                reservedCount: bucket.reservedCount + 1,
                updatedAt: new Date(),
            })
            .where(eq(organizationEspUsageBuckets.id, bucket.id));
    }
    const [reservation] = await tx
        .insert(organizationEspQuotaReservations)
        .values({
            outboundMessageId: input.outboundMessageId,
            grantId: context.grant.id,
            organizationId: context.grant.organizationId,
            dayPeriodStart: periods.day,
            monthPeriodStart: periods.month,
        })
        .returning();
    return reservation;
}

export async function reserveOrganizationQuotaForOutbound(input: {
    outboundMessageId: string;
    grantId: string;
}) {
    return db.transaction((tx) => reserveOrganizationQuota(tx, input));
}

async function transitionReservationInTransaction(
    tx: Executor,
    reservationId: string,
    target: "committed" | "released",
    releaseReason?: string,
) {
    const [reservation] = await tx
        .select()
        .from(organizationEspQuotaReservations)
        .where(eq(organizationEspQuotaReservations.id, reservationId))
        .limit(1)
        .for("update");
    if (!reservation || reservation.state !== "reserved") return;
    const buckets = await tx
        .select()
        .from(organizationEspUsageBuckets)
        .where(
            and(
                eq(
                    organizationEspUsageBuckets.organizationId,
                    reservation.organizationId,
                ),
                eq(
                    organizationEspUsageBuckets.periodStart,
                    reservation.dayPeriodStart,
                ),
                or(
                    eq(organizationEspUsageBuckets.bucketScope, "organization"),
                    eq(
                        organizationEspUsageBuckets.grantId,
                        reservation.grantId,
                    ),
                ),
            ),
        )
        .for("update");
    const monthBuckets = await tx
        .select()
        .from(organizationEspUsageBuckets)
        .where(
            and(
                eq(
                    organizationEspUsageBuckets.organizationId,
                    reservation.organizationId,
                ),
                eq(
                    organizationEspUsageBuckets.periodStart,
                    reservation.monthPeriodStart,
                ),
                or(
                    eq(organizationEspUsageBuckets.bucketScope, "organization"),
                    eq(
                        organizationEspUsageBuckets.grantId,
                        reservation.grantId,
                    ),
                ),
            ),
        )
        .for("update");
    for (const bucket of [...buckets, ...monthBuckets]) {
        await tx
            .update(organizationEspUsageBuckets)
            .set({
                reservedCount: Math.max(0, bucket.reservedCount - 1),
                acceptedCount:
                    target === "committed"
                        ? bucket.acceptedCount + 1
                        : bucket.acceptedCount,
                updatedAt: new Date(),
            })
            .where(eq(organizationEspUsageBuckets.id, bucket.id));
    }
    await tx
        .update(organizationEspQuotaReservations)
        .set({
            state: target,
            releaseReason:
                target === "released" ? (releaseReason ?? "cancelled") : null,
            committedAt: target === "committed" ? new Date() : null,
            releasedAt: target === "released" ? new Date() : null,
        })
        .where(eq(organizationEspQuotaReservations.id, reservation.id));
}

async function transitionReservation(
    reservationId: string,
    target: "committed" | "released",
    releaseReason?: string,
) {
    await db.transaction((tx) =>
        transitionReservationInTransaction(
            tx,
            reservationId,
            target,
            releaseReason,
        ),
    );
}

export async function commitQuotaForOutbound(outboundMessageId: string) {
    const [row] = await db
        .select({ id: organizationEspQuotaReservations.id })
        .from(organizationEspQuotaReservations)
        .where(
            eq(
                organizationEspQuotaReservations.outboundMessageId,
                outboundMessageId,
            ),
        )
        .limit(1);
    if (row) await transitionReservation(row.id, "committed");
}

export async function releaseQuotaForOutbound(
    outboundMessageId: string,
    reason: string,
) {
    const [row] = await db
        .select({ id: organizationEspQuotaReservations.id })
        .from(organizationEspQuotaReservations)
        .where(
            eq(
                organizationEspQuotaReservations.outboundMessageId,
                outboundMessageId,
            ),
        )
        .limit(1);
    if (row) await transitionReservation(row.id, "released", reason);
}

/** Used by explicit cancel/deprovision transitions. All reserved rows are
 * released inside one database transaction; accepted usage is never refunded. */
export async function releaseReservedQuotaForGrant(
    grantId: string,
    reason: string,
): Promise<void> {
    await db.transaction(async (tx) => {
        await releaseReservedQuotaForGrantInTransaction(tx, grantId, reason);
    });
}

/** Used when the grant state change and quota cleanup must commit together. */
export async function releaseReservedQuotaForGrantInTransaction(
    tx: Executor,
    grantId: string,
    reason: string,
): Promise<void> {
    const reservations = await tx
        .select({ id: organizationEspQuotaReservations.id })
        .from(organizationEspQuotaReservations)
        .where(
            and(
                eq(organizationEspQuotaReservations.grantId, grantId),
                eq(organizationEspQuotaReservations.state, "reserved"),
            ),
        )
        .for("update");
    for (const reservation of reservations) {
        await transitionReservationInTransaction(
            tx,
            reservation.id,
            "released",
            reason,
        );
    }
}

export async function getTeamQuotaUsage(teamId: string) {
    const [grant] = await db
        .select()
        .from(espConfigTeamGrants)
        .where(
            and(
                eq(espConfigTeamGrants.teamId, teamId),
                eq(espConfigTeamGrants.status, "active"),
            ),
        )
        .limit(1);
    if (!grant) throw new Error("organization_delivery_disabled");
    const periods = utcPeriods();
    const buckets = await db
        .select()
        .from(organizationEspUsageBuckets)
        .where(
            and(
                eq(
                    organizationEspUsageBuckets.organizationId,
                    grant.organizationId,
                ),
                eq(organizationEspUsageBuckets.grantId, grant.id),
                or(
                    eq(organizationEspUsageBuckets.periodStart, periods.day),
                    eq(organizationEspUsageBuckets.periodStart, periods.month),
                ),
            ),
        );
    const makeWindow = (
        periodStart: Date,
        limit: number | null,
        resetsAt: Date,
    ) => {
        const bucket = buckets.find(
            (row) => row.periodStart.getTime() === periodStart.getTime(),
        );
        const accepted = bucket?.acceptedCount ?? 0;
        const reserved = bucket?.reservedCount ?? 0;
        return {
            limit,
            accepted,
            reserved,
            remaining:
                limit === null
                    ? null
                    : Math.max(0, limit - accepted - reserved),
            resetsAt,
        };
    };
    return {
        day: makeWindow(periods.day, grant.dailyLimit, periods.nextDay),
        month: makeWindow(periods.month, grant.monthlyLimit, periods.nextMonth),
    };
}

/** Organization-level aggregate usage. Unlike a grant window this remains
 * meaningful when no team currently has an active grant. */
export async function getOrganizationQuotaUsage(organizationId: string) {
    const [policy] = await db
        .select()
        .from(organizationDeliveryPolicies)
        .where(eq(organizationDeliveryPolicies.organizationId, organizationId))
        .limit(1);
    if (!policy) throw new Error("organization_policy_not_found");
    const periods = utcPeriods();
    const buckets = await db
        .select()
        .from(organizationEspUsageBuckets)
        .where(
            and(
                eq(organizationEspUsageBuckets.organizationId, organizationId),
                eq(organizationEspUsageBuckets.bucketScope, "organization"),
                or(
                    eq(organizationEspUsageBuckets.periodStart, periods.day),
                    eq(organizationEspUsageBuckets.periodStart, periods.month),
                ),
            ),
        );
    const makeWindow = (
        periodStart: Date,
        limit: number | null,
        resetsAt: Date,
    ) => {
        const bucket = buckets.find(
            (row) => row.periodStart.getTime() === periodStart.getTime(),
        );
        const accepted = bucket?.acceptedCount ?? 0;
        const reserved = bucket?.reservedCount ?? 0;
        return {
            limit,
            accepted,
            reserved,
            remaining:
                limit === null
                    ? null
                    : Math.max(0, limit - accepted - reserved),
            resetsAt,
        };
    };
    return {
        day: makeWindow(
            periods.day,
            policy.aggregateDailyLimit,
            periods.nextDay,
        ),
        month: makeWindow(
            periods.month,
            policy.aggregateMonthlyLimit,
            periods.nextMonth,
        ),
    };
}
