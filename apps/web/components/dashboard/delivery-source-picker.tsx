"use client";

import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/codelit/select";
import type { DeliverySourceSelection, SendingOption } from "@/lib/api";

/** `Select` cannot represent a null value. Null intentionally leaves source
 * selection to the team's default at activation time. */
const DEFAULT_VALUE = "__default__";
const ORGANIZATION_VALUE = "__organization__";
const TEAM_PREFIX = "team:";

function toValue(source: DeliverySourceSelection | null | undefined) {
    if (!source) return DEFAULT_VALUE;
    return source.type === "organization"
        ? ORGANIZATION_VALUE
        : `${TEAM_PREFIX}${source.espId ?? ""}`;
}

function valueForOption(option: SendingOption) {
    return option.type === "organization"
        ? ORGANIZATION_VALUE
        : `${TEAM_PREFIX}${option.espId}`;
}

function labelFor(option: SendingOption) {
    const sender = option.fromEmail ? ` (${option.fromEmail})` : "";
    return option.type === "organization"
        ? `Shared: ${option.name}${sender}`
        : `${option.name}${sender}`;
}

/**
 * Selects an immutable delivery-source intent for a draft. Organization
 * options deliberately carry no ESP id: a team can use the shared sender but
 * never learns its credentials or organization-internal configuration id.
 */
export function DeliverySourcePicker({
    options,
    value,
    onChange,
    disabled,
}: {
    options: SendingOption[];
    value: DeliverySourceSelection | null | undefined;
    onChange: (source: DeliverySourceSelection | null) => void;
    disabled?: boolean;
}) {
    const availableOptions = options.filter((option) => option.available);
    const hasDefault = availableOptions.some((option) => option.isDefault);
    const soleOption =
        availableOptions.length === 1 ? availableOptions[0] : null;
    // A lone available source resolves automatically, so a separate "team
    // default" alias adds no choice and merely duplicates the same sender.
    const selectedValue =
        !value && soleOption ? valueForOption(soleOption) : toValue(value);

    return (
        <Select
            value={selectedValue}
            onValueChange={(next) => {
                if (next === DEFAULT_VALUE) {
                    onChange(null);
                } else if (next === ORGANIZATION_VALUE) {
                    onChange({ type: "organization" });
                } else if (next.startsWith(TEAM_PREFIX)) {
                    onChange({
                        type: "team",
                        espId: next.slice(TEAM_PREFIX.length),
                    });
                }
            }}
            disabled={disabled || availableOptions.length === 0}
        >
            <SelectTrigger className="w-full">
                <SelectValue placeholder="Select a delivery source" />
            </SelectTrigger>
            <SelectContent>
                {hasDefault && !soleOption && (
                    <SelectItem value={DEFAULT_VALUE}>
                        Team default delivery source
                    </SelectItem>
                )}
                {availableOptions.map((option) => (
                    <SelectItem
                        key={valueForOption(option)}
                        value={valueForOption(option)}
                    >
                        {labelFor(option)}
                    </SelectItem>
                ))}
            </SelectContent>
        </Select>
    );
}
