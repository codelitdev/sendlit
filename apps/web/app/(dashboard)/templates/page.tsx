"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { PageHeader } from "@/components/dashboard/page-header";
import { Banner } from "@/components/dashboard/banner";
import { ScrollablePage } from "@/components/dashboard/scrollable-page";
import { ApiError } from "@/lib/api-client";
import {
    createTemplate,
    deleteTemplate,
    listSystemTemplates,
    listTemplates,
    type SystemTemplate,
} from "@/lib/api";
import {
    EmailPreview,
    TemplateChooser,
    type EmailTemplate,
} from "@sendlit/email-blocks";

export default function TemplatesPage() {
    const router = useRouter();
    const [templates, setTemplates] = useState<EmailTemplate[] | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [chooserOpen, setChooserOpen] = useState(false);

    async function load() {
        try {
            setTemplates(await listTemplates());
        } catch (err) {
            setError(
                err instanceof ApiError
                    ? err.message
                    : "Failed to load templates",
            );
        }
    }

    useEffect(() => {
        load();
    }, []);

    return (
        <ScrollablePage>
            <PageHeader
                title="Templates"
                description="Reusable content for broadcasts and sequences."
                action={
                    <Button onClick={() => setChooserOpen(true)}>
                        <Plus className="size-4" />
                        New template
                    </Button>
                }
            />

            <NewTemplateDialog
                open={chooserOpen}
                onOpenChange={setChooserOpen}
                templates={templates ?? []}
                onError={setError}
            />

            {error && <Banner className="mb-4">{error}</Banner>}

            {templates === null ? (
                <p className="text-sm text-muted-foreground">Loading…</p>
            ) : templates.length === 0 ? (
                <Card>
                    <CardContent className="p-6 text-sm text-muted-foreground">
                        No templates yet. Create one to reuse across broadcasts
                        and sequences.
                    </CardContent>
                </Card>
            ) : (
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {templates.map((template) => (
                        <Card
                            key={template.templateId}
                            className="cursor-pointer transition-shadow hover:shadow-md"
                            onClick={() =>
                                router.push(
                                    `/editor/templates/${template.templateId}`,
                                )
                            }
                        >
                            <CardContent className="flex flex-col gap-3 p-4">
                                <EmailPreview
                                    content={template.content}
                                    minHeight="280px"
                                />
                                <div className="flex items-center justify-between gap-2">
                                    <div className="min-w-0">
                                        <p className="truncate font-medium">
                                            {template.title}
                                        </p>
                                        <p className="text-xs text-muted-foreground">
                                            Updated{" "}
                                            {new Date(
                                                template.updatedAt,
                                            ).toLocaleDateString()}
                                        </p>
                                    </div>
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        onClick={async (e) => {
                                            e.stopPropagation();
                                            await deleteTemplate(
                                                template.templateId,
                                            );
                                            load();
                                        }}
                                    >
                                        <Trash2 className="size-4" />
                                    </Button>
                                </div>
                            </CardContent>
                        </Card>
                    ))}
                </div>
            )}
        </ScrollablePage>
    );
}

function NewTemplateDialog({
    open,
    onOpenChange,
    templates,
    onError,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    templates: EmailTemplate[];
    onError: (message: string) => void;
}) {
    const router = useRouter();
    const [systemTemplates, setSystemTemplates] = useState<SystemTemplate[]>(
        [],
    );
    const [creating, setCreating] = useState(false);

    useEffect(() => {
        if (!open) return;
        listSystemTemplates()
            .catch((err) =>
                onError(
                    err instanceof ApiError
                        ? err.message
                        : "Failed to load system templates",
                ),
            )
            .then((items) => items && setSystemTemplates(items));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open]);

    async function onSelect(choice: { templateId: string; title: string }) {
        setCreating(true);
        // System templates carry their full content client-side already; a
        // user's own template needs its content pulled from the list we already
        // have (both `listSystemTemplates()` and `listTemplates()` return full
        // content, so no extra fetch is needed either way).
        const system = systemTemplates.find(
            (t) => t.templateId === choice.templateId,
        );
        const own = templates.find((t) => t.templateId === choice.templateId);
        const content = system?.content ?? own?.content;
        if (!content) {
            setCreating(false);
            return;
        }

        try {
            const template = await createTemplate({
                title: choice.title,
                content,
            });
            onOpenChange(false);
            router.push(`/editor/templates/${template.templateId}`);
        } catch (err) {
            onError(
                err instanceof ApiError
                    ? err.message
                    : "Failed to create template",
            );
            setCreating(false);
        }
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-h-[80vh] overflow-y-auto sm:!max-w-5xl">
                <DialogHeader>
                    <DialogTitle>New template</DialogTitle>
                </DialogHeader>
                <TemplateChooser
                    systemTemplates={systemTemplates}
                    templates={templates}
                    onSelect={onSelect}
                    loading={creating}
                />
            </DialogContent>
        </Dialog>
    );
}
