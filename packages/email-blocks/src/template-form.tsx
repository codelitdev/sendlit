"use client";

import { EmailEditor, type Email } from "@sendlit/email-editor";
import { Input } from "./components/ui/input";
import { Label } from "./components/ui/label";
import { cn } from "./lib/utils";

export interface TemplateFormValue {
    title: string;
    content: Email;
}

export interface TemplateFormProps {
    value: TemplateFormValue;
    onChange: (value: TemplateFormValue) => void;
    className?: string;
}

/** Composing block for a reusable email template: a title + the WYSIWYG editor. */
export function TemplateForm({ value, onChange, className }: TemplateFormProps) {
    return (
        <div className={cn("flex flex-col gap-4", className)}>
            <div className="max-w-sm space-y-1.5">
                <Label htmlFor="template-title">Title</Label>
                <Input
                    id="template-title"
                    value={value.title}
                    onChange={(e) => onChange({ ...value, title: e.target.value })}
                    placeholder="e.g. Welcome email"
                />
            </div>
            <div className="min-h-0 flex-1 rounded-lg border">
                <EmailEditor
                    email={value.content}
                    onChange={(content) => onChange({ ...value, content })}
                />
            </div>
        </div>
    );
}
