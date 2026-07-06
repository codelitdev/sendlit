import { SQL, and, eq, gte, gt, ilike, lt, not, sql, or } from "drizzle-orm";
import { contactCustomFieldValues, contacts } from "../db/schema";
import {
    UserFilter,
    userFilterAggregationOperators,
} from "../config/constants";

export interface ContactFilterCondition {
    name: (typeof UserFilter)[keyof typeof UserFilter] | "customField";
    condition: string;
    value?: string;
    key?: string;
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

    const conditions: SQL[] = [];
    for (const condition of filter.filters) {
        const dbCondition = toCondition(condition);
        if (!dbCondition) {
            return sql`false`;
        }
        conditions.push(dbCondition);
    }

    if (conditions.length === 0) return undefined;

    return filter.aggregator === "and" ? and(...conditions) : or(...conditions);
}

function toCondition(filter: ContactFilterCondition): SQL | undefined {
    switch (filter.name) {
        case UserFilter.TAG: {
            if (!filter.value) return undefined;
            const has = sql`${contacts.tags} @> ARRAY[${filter.value}]::text[]`;
            if (filter.condition === "is") return has;
            if (filter.condition === "is_not") return not(has);
            return undefined;
        }
        case UserFilter.EMAIL: {
            if (!filter.value) return undefined;
            const value = filter.value.toLowerCase().trim();
            if (filter.condition === "is") {
                return eq(contacts.email, value);
            }
            if (
                filter.condition !== "contains" &&
                filter.condition !== "not_contains"
            ) {
                return undefined;
            }
            const contains = ilike(contacts.email, `%${value}%`);
            return filter.condition === "not_contains"
                ? not(contains)
                : contains;
        }
        case UserFilter.SUBSCRIPTION:
            if (!filter.value) return undefined;
            if (
                filter.condition !== "is" ||
                (filter.value !== "subscribed" &&
                    filter.value !== "unsubscribed")
            ) {
                return undefined;
            }
            return eq(contacts.subscribed, filter.value === "subscribed");
        case UserFilter.SIGNED_UP: {
            if (!filter.value) return undefined;
            const date = new Date(Number(filter.value));
            if (!Number.isFinite(date.getTime())) {
                return undefined;
            }
            if (filter.condition === "before") {
                return lt(contacts.createdAt, date);
            }
            if (filter.condition === "on") {
                const nextDate = new Date(date.getTime() + 24 * 60 * 60 * 1000);
                return and(
                    gte(contacts.createdAt, date),
                    lt(contacts.createdAt, nextDate),
                );
            }
            if (filter.condition === "after") {
                return gt(contacts.createdAt, date);
            }
            return undefined;
        }
        case "customField":
            return customFieldCondition(filter);
        default:
            return undefined;
    }
}

function customFieldExists({
    key,
    valueCondition,
}: {
    key: string;
    valueCondition?: SQL;
}): SQL {
    return sql`exists (
        select 1
        from ${contactCustomFieldValues}
        where ${contactCustomFieldValues.teamId} = ${contacts.teamId}
          and ${contactCustomFieldValues.contactId} = ${contacts.id}
          and ${contactCustomFieldValues.key} = ${key}
          ${valueCondition ? sql`and ${valueCondition}` : sql``}
    )`;
}

function customFieldCondition(filter: ContactFilterCondition): SQL | undefined {
    if (!filter.key) return undefined;

    if (filter.condition === "exists") {
        return customFieldExists({ key: filter.key });
    }
    if (filter.condition === "not_exists") {
        return not(customFieldExists({ key: filter.key }));
    }
    if (typeof filter.value !== "string") return undefined;

    if (filter.condition === "is" || filter.condition === "has") {
        return customFieldExists({
            key: filter.key,
            valueCondition: customFieldValueEquals(filter.value),
        });
    }
    if (filter.condition === "is_not" || filter.condition === "not_has") {
        return not(
            customFieldExists({
                key: filter.key,
                valueCondition: customFieldValueEquals(filter.value),
            }),
        );
    }
    if (filter.condition === "contains") {
        return customFieldExists({
            key: filter.key,
            valueCondition: ilike(
                contactCustomFieldValues.valueText,
                `%${filter.value}%`,
            ),
        });
    }
    if (filter.condition === "not_contains") {
        return not(
            customFieldExists({
                key: filter.key,
                valueCondition: ilike(
                    contactCustomFieldValues.valueText,
                    `%${filter.value}%`,
                ),
            }),
        );
    }

    const date = new Date(filter.value);
    if (!Number.isFinite(date.getTime())) return undefined;

    if (filter.condition === "before") {
        return customFieldExists({
            key: filter.key,
            valueCondition: lt(contactCustomFieldValues.valueDate, date),
        });
    }
    if (filter.condition === "after") {
        return customFieldExists({
            key: filter.key,
            valueCondition: gt(contactCustomFieldValues.valueDate, date),
        });
    }
    if (filter.condition === "on") {
        const dateWithoutTime = new Date(date);
        dateWithoutTime.setUTCHours(0, 0, 0, 0);
        const nextDate = new Date(
            dateWithoutTime.getTime() + 24 * 60 * 60 * 1000,
        );
        return customFieldExists({
            key: filter.key,
            valueCondition: and(
                gte(contactCustomFieldValues.valueDate, dateWithoutTime),
                lt(contactCustomFieldValues.valueDate, nextDate),
            ),
        });
    }

    return undefined;
}

function customFieldValueEquals(value: string): SQL {
    if (value === "true" || value === "false") {
        return eq(contactCustomFieldValues.valueBoolean, value === "true");
    }

    const numberValue = Number(value);
    if (value.trim() !== "" && Number.isFinite(numberValue)) {
        return eq(contactCustomFieldValues.valueNumber, numberValue);
    }

    return eq(contactCustomFieldValues.valueText, value);
}
