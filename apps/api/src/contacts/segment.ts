import { SQL, and, eq, gt, ilike, lt, not, sql, or } from "drizzle-orm";
import { contacts } from "../db/schema";
import {
    UserFilter,
    userFilterAggregationOperators,
} from "../config/constants";

export interface ContactFilterCondition {
    name: (typeof UserFilter)[keyof typeof UserFilter];
    condition: string;
    value: string;
    valueLabel?: string;
}

export interface ContactFilterWithAggregator {
    aggregator: (typeof userFilterAggregationOperators)[number];
    filters: ContactFilterCondition[];
}

/**
 * Translates a segmentation filter (tag / email / subscription status / signup
 * date) into a Drizzle SQL condition over the `contacts` table. This is the
 * SendLit equivalent of CourseLit's `convertFiltersToDBConditions`, trimmed to
 * the filters that make sense without a course/community platform behind it.
 */
export function buildContactFilterCondition(
    filter: ContactFilterWithAggregator | null | undefined,
): SQL | undefined {
    if (!filter || !filter.filters || filter.filters.length === 0) {
        return undefined;
    }

    const conditions = filter.filters
        .map(toCondition)
        .filter((c): c is SQL => Boolean(c));

    if (conditions.length === 0) return undefined;

    return filter.aggregator === "and" ? and(...conditions) : or(...conditions);
}

function toCondition(filter: ContactFilterCondition): SQL | undefined {
    switch (filter.name) {
        case UserFilter.TAG: {
            const has = sql`${contacts.tags} @> ARRAY[${filter.value}]::text[]`;
            return filter.condition === "is_not" ? not(has) : has;
        }
        case UserFilter.EMAIL:
            return ilike(contacts.email, `%${filter.value}%`);
        case UserFilter.SUBSCRIPTION:
            return eq(
                contacts.subscribedToUpdates,
                filter.value === "subscribed",
            );
        case UserFilter.SIGNED_UP: {
            const date = new Date(Number(filter.value));
            return filter.condition === "before"
                ? lt(contacts.createdAt, date)
                : gt(contacts.createdAt, date);
        }
        default:
            return undefined;
    }
}
