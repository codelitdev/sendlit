import type { EventPropertyFilter, PropertyChangeFilter } from "@sendlit/api-contract";

/**
 * In-memory matching of a trigger's property filter against an event's
 * properties. The rules (missing keys, coercion, arrays) are the table in
 * docs/custom_events.md#property-filters; keep the two in step.
 */

type Scalar = string | number | boolean;
type Condition = EventPropertyFilter["filters"][number];

function readPath(properties: Record<string, unknown>, key: string): unknown {
  let value: unknown = properties;
  for (const part of key.split(".")) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
    value = (value as Record<string, unknown>)[part];
  }
  return value;
}

const isMissing = (value: unknown) => value === undefined || value === null;

function toNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/** `is` between a scalar property and a filter value, coercing the filter
 * value to the property's type (the dashboard sends strings). */
function scalarEquals(property: unknown, value: Scalar | undefined): boolean {
  if (value === undefined) return false;
  if (typeof property === "string") {
    return typeof value === "string"
      ? property.toLowerCase() === value.toLowerCase()
      : property.toLowerCase() === String(value).toLowerCase();
  }
  if (typeof property === "number") {
    const n = toNumber(value);
    return n !== null && n === property;
  }
  if (typeof property === "boolean") {
    if (typeof value === "boolean") return property === value;
    if (typeof value === "string") {
      const lowered = value.toLowerCase();
      return (
        (lowered === "true" || lowered === "false") && property === (lowered === "true")
      );
    }
    return false;
  }
  return false;
}

function compare(property: unknown, value: Scalar | undefined): number | null {
  const left = toNumber(property);
  const right = toNumber(value);
  if (left === null || right === null || typeof property === "boolean") return null;
  return left - right;
}

function containsMatch(property: unknown, value: Scalar | undefined): boolean {
  if (value === undefined) return false;
  if (typeof property === "string") {
    return property.toLowerCase().includes(String(value).toLowerCase());
  }
  if (Array.isArray(property))
    return property.some((item) => scalarEquals(item, value));
  return false;
}

export function matchesCondition(
  properties: Record<string, unknown>,
  condition: Condition,
): boolean {
  const property = readPath(properties, condition.key);
  const missing = isMissing(property);
  const structured = typeof property === "object" && property !== null;
  switch (condition.condition) {
    case "exists":
      return !missing;
    case "not_exists":
      return missing;
    case "is":
      return !missing && !structured && scalarEquals(property, condition.value);
    case "is_not":
      return missing || structured || !scalarEquals(property, condition.value);
    case "contains":
      return !missing && containsMatch(property, condition.value);
    case "not_contains":
      return missing || !containsMatch(property, condition.value);
    case "gt":
    case "gte":
    case "lt":
    case "lte": {
      if (missing) return false;
      const diff = compare(property, condition.value);
      if (diff === null) return false;
      if (condition.condition === "gt") return diff > 0;
      if (condition.condition === "gte") return diff >= 0;
      if (condition.condition === "lt") return diff < 0;
      return diff <= 0;
    }
  }
}

/** A null or empty filter matches everything. */
export function matchesEventFilter(
  filter: EventPropertyFilter | null | undefined,
  properties: Record<string, unknown>,
): boolean {
  if (!filter?.filters?.length) return true;
  const results = filter.filters.map((condition) =>
    matchesCondition(properties, condition),
  );
  return filter.aggregator === "or" ? results.some(Boolean) : results.every(Boolean);
}

/** `contact:property_changed`: an absent side matches any value; `null`
 * means "unset"; otherwise compared like `is`. */
export function matchesPropertyChange(
  filter: PropertyChangeFilter | null | undefined,
  from: unknown,
  to: unknown,
): boolean {
  if (!filter) return true;
  const side = (expected: Scalar | null | undefined, actual: unknown) => {
    if (expected === undefined) return true;
    if (expected === null) return isMissing(actual);
    return !isMissing(actual) && scalarEquals(actual, expected);
  };
  return side(filter.from, from) && side(filter.to, to);
}
