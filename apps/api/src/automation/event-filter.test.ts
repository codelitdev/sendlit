import { describe, expect, it } from "bun:test";
import {
  matchesCondition,
  matchesEventFilter,
  matchesPropertyChange,
} from "./event-filter";

const props = {
  plan: "Pro",
  amount: 120,
  amountText: "120",
  trial: true,
  tags: ["rust", "go"],
  course: { id: "c_1", price: 49 },
  empty: null,
};

type Case = [string, Parameters<typeof matchesCondition>[1], boolean];

// One row per cell of the table in docs/custom_events.md#property-filters.
const cases: Case[] = [
  // is
  [
    "is: string, case-insensitive",
    { key: "plan", condition: "is", value: "pro" },
    true,
  ],
  [
    "is: number, coerced filter value",
    { key: "amount", condition: "is", value: "120" },
    true,
  ],
  [
    "is: boolean, coerced filter value",
    { key: "trial", condition: "is", value: "true" },
    true,
  ],
  ["is: missing", { key: "nope", condition: "is", value: "x" }, false],
  ["is: null counts as missing", { key: "empty", condition: "is", value: "x" }, false],
  ["is: array", { key: "tags", condition: "is", value: "rust" }, false],
  ["is: dot path", { key: "course.id", condition: "is", value: "c_1" }, true],
  // is_not
  ["is_not: missing is true", { key: "nope", condition: "is_not", value: "x" }, true],
  ["is_not: different", { key: "plan", condition: "is_not", value: "free" }, true],
  ["is_not: same", { key: "plan", condition: "is_not", value: "PRO" }, false],
  ["is_not: object is true", { key: "course", condition: "is_not", value: "x" }, true],
  // contains
  ["contains: substring", { key: "plan", condition: "contains", value: "r" }, true],
  [
    "contains: array membership",
    { key: "tags", condition: "contains", value: "go" },
    true,
  ],
  ["contains: number", { key: "amount", condition: "contains", value: "1" }, false],
  ["contains: missing", { key: "nope", condition: "contains", value: "x" }, false],
  ["contains: object", { key: "course", condition: "contains", value: "c" }, false],
  // not_contains
  [
    "not_contains: missing is true",
    { key: "nope", condition: "not_contains", value: "x" },
    true,
  ],
  [
    "not_contains: array",
    { key: "tags", condition: "not_contains", value: "rust" },
    false,
  ],
  [
    "not_contains: number",
    { key: "amount", condition: "not_contains", value: "1" },
    true,
  ],
  // numeric comparisons
  ["gt: number", { key: "amount", condition: "gt", value: 100 }, true],
  [
    "gt: dashboard string value",
    { key: "amount", condition: "gt", value: "100" },
    true,
  ],
  [
    "gt: numeric string property",
    { key: "amountText", condition: "gt", value: 100 },
    true,
  ],
  ["gte: equal", { key: "amount", condition: "gte", value: 120 }, true],
  ["lt: number", { key: "amount", condition: "lt", value: 100 }, false],
  ["lte: nested", { key: "course.price", condition: "lte", value: 49 }, true],
  ["gt: non-numeric string", { key: "plan", condition: "gt", value: 1 }, false],
  ["gt: boolean", { key: "trial", condition: "gt", value: 0 }, false],
  ["gt: missing", { key: "nope", condition: "gt", value: 0 }, false],
  ["gt: array", { key: "tags", condition: "gt", value: 0 }, false],
  // exists
  ["exists: present", { key: "plan", condition: "exists" }, true],
  ["exists: null", { key: "empty", condition: "exists" }, false],
  ["exists: object", { key: "course", condition: "exists" }, true],
  ["not_exists: missing", { key: "nope", condition: "not_exists" }, true],
  ["not_exists: present", { key: "tags", condition: "not_exists" }, false],
];

describe("matchesCondition", () => {
  it.each(cases)("%s", (_name, condition, expected) => {
    expect(matchesCondition(props, condition)).toBe(expected);
  });
});

describe("matchesEventFilter", () => {
  it("matches everything without a filter", () => {
    expect(matchesEventFilter(null, props)).toBe(true);
    expect(matchesEventFilter({ aggregator: "and", filters: [] }, props)).toBe(true);
  });

  it("combines with and / or", () => {
    const filters = [
      { key: "plan", condition: "is" as const, value: "pro" },
      { key: "amount", condition: "lt" as const, value: 10 },
    ];
    expect(matchesEventFilter({ aggregator: "and", filters }, props)).toBe(false);
    expect(matchesEventFilter({ aggregator: "or", filters }, props)).toBe(true);
  });
});

describe("matchesPropertyChange", () => {
  it("treats a missing side as any value and null as unset", () => {
    expect(matchesPropertyChange(null, "a", "b")).toBe(true);
    expect(matchesPropertyChange({ to: "pro" }, "free", "pro")).toBe(true);
    expect(matchesPropertyChange({ from: "free", to: "pro" }, "trial", "pro")).toBe(
      false,
    );
    expect(matchesPropertyChange({ from: null }, null, "pro")).toBe(true);
    expect(matchesPropertyChange({ from: null }, "free", "pro")).toBe(false);
    expect(matchesPropertyChange({ to: 3 }, 1, "3")).toBe(true);
    expect(matchesPropertyChange({ to: "pro" }, "pro", null)).toBe(false);
    expect(matchesPropertyChange({ to: "3" }, 1, 3)).toBe(true);
  });
});
