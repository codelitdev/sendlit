import { and, count, eq, gte, lt, sql, sum } from "drizzle-orm";
import { db } from "../db/client";
import {
    contacts,
    outboundMessages,
    planSendUsageBuckets,
    teams,
} from "../db/schema";

function monthBounds(now = new Date()) {
    const start = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
    );
    const end = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1),
    );
    return { start, end };
}

export async function usageForOrganization(
    organizationId: string,
    now = new Date(),
) {
    const { start, end } = monthBounds(now);
    const [[teamCount], [contactCount], [sendCount], [bucket]] =
        await Promise.all([
            db
                .select({ value: count() })
                .from(teams)
                .where(
                    and(
                        eq(teams.organizationId, organizationId),
                        sql`${teams.status} IN ('active', 'sending_suspended')`,
                    ),
                ),
            db
                .select({ value: count() })
                .from(contacts)
                .innerJoin(teams, eq(teams.id, contacts.teamId))
                .where(
                    and(
                        eq(teams.organizationId, organizationId),
                        eq(contacts.subscribed, true),
                    ),
                ),
            db
                .select({ value: count() })
                .from(outboundMessages)
                .innerJoin(teams, eq(teams.id, outboundMessages.teamId))
                .where(
                    and(
                        eq(teams.organizationId, organizationId),
                        gte(outboundMessages.acceptedAt, start),
                        lt(outboundMessages.acceptedAt, end),
                    ),
                ),
            db
                .select({ reserved: sum(planSendUsageBuckets.reserved) })
                .from(planSendUsageBuckets)
                .where(
                    and(
                        eq(planSendUsageBuckets.organizationId, organizationId),
                        eq(planSendUsageBuckets.bucketMonth, start),
                    ),
                ),
        ]);
    return {
        teams: Number(teamCount?.value ?? 0),
        subscribedContacts: Number(contactCount?.value ?? 0),
        monthlySends: Number(sendCount?.value ?? 0),
        monthlySendsReserved: Number(bucket?.reserved ?? 0),
        bucketStartsAt: start.toISOString(),
        bucketEndsAt: end.toISOString(),
    };
}
