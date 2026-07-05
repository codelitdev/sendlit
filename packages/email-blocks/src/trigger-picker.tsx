"use client";

import { Label } from "./components/ui/label";
import { Input } from "./components/ui/input";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "./components/ui/select";
import { cn } from "./lib/utils";
import type { TriggerType } from "./types";

export interface TriggerValueOption {
    value: string;
    label: string;
}

export interface TriggerValueInput {
    type: "text" | "select";
    placeholder?: string;
    options?: TriggerValueOption[];
}

export interface TriggerOption {
    value: TriggerType | (string & {});
    label: string;
    needsData?: boolean;
    dataLabel?: string;
    valueInput?: TriggerValueInput;
}

const defaultTriggers: TriggerOption[] = [
    {
        value: "subscriber:added",
        label: "A new contact subscribes",
        needsData: false,
    },
    {
        value: "tag:added",
        label: "A tag is added to a contact",
        needsData: true,
        dataLabel: "Tag name",
        valueInput: { type: "text", placeholder: "e.g. vip" },
    },
    {
        value: "tag:removed",
        label: "A tag is removed from a contact",
        needsData: true,
        dataLabel: "Tag name",
        valueInput: { type: "text", placeholder: "e.g. vip" },
    },
];

export interface TriggerPickerProps {
    triggerType?: string | null;
    triggerData?: string | null;
    onChange: (value: {
        triggerType: string;
        triggerData?: string | null;
    }) => void;
    triggers?: TriggerOption[];
    label?: string;
    className?: string;
}

/** Picks the event that enrolls contacts into a sequence. */
export function TriggerPicker({
    triggerType,
    triggerData,
    onChange,
    triggers = defaultTriggers,
    label = "Trigger",
    className,
}: TriggerPickerProps) {
    const current =
        triggers.find((t) => t.value === triggerType) ?? triggers[0];

    return (
        <div className={cn("space-y-3", className)}>
            <div className="space-y-1.5">
                <Label>{label}</Label>
                <Select
                    value={current.value}
                    onValueChange={(value) =>
                        onChange({ triggerType: value, triggerData })
                    }
                >
                    <SelectTrigger className="w-full">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        {triggers.map((t) => (
                            <SelectItem key={t.value} value={t.value}>
                                {t.label}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            </div>

            {current.needsData && (
                <div className="space-y-1.5">
                    <Label>{current.dataLabel ?? "Value"}</Label>
                    {current.valueInput?.type === "select" ? (
                        <Select
                            value={triggerData ?? ""}
                            onValueChange={(value) =>
                                onChange({
                                    triggerType: current.value,
                                    triggerData: value,
                                })
                            }
                        >
                            <SelectTrigger className="w-full">
                                <SelectValue
                                    placeholder={current.valueInput.placeholder}
                                />
                            </SelectTrigger>
                            <SelectContent>
                                {(current.valueInput.options ?? []).map(
                                    (option) => (
                                        <SelectItem
                                            key={option.value}
                                            value={option.value}
                                        >
                                            {option.label}
                                        </SelectItem>
                                    ),
                                )}
                            </SelectContent>
                        </Select>
                    ) : (
                        <Input
                            placeholder={current.valueInput?.placeholder}
                            value={triggerData ?? ""}
                            onChange={(e) =>
                                onChange({
                                    triggerType: current.value,
                                    triggerData: e.target.value,
                                })
                            }
                        />
                    )}
                </div>
            )}
        </div>
    );
}
