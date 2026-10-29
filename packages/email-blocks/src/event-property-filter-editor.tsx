"use client";

import { Plus, X } from "lucide-react";
import { Button } from "./components/ui/button";
import { Input } from "./components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./components/ui/select";
import { Switch } from "./components/ui/switch";
import { cn } from "./lib/utils";
import type {
  EventFilterCondition,
  EventPropertyFilter,
  EventPropertyType,
} from "./types";
import { ValueCombobox } from "./value-combobox";

const NUMERIC: EventFilterCondition[] = ["gt", "gte", "lt", "lte"];
const VALUELESS: EventFilterCondition[] = ["exists", "not_exists"];
const MAX_CONDITIONS = 10;

export interface EventPropertyFilterEditorLabels {
  conditions: Record<EventFilterCondition, string>;
  matchAll: string;
  matchAny: string;
  property: string;
  propertyPlaceholder: string;
  condition: string;
  value: string;
  removeCondition: string;
  addCondition: string;
  useProperty: (key: string) => string;
}

export const defaultEventPropertyFilterEditorLabels: EventPropertyFilterEditorLabels = {
  conditions: {
    is: "is",
    is_not: "is not",
    contains: "contains",
    not_contains: "doesn't contain",
    gt: "is greater than",
    gte: "is at least",
    lt: "is less than",
    lte: "is at most",
    exists: "is set",
    not_exists: "is not set",
  },
  matchAll: "All conditions match",
  matchAny: "Any condition matches",
  property: "Property",
  propertyPlaceholder: "Property",
  condition: "Condition",
  value: "Value",
  removeCondition: "Remove condition",
  addCondition: "Add condition",
  useProperty: (key) => `Use "${key}"`,
};

export interface EventPropertyFilterEditorProps {
  value: EventPropertyFilter | null;
  onChange: (value: EventPropertyFilter | null) => void;
  /** Known properties of the event, for key suggestions and value inputs. */
  properties?: { key: string; type: EventPropertyType }[];
  labels?: Partial<EventPropertyFilterEditorLabels>;
  className?: string;
}

/**
 * Edits a trigger's property filter: rows of property, condition and value.
 * Numbers and booleans are saved typed, so `amount is greater than 100`
 * compares numbers. Removing the last row clears the filter.
 */
export function EventPropertyFilterEditor({
  value,
  onChange,
  properties = [],
  labels: labelOverrides,
  className,
}: EventPropertyFilterEditorProps) {
  const labels = { ...defaultEventPropertyFilterEditorLabels, ...labelOverrides };
  const filters = value?.filters ?? [];
  const aggregator = value?.aggregator ?? "and";
  const typeOf = (key: string) => properties.find((p) => p.key === key)?.type;

  function update(next: EventPropertyFilter["filters"], nextAggregator = aggregator) {
    onChange(next.length ? { aggregator: nextAggregator, filters: next } : null);
  }

  function updateRow(
    index: number,
    patch: Partial<EventPropertyFilter["filters"][number]>,
  ) {
    update(filters.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  function typedValue(condition: EventFilterCondition, key: string, raw: string) {
    if (NUMERIC.includes(condition) || typeOf(key) === "number") {
      const n = Number(raw);
      return raw.trim() !== "" && Number.isFinite(n) ? n : raw;
    }
    return raw;
  }

  return (
    <div className={cn("space-y-2", className)}>
      {filters.length > 1 && (
        <Select
          value={aggregator}
          onValueChange={(next) => update(filters, next as "and" | "or")}
        >
          <SelectTrigger className="w-full sm:w-64" aria-label={labels.condition}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="and">{labels.matchAll}</SelectItem>
            <SelectItem value="or">{labels.matchAny}</SelectItem>
          </SelectContent>
        </Select>
      )}
      {filters.map((row, index) => {
        const type = typeOf(row.key);
        const numeric = NUMERIC.includes(row.condition) || type === "number";
        return (
          <div
            // biome-ignore lint/suspicious/noArrayIndexKey: rows have no stable id
            key={index}
            className="grid grid-cols-[1fr_1fr_1fr_auto] items-center gap-2"
          >
            <ValueCombobox
              aria-label={labels.property}
              value={row.key}
              options={properties.map((p) => p.key)}
              onChange={(key) => updateRow(index, { key })}
              placeholder={labels.propertyPlaceholder}
              searchPlaceholder={labels.propertyPlaceholder}
              createLabel={labels.useProperty}
              monospace
            />
            <Select
              value={row.condition}
              onValueChange={(next) => {
                const condition = next as EventFilterCondition;
                updateRow(index, {
                  condition,
                  ...(VALUELESS.includes(condition) && { value: undefined }),
                });
              }}
            >
              <SelectTrigger aria-label={labels.condition}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(labels.conditions) as EventFilterCondition[]).map((c) => (
                  <SelectItem key={c} value={c}>
                    {labels.conditions[c]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {VALUELESS.includes(row.condition) ? (
              <span />
            ) : type === "boolean" && !numeric ? (
              <Switch
                aria-label={labels.value}
                checked={row.value === true}
                onCheckedChange={(checked) => updateRow(index, { value: checked })}
              />
            ) : (
              <Input
                aria-label={labels.value}
                type={numeric ? "number" : "text"}
                value={row.value === undefined ? "" : String(row.value)}
                onChange={(e) =>
                  updateRow(index, {
                    value: typedValue(row.condition, row.key, e.target.value),
                  })
                }
              />
            )}
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={labels.removeCondition}
              onClick={() => update(filters.filter((_, i) => i !== index))}
            >
              <X className="size-4" />
            </Button>
          </div>
        );
      })}
      {filters.length < MAX_CONDITIONS && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => update([...filters, { key: "", condition: "is", value: "" }])}
        >
          <Plus className="size-4" />
          {labels.addCondition}
        </Button>
      )}
    </div>
  );
}
