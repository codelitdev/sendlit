"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Banner } from "@/components/dashboard/banner";
import { ApiError } from "@/lib/api-client";
import { getTemplate, updateTemplate } from "@/lib/api";
import { EmailEditor, type Email } from "@sendlit/email-editor";

interface TemplateEditorValue {
    title: string;
    content: Email;
}

export default function TemplateEditorPage({
    params,
}: {
    params: Promise<{ templateId: string }>;
}) {
    const { templateId } = use(params);
    const [value, setValue] = useState<TemplateEditorValue | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);

    useEffect(() => {
        getTemplate(templateId)
            .then((template) =>
                setValue({ title: template.title, content: template.content }),
            )
            .catch((err) =>
                setError(
                    err instanceof ApiError
                        ? err.message
                        : "Failed to load template",
                ),
            );
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [templateId]);

    async function save() {
        if (!value) return;
        setSaving(true);
        setError(null);
        try {
            await updateTemplate(templateId, value);
            setSaved(true);
            setTimeout(() => setSaved(false), 2000);
        } catch (err) {
            setError(
                err instanceof ApiError
                    ? err.message
                    : "Failed to save template",
            );
        } finally {
            setSaving(false);
        }
    }

    if (error && !value) return <Banner>{error}</Banner>;
    if (!value)
        return <p className="text-sm text-muted-foreground">Loading…</p>;

    return (
        <div className="flex h-full flex-col p-8">
            <div className="mb-4 flex items-center justify-between">
                <Link
                    href="/dashboard/templates"
                    className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
                >
                    <ArrowLeft className="size-3.5" />
                    Back to templates
                </Link>
                <Button onClick={save} disabled={saving}>
                    {saved ? <Check className="size-4" /> : null}
                    {saved ? "Saved" : saving ? "Saving…" : "Save template"}
                </Button>
            </div>

            {error && <Banner className="mb-4">{error}</Banner>}

            <div className="flex min-h-0 flex-1 flex-col gap-4">
                <div className="max-w-sm space-y-1.5">
                    <Label htmlFor="template-title">Title</Label>
                    <Input
                        id="template-title"
                        value={value.title}
                        onChange={(e) =>
                            setValue({ ...value, title: e.target.value })
                        }
                        placeholder="e.g. Welcome email"
                    />
                </div>
                <div className="min-h-0 flex-1 rounded-lg border">
                    <EmailEditor
                        email={value.content}
                        onChange={(content) => setValue({ ...value, content })}
                    />
                </div>
            </div>
        </div>
    );
}
