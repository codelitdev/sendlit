"use client";

import { use, useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Banner } from "@/components/dashboard/banner";
import { EmailEditorScreen } from "@/components/dashboard/email-editor-screen";
import { ApiError } from "@/lib/api-client";
import { getTemplate, updateTemplate } from "@/lib/api";
import type { Email } from "@sendlit/email-editor";

export default function TemplateEditorPage({
    params,
}: {
    params: Promise<{ templateId: string }>;
}) {
    const { templateId } = use(params);
    const [title, setTitle] = useState<string | null>(null);
    const [content, setContent] = useState<Email | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        getTemplate(templateId)
            .then((template) => {
                setTitle(template.title);
                setContent(template.content);
            })
            .catch((err) =>
                setError(
                    err instanceof ApiError
                        ? err.message
                        : "Failed to load template",
                ),
            );
    }, [templateId]);

    if (error) return <Banner>{error}</Banner>;
    if (title === null || content === null)
        return <p className="text-sm text-muted-foreground">Loading…</p>;

    return (
        <EmailEditorScreen
            exitFallbackHref="/dashboard/templates"
            screenTitle="Editing template"
            saveLabel="Save template"
            initialContent={content}
            onSave={async (nextContent) => {
                await updateTemplate(templateId, {
                    title,
                    content: nextContent,
                });
            }}
            header={
                <div className="flex max-w-md items-center gap-3">
                    <Label
                        htmlFor="template-title"
                        className="shrink-0 text-muted-foreground"
                    >
                        Title
                    </Label>
                    <Input
                        id="template-title"
                        value={title}
                        onChange={(e) => setTitle(e.target.value)}
                        placeholder="e.g. Welcome email"
                    />
                </div>
            }
        />
    );
}
