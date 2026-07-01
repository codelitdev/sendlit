"use client";

import { EmailEditor, type Email } from "@sendlit/email-editor";
import { Input } from "./components/ui/input";
import { Label } from "./components/ui/label";
import { Switch } from "./components/ui/switch";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "./components/ui/select";
import { cn } from "./lib/utils";
import type { EmailActionType } from "./types";

export interface SequenceEmailFormValue {
    subject: string;
    content: Email;
    delayInMillis: number;
    published: boolean;
    actionType?: EmailActionType | null;
    actionData?: Record<string, unknown> | null;
}

export interface SequenceEmailFormProps {
    value: SequenceEmailFormValue;
    onChange: (value: SequenceEmailFormValue) => void;
    /** Hide delay/action fields for the single email of a broadcast. */
    variant?: "broadcast" | "sequence";
    className?: string;
}

const MILLIS_IN_DAY = 86400000;

/**
 * The core composing block: subject + WYSIWYG content (via
 * `@sendlit/email-editor`) + delivery timing/actions for one email inside a
 * sequence (or the single email of a broadcast).
 */
export function SequenceEmailForm({
    value,
    onChange,
    variant = "sequence",
    className,
}: SequenceEmailFormProps) {
    return (
        <div className={cn("flex flex-col gap-4", className)}>
            <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                    <Label htmlFor="email-subject">Subject</Label>
                    <Input
                        id="email-subject"
                        value={value.subject}
                        onChange={(e) => onChange({ ...value, subject: e.target.value })}
                        placeholder="Your subject line"
                    />
                </div>

                <div className="flex items-center justify-between gap-4 sm:justify-start">
                    <Label htmlFor="email-published" className="flex-1 sm:flex-none">
                        Published
                    </Label>
                    <Switch
                        id="email-published"
                        checked={value.published}
                        onCheckedChange={(published) => onChange({ ...value, published })}
                    />
                </div>
            </div>

            {variant === "sequence" && (
                <div className="grid gap-4 sm:grid-cols-3">
                    <div className="space-y-1.5">
                        <Label htmlFor="email-delay">Send after (days)</Label>
                        <Input
                            id="email-delay"
                            type="number"
                            min={0}
                            value={value.delayInMillis / MILLIS_IN_DAY}
                            onChange={(e) =>
                                onChange({
                                    ...value,
                                    delayInMillis: Number(e.target.value || 0) * MILLIS_IN_DAY,
                                })
                            }
                        />
                    </div>

                    <div className="space-y-1.5">
                        <Label>On send, tag contact</Label>
                        <Select
                            value={value.actionType ?? "none"}
                            onValueChange={(actionType) =>
                                onChange({
                                    ...value,
                                    actionType:
                                        actionType === "none"
                                            ? null
                                            : (actionType as EmailActionType),
                                })
                            }
                        >
                            <SelectTrigger className="w-full">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="none">No action</SelectItem>
                                <SelectItem value="tag:add">Add tag</SelectItem>
                                <SelectItem value="tag:remove">Remove tag</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>

                    {value.actionType && (
                        <div className="space-y-1.5">
                            <Label htmlFor="email-action-data">Tag name</Label>
                            <Input
                                id="email-action-data"
                                value={(value.actionData?.tag as string) ?? ""}
                                onChange={(e) =>
                                    onChange({
                                        ...value,
                                        actionData: { tag: e.target.value },
                                    })
                                }
                            />
                        </div>
                    )}
                </div>
            )}

            <div className="min-h-0 flex-1 rounded-lg border">
                <EmailEditor
                    email={value.content}
                    onChange={(content) => onChange({ ...value, content })}
                />
            </div>
        </div>
    );
}
