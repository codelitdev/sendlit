import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
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
  const month = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const nextDay = new Date(day);
  nextDay.setUTCDate(nextDay.getUTCDate() + 1);
  const nextMonth = new Date(month);
  nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1);
  return { day, month, nextDay, nextMonth };
}

type BucketKey = {
  scope: "grant" | "organization";
  grantId: string | null;
  periodType: "day" | "month";
  periodStart: Date;
};

/**
 * The one order every transaction locks a grant's usage buckets in: grant
 * day, grant month, organization day, organization month. Reserving and
 * committing a send both lock several of these rows; taking them in different
 * orders let a request and the mail worker deadlock each other.
 */
function bucketKeysInLockOrder(grantId: string, day: Date, month: Date): BucketKey[] {
  return [
    { scope: "grant", grantId, periodType: "day", periodStart: day },
    { scope: "grant", grantId, periodType: "month", periodStart: month },
    { scope: "organization", grantId: null, periodType: "day", periodStart: day },
    { scope: "organization", grantId: null, periodType: "month", periodStart: month },
  ];
}

/** Matches exactly one bucket. The period type matters: on the 1st of a
 * month the day and month buckets start at the same instant. */
function bucketWhere(organizationId: string, key: BucketKey) {
  return and(
    eq(organizationEspUsageBuckets.organizationId, organizationId),
    eq(organizationEspUsageBuckets.bucketScope, key.scope),
    eq(organizationEspUsageBuckets.periodType, key.periodType),
    eq(organizationEspUsageBuckets.periodStart, key.periodStart),
    key.grantId
      ? eq(organizationEspUsageBuckets.grantId, key.grantId)
      : isNull(organizationEspUsageBuckets.grantId),
  );
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
    .where(bucketWhere(input.organizationId, input))
    .limit(1)
    .for("update");
  if (!bucket) throw new Error("quota_bucket_not_created");
  return bucket;
}

type GrantContext = {
  grant: typeof espConfigTeamGrants.$inferSelect;
  policy: typeof organizationDeliveryPolicies.$inferSelect;
};

/** Locks the grant's and organization's day and month buckets, throwing
 * `organization_team_quota_exhausted` / `organization_quota_exhausted` (with
 * `retryAfter` seconds) unless each has room for `count` more sends. */
async function lockBucketsWithRoom(
  tx: Executor,
  context: GrantContext,
  periods: ReturnType<typeof utcPeriods>,
  count: number,
) {
  const limits = [
    {
      limit: context.grant.dailyLimit,
      error: "organization_team_quota_exhausted",
      resetAt: periods.nextDay,
    },
    {
      limit: context.grant.monthlyLimit,
      error: "organization_team_quota_exhausted",
      resetAt: periods.nextMonth,
    },
    {
      limit: context.policy.aggregateDailyLimit,
      error: "organization_quota_exhausted",
      resetAt: periods.nextDay,
    },
    {
      limit: context.policy.aggregateMonthlyLimit,
      error: "organization_quota_exhausted",
      resetAt: periods.nextMonth,
    },
  ];
  const specs = bucketKeysInLockOrder(context.grant.id, periods.day, periods.month).map(
    (key, index) => ({ ...key, ...limits[index] }),
  );
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
      bucket.acceptedCount + bucket.reservedCount + count > spec.limit
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
  return buckets;
}

async function lockActiveGrant(tx: Executor, grantId: string): Promise<GrantContext> {
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
    .where(eq(espConfigTeamGrants.id, grantId))
    .limit(1)
    .for("update");
  if (context?.grant.status !== "active") {
    throw new Error("organization_delivery_disabled");
  }
  return context;
}

export async function reserveOrganizationQuota(
  tx: Executor,
  input: {
    outboundMessageId: string;
    grantId: string;
  },
) {
  const context = await lockActiveGrant(tx, input.grantId);

  const [existingReservation] = await tx
    .select()
    .from(organizationEspQuotaReservations)
    .where(
      eq(organizationEspQuotaReservations.outboundMessageId, input.outboundMessageId),
    )
    .limit(1)
    .for("update");
  if (
    existingReservation?.state === "reserved" ||
    existingReservation?.state === "committed"
  ) {
    return existingReservation;
  }

  const periods = utcPeriods();
  const buckets = await lockBucketsWithRoom(tx, context, periods, 1);
  for (const bucket of buckets) {
    await tx
      .update(organizationEspUsageBuckets)
      .set({
        reservedCount: bucket.reservedCount + 1,
        updatedAt: new Date(),
      })
      .where(eq(organizationEspUsageBuckets.id, bucket.id));
  }
  const [reservation] = existingReservation
    ? await tx
        .update(organizationEspQuotaReservations)
        .set({
          grantId: context.grant.id,
          organizationId: context.grant.organizationId,
          dayPeriodStart: periods.day,
          monthPeriodStart: periods.month,
          state: "reserved",
          releaseReason: null,
          committedAt: null,
          releasedAt: null,
        })
        .where(eq(organizationEspQuotaReservations.id, existingReservation.id))
        .returning()
    : await tx
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

/** Buckets a test send was charged to, so unsent tests can be refunded. */
export type TestQuotaCharge = { bucketIds: string[] };

/**
 * Counts `count` test sends through a shared mailbox as accepted usage on the
 * grant and organization buckets, the same quota a real send draws on. Tests
 * have no outbound ledger row, so there is no reservation: they are charged
 * up front and `refundOrganizationQuotaForTests` returns any that didn't go.
 */
export async function chargeOrganizationQuotaForTests(input: {
  grantId: string;
  count: number;
}): Promise<TestQuotaCharge> {
  return db.transaction(async (tx) => {
    const context = await lockActiveGrant(tx, input.grantId);
    const buckets = await lockBucketsWithRoom(tx, context, utcPeriods(), input.count);
    for (const bucket of buckets) {
      await tx
        .update(organizationEspUsageBuckets)
        .set({
          acceptedCount: bucket.acceptedCount + input.count,
          updatedAt: new Date(),
        })
        .where(eq(organizationEspUsageBuckets.id, bucket.id));
    }
    return { bucketIds: buckets.map((bucket) => bucket.id) };
  });
}

export async function refundOrganizationQuotaForTests(
  charge: TestQuotaCharge,
  count: number,
): Promise<void> {
  if (count <= 0 || charge.bucketIds.length === 0) return;
  await db
    .update(organizationEspUsageBuckets)
    .set({
      acceptedCount: sql`greatest(${organizationEspUsageBuckets.acceptedCount} - ${count}, 0)`,
      updatedAt: new Date(),
    })
    .where(inArray(organizationEspUsageBuckets.id, charge.bucketIds));
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
  if (reservation?.state !== "reserved") return;
  const buckets = [];
  for (const key of bucketKeysInLockOrder(
    reservation.grantId,
    reservation.dayPeriodStart,
    reservation.monthPeriodStart,
  )) {
    const [bucket] = await tx
      .select()
      .from(organizationEspUsageBuckets)
      .where(bucketWhere(reservation.organizationId, key))
      .limit(1)
      .for("update");
    if (bucket) buckets.push(bucket);
  }
  for (const bucket of buckets) {
    await tx
      .update(organizationEspUsageBuckets)
      .set({
        reservedCount: Math.max(0, bucket.reservedCount - 1),
        acceptedCount:
          target === "committed" ? bucket.acceptedCount + 1 : bucket.acceptedCount,
        updatedAt: new Date(),
      })
      .where(eq(organizationEspUsageBuckets.id, bucket.id));
  }
  await tx
    .update(organizationEspQuotaReservations)
    .set({
      state: target,
      releaseReason: target === "released" ? (releaseReason ?? "cancelled") : null,
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
    transitionReservationInTransaction(tx, reservationId, target, releaseReason),
  );
}

export async function commitQuotaForOutbound(outboundMessageId: string) {
  const [row] = await db
    .select({ id: organizationEspQuotaReservations.id })
    .from(organizationEspQuotaReservations)
    .where(eq(organizationEspQuotaReservations.outboundMessageId, outboundMessageId))
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
    .where(eq(organizationEspQuotaReservations.outboundMessageId, outboundMessageId))
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
    await transitionReservationInTransaction(tx, reservation.id, "released", reason);
  }
}

export type QuotaWindow = {
  limit: number | null;
  accepted: number;
  reserved: number;
  remaining: number | null;
  resetsAt: Date;
};

export type TeamQuotaUsage = { day: QuotaWindow; month: QuotaWindow };

function quotaWindow(
  bucket: { acceptedCount: number; reservedCount: number } | undefined,
  limit: number | null,
  resetsAt: Date,
): QuotaWindow {
  const accepted = bucket?.acceptedCount ?? 0;
  const reserved = bucket?.reservedCount ?? 0;
  return {
    limit,
    accepted,
    reserved,
    remaining: limit === null ? null : Math.max(0, limit - accepted - reserved),
    resetsAt,
  };
}

/** Shared-mailbox quota for several teams (by internal id). Teams without an
 * active grant are left out. */
export async function getTeamsQuotaUsage(
  teamIds: string[],
): Promise<Map<string, TeamQuotaUsage>> {
  const result = new Map<string, TeamQuotaUsage>();
  if (teamIds.length === 0) return result;
  const grants = await db
    .select()
    .from(espConfigTeamGrants)
    .where(
      and(
        inArray(espConfigTeamGrants.teamId, teamIds),
        eq(espConfigTeamGrants.status, "active"),
      ),
    );
  if (grants.length === 0) return result;
  const periods = utcPeriods();
  const buckets = await db
    .select()
    .from(organizationEspUsageBuckets)
    .where(
      and(
        inArray(
          organizationEspUsageBuckets.grantId,
          grants.map((grant) => grant.id),
        ),
        or(
          eq(organizationEspUsageBuckets.periodStart, periods.day),
          eq(organizationEspUsageBuckets.periodStart, periods.month),
        ),
      ),
    );
  // On the 1st the day and month buckets share a start, so match the type.
  const find = (grantId: string, periodType: "day" | "month", start: Date) =>
    buckets.find(
      (row) =>
        row.grantId === grantId &&
        row.periodType === periodType &&
        row.periodStart.getTime() === start.getTime(),
    );
  for (const grant of grants) {
    result.set(grant.teamId, {
      day: quotaWindow(
        find(grant.id, "day", periods.day),
        grant.dailyLimit,
        periods.nextDay,
      ),
      month: quotaWindow(
        find(grant.id, "month", periods.month),
        grant.monthlyLimit,
        periods.nextMonth,
      ),
    });
  }
  return result;
}

export async function getTeamQuotaUsage(teamId: string): Promise<TeamQuotaUsage> {
  const usage = (await getTeamsQuotaUsage([teamId])).get(teamId);
  if (!usage) throw new Error("organization_delivery_disabled");
  return usage;
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
  // On the 1st the day and month buckets share a start, so match the type.
  const makeWindow = (
    periodType: "day" | "month",
    periodStart: Date,
    limit: number | null,
    resetsAt: Date,
  ) =>
    quotaWindow(
      buckets.find(
        (row) =>
          row.periodType === periodType &&
          row.periodStart.getTime() === periodStart.getTime(),
      ),
      limit,
      resetsAt,
    );
  return {
    day: makeWindow("day", periods.day, policy.aggregateDailyLimit, periods.nextDay),
    month: makeWindow(
      "month",
      periods.month,
      policy.aggregateMonthlyLimit,
      periods.nextMonth,
    ),
  };
}
