"use client";

import { Plus, Trash2 } from "lucide-react";
import { Button } from "./components/ui/button";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "./components/ui/select";
import { Input } from "./components/ui/input";
import { cn } from "./lib/utils";
import type { ContactFilterCondition, ContactFilterWithAggregator } from "./types";

const emptyFilter = (): ContactFilterCondition => ({
    name: "tag",
    condition: "is",
    value: "",
});

function conditionsFor(name: ContactFilterCondition["name"]): {
    value: string;
    label: string;
}[] {
    switch (name) {
        case "tag":
            return [
                { value: "is", label: "has tag" },
                { value: "is_not", label: "does not have tag" },
            ];
        case "email":
            return [{ value: "contains", label: "contains" }];
        case "subscription":
            return [{ value: "is", label: "is" }];
        case "signedUp":
            return [
                { value: "before", label: "before" },
                { value: "after", label: "after" },
            ];
    }
}

function ValueInput({
    filter,
    onChange,
}: {
    filter: ContactFilterCondition;
    onChange: (value: string) => void;
}) {
    if (filter.name === "subscription") {
        return (
            <Select value={filter.value || "subscribed"} onValueChange={onChange}>
                <SelectTrigger className="w-full">
                    <SelectValue />
                </SelectTrigger>
                <SelectContent>
                    <SelectItem value="subscribed">Subscribed</SelectItem>
                    <SelectItem value="unsubscribed">Unsubscribed</SelectItem>
                </SelectContent>
            </Select>
        );
    }

    if (filter.name === "signedUp") {
        return (
            <Input
                type="date"
                value={filter.value ? new Date(Number(filter.value)).toISOString().slice(0, 10) : ""}
                onChange={(e) =>
                    onChange(e.target.value ? String(new Date(e.target.value).getTime()) : "")
                }
            />
        );
    }

    return (
        <Input
            placeholder={filter.name === "tag" ? "e.g. vip" : "e.g. @gmail.com"}
            value={filter.value}
            onChange={(e) => onChange(e.target.value)}
        />
    );
}

export interface ContactFilterBuilderProps {
    value: ContactFilterWithAggregator;
    onChange: (value: ContactFilterWithAggregator) => void;
    className?: string;
}

/**
 * A headless (value/onChange) segmentation builder for the contact filters
 * used by broadcasts (`sequence.filter`). Supports the filter types the API
 * understands: tag, email, subscription status and signup date.
 */
export function ContactFilterBuilder({
    value,
    onChange,
    className,
}: ContactFilterBuilderProps) {
    const filters = value?.filters ?? [];

    function updateFilter(index: number, patch: Partial<ContactFilterCondition>) {
        const next = filters.map((f, i) => (i === index ? { ...f, ...patch } : f));
        onChange({ ...value, filters: next });
    }

    function removeFilter(index: number) {
        onChange({ ...value, filters: filters.filter((_, i) => i !== index) });
    }

    function addFilter() {
        onChange({ ...value, filters: [...filters, emptyFilter()] });
    }

    return (
        <div className={cn("space-y-3", className)}>
            {filters.length > 1 && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <span>Match</span>
                    <Select
                        value={value.aggregator}
                        onValueChange={(aggregator) =>
                            onChange({ ...value, aggregator: aggregator as "and" | "or" })
                        }
                    >
                        <SelectTrigger className="w-24 h-8">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="and">all</SelectItem>
                            <SelectItem value="or">any</SelectItem>
                        </SelectContent>
                    </Select>
                    <span>of the following conditions</span>
                </div>
            )}

            {filters.length === 0 && (
                <p className="text-sm text-muted-foreground">
                    No filters yet — this segment matches every subscribed contact.
                </p>
            )}

            <div className="space-y-2">
                {filters.map((filter, index) => (
                    <div
                        key={index}
                        className="grid grid-cols-[1fr_1fr_1fr_auto] items-center gap-2"
                    >
                        <Select
                            value={filter.name}
                            onValueChange={(name) =>
                                updateFilter(index, {
                                    name: name as ContactFilterCondition["name"],
                                    condition: conditionsFor(
                                        name as ContactFilterCondition["name"],
                                    )[0].value,
                                    value: "",
                                })
                            }
                        >
                            <SelectTrigger>
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="tag">Tag</SelectItem>
                                <SelectItem value="email">Email</SelectItem>
                                <SelectItem value="subscription">Subscription</SelectItem>
                                <SelectItem value="signedUp">Signed up</SelectItem>
                            </SelectContent>
                        </Select>

                        <Select
                            value={filter.condition}
                            onValueChange={(condition) => updateFilter(index, { condition })}
                        >
                            <SelectTrigger>
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                {conditionsFor(filter.name).map((c) => (
                                    <SelectItem key={c.value} value={c.value}>
                                        {c.label}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>

                        <ValueInput
                            filter={filter}
                            onChange={(v) => updateFilter(index, { value: v })}
                        />

                        <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            onClick={() => removeFilter(index)}
                        >
                            <Trash2 className="size-4" />
                        </Button>
                    </div>
                ))}
            </div>

            <Button type="button" variant="outline" size="sm" onClick={addFilter}>
                <Plus className="size-4" />
                Add condition
            </Button>
        </div>
    );
}
