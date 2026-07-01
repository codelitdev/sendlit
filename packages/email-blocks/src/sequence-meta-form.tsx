"use client";

import { Input } from "./components/ui/input";
import { Label } from "./components/ui/label";
import { ContactFilterBuilder } from "./contact-filter-builder";
import { TriggerPicker } from "./trigger-picker";
import { cn } from "./lib/utils";
import type { ContactFilterWithAggregator, MailType } from "./types";

export interface SequenceMetaFormValue {
    title: string;
    fromName?: string | null;
    fromEmail?: string | null;
    filter?: ContactFilterWithAggregator | null;
    triggerType?: string | null;
    triggerData?: string | null;
}

export interface SequenceMetaFormProps {
    type: MailType;
    value: SequenceMetaFormValue;
    onChange: (value: SequenceMetaFormValue) => void;
    className?: string;
}

const emptyFilter: ContactFilterWithAggregator = { aggregator: "or", filters: [] };

/**
 * The metadata half of composing a broadcast or a sequence: title, sender
 * identity, and either the audience filter (broadcasts) or the enrollment
 * trigger (sequences).
 */
export function SequenceMetaForm({
    type,
    value,
    onChange,
    className,
}: SequenceMetaFormProps) {
    return (
        <div className={cn("space-y-4", className)}>
            <div className="space-y-1.5">
                <Label htmlFor="sequence-title">Title</Label>
                <Input
                    id="sequence-title"
                    value={value.title}
                    onChange={(e) => onChange({ ...value, title: e.target.value })}
                    placeholder={type === "broadcast" ? "e.g. October newsletter" : "e.g. Onboarding drip"}
                />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                    <Label htmlFor="sequence-from-name">From name</Label>
                    <Input
                        id="sequence-from-name"
                        value={value.fromName ?? ""}
                        onChange={(e) => onChange({ ...value, fromName: e.target.value })}
                        placeholder="Your name or company"
                    />
                </div>
                <div className="space-y-1.5">
                    <Label htmlFor="sequence-from-email">From email</Label>
                    <Input
                        id="sequence-from-email"
                        type="email"
                        value={value.fromEmail ?? ""}
                        onChange={(e) => onChange({ ...value, fromEmail: e.target.value })}
                        placeholder="you@yourdomain.com"
                    />
                </div>
            </div>

            {type === "broadcast" ? (
                <div className="space-y-1.5">
                    <Label>Audience</Label>
                    <ContactFilterBuilder
                        value={value.filter ?? emptyFilter}
                        onChange={(filter) => onChange({ ...value, filter })}
                    />
                </div>
            ) : (
                <TriggerPicker
                    triggerType={value.triggerType}
                    triggerData={value.triggerData}
                    onChange={({ triggerType, triggerData }) =>
                        onChange({ ...value, triggerType, triggerData })
                    }
                />
            )}
        </div>
    );
}
