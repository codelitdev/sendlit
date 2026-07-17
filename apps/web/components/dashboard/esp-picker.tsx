"use client";

import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import type { EspConfig } from "@/lib/api";

/** Sentinel for "use the team's default ESP" — `Select` can't carry a real
 * empty-string/null value. */
const DEFAULT_VALUE = "__default__";

/**
 * Picks which user-managed ESP a sequence/broadcast/send should pin, or
 * leaves it unresolved so the team's default ESP is used. Shared by the new
 * sequence/broadcast dialog and their detail pages so the "team default"
 * sentinel handling lives in one place.
 */
export function EspPicker({
    esps,
    value,
    onChange,
    disabled,
}: {
    esps: EspConfig[];
    /** `null`/`undefined` both mean "team default" for display purposes. */
    value: string | null | undefined;
    onChange: (espId: string | null) => void;
    disabled?: boolean;
}) {
    return (
        <Select
            value={value ?? DEFAULT_VALUE}
            onValueChange={(next) =>
                onChange(next === DEFAULT_VALUE ? null : next)
            }
            disabled={disabled || esps.length === 0}
        >
            <SelectTrigger className="w-full">
                <SelectValue />
            </SelectTrigger>
            <SelectContent>
                <SelectItem value={DEFAULT_VALUE}>Team default ESP</SelectItem>
                {esps.map((esp) => (
                    <SelectItem key={esp.espId} value={esp.espId}>
                        {esp.name}
                        {esp.isDefault ? " (default)" : ""}
                    </SelectItem>
                ))}
            </SelectContent>
        </Select>
    );
}
