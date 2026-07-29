"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, CopyPlus, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/codelit/button";
import { IconButton } from "@/components/ui/codelit/icon-button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/codelit/dialog";
import { PageHeader } from "@/components/dashboard/page-header";
import { Banner } from "@/components/dashboard/banner";
import { Loading } from "@/components/dashboard/loading";
import { ScrollablePage } from "@/components/dashboard/scrollable-page";
import { useSetBreadcrumb } from "@/components/dashboard/breadcrumb-context";
import { DeleteConfirmationDialog } from "@/components/dashboard/delete-confirmation-dialog";
import { ApiError } from "@/lib/api-client";
import {
    deleteTemplate,
    duplicateTemplate,
    listSystemTemplates,
    listTemplates,
    type SystemTemplate,
} from "@/lib/api";
import type { TemplatePurpose } from "@sendlit/api-contract";
import {
    EmailPreview,
    TemplateChooser,
    type EmailTemplate,
} from "@sendlit/email-blocks";
import { MARKETING_EMAIL_EDITOR_BLOCKS } from "@/components/dashboard/email-editor-screen";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/codelit/tabs";
import {
    Tooltip,
    TooltipContent,
    TooltipTrigger,
} from "@/components/ui/codelit/tooltip";

const TEMPLATE_PREVIEW_CONTEXT = {
    footer: {
        mailingAddress: "Your workspace mailing address",
        unsubscribeUrl: "#unsubscribe-preview",
    },
};

export default function TemplatesPage() {
    useSetBreadcrumb([{ label: "Templates" }]);
    const router = useRouter();
    const [templates, setTemplates] = useState<EmailTemplate[] | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [chooserOpen, setChooserOpen] = useState(false);
    const [purposeFilter, setPurposeFilter] = useState<"all" | TemplatePurpose>(
        "all",
    );
    const [copiedTemplateId, setCopiedTemplateId] = useState<string | null>(
        null,
    );
    const [templatePendingDelete, setTemplatePendingDelete] =
        useState<EmailTemplate | null>(null);
    const [duplicatingTemplateId, setDuplicatingTemplateId] = useState<
        string | null
    >(null);

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

    const visibleTemplates =
        templates?.filter(
            (template) =>
                purposeFilter === "all" || template.purpose === purposeFilter,
        ) ?? null;

    async function duplicate(template: EmailTemplate) {
        setDuplicatingTemplateId(template.templateId);
        setError(null);
        try {
            await duplicateTemplate(template.templateId);
            await load();
        } catch (err) {
            setError(
                err instanceof ApiError
                    ? err.message
                    : "Failed to duplicate template",
            );
        } finally {
            setDuplicatingTemplateId(null);
        }
    }

    return (
        <ScrollablePage>
            <PageHeader
                title="Templates"
                description="Reusable content for marketing and transactional email."
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

            <Tabs
                value={purposeFilter}
                onValueChange={(value) =>
                    setPurposeFilter(value as "all" | TemplatePurpose)
                }
                className="mb-4"
            >
                <TabsList>
                    <TabsTrigger value="all">All</TabsTrigger>
                    <TabsTrigger value="marketing">Marketing</TabsTrigger>
                    <TabsTrigger value="transactional">
                        Transactional
                    </TabsTrigger>
                </TabsList>
            </Tabs>

            <DeleteConfirmationDialog
                open={templatePendingDelete !== null}
                onOpenChange={(open) => {
                    if (!open) setTemplatePendingDelete(null);
                }}
                title="Delete template?"
                description={`This will permanently delete "${templatePendingDelete?.title ?? "this template"}". This action cannot be undone.`}
                onConfirm={async () => {
                    if (!templatePendingDelete) return;
                    await deleteTemplate(templatePendingDelete.templateId);
                    await load();
                }}
            />

            {visibleTemplates === null ? (
                <Loading />
            ) : visibleTemplates.length === 0 ? (
                <Card>
                    <CardContent className="p-6 text-sm text-muted-foreground">
                        No templates yet. Create one for campaigns or
                        API-triggered email.
                    </CardContent>
                </Card>
            ) : (
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {visibleTemplates.map((template) => (
                        <Card
                            key={template.templateId}
                            className={
                                template.validationError
                                    ? "border-amber-300 bg-amber-50/30 dark:border-amber-800 dark:bg-amber-950/10"
                                    : "cursor-pointer transition-shadow hover:shadow-md"
                            }
                            onClick={
                                template.validationError
                                    ? undefined
                                    : () =>
                                          router.push(
                                              `/editor/templates/${template.templateId}`,
                                          )
                            }
                        >
                            <CardContent className="flex flex-col gap-3 p-4">
                                {template.validationError ? (
                                    <div className="flex min-h-[280px] items-center rounded-lg border border-dashed border-amber-300 p-4 text-sm text-amber-900 dark:border-amber-800 dark:text-amber-100">
                                        This template uses a retired format.
                                        Delete it and create a new template.
                                    </div>
                                ) : (
                                    <EmailPreview
                                        content={template.content}
                                        minHeight="280px"
                                        previewHeight="280px"
                                        blocks={
                                            template.purpose === "marketing"
                                                ? MARKETING_EMAIL_EDITOR_BLOCKS
                                                : undefined
                                        }
                                        renderContext={
                                            template.purpose === "marketing"
                                                ? TEMPLATE_PREVIEW_CONTEXT
                                                : undefined
                                        }
                                    />
                                )}
                                <div className="flex items-center justify-between gap-2">
                                    <div className="min-w-0">
                                        <p className="truncate font-medium">
                                            {template.title}
                                        </p>
                                        <Badge
                                            variant="secondary"
                                            className="mb-1 capitalize"
                                        >
                                            {template.purpose}
                                        </Badge>
                                        {template.validationError && (
                                            <p className="text-xs font-medium text-amber-700 dark:text-amber-300">
                                                Needs reset:{" "}
                                                {template.validationError}
                                            </p>
                                        )}
                                        {!template.validationError &&
                                            template.purpose ===
                                                "transactional" &&
                                            template.requiredVariables.length >
                                                0 && (
                                                <p className="truncate text-xs text-muted-foreground">
                                                    Requires{" "}
                                                    {template.requiredVariables.join(
                                                        ", ",
                                                    )}
                                                </p>
                                            )}
                                        <p className="text-xs text-muted-foreground">
                                            Updated{" "}
                                            {new Date(
                                                template.updatedAt,
                                            ).toLocaleDateString()}
                                        </p>
                                    </div>
                                    <div className="flex items-center">
                                        {!template.validationError && (
                                            <Tooltip>
                                                <TooltipTrigger asChild>
                                                    <IconButton
                                                        aria-label="Copy template ID"
                                                        onClick={async (
                                                            event,
                                                        ) => {
                                                            event.stopPropagation();
                                                            try {
                                                                await navigator.clipboard.writeText(
                                                                    template.templateId,
                                                                );
                                                                setCopiedTemplateId(
                                                                    template.templateId,
                                                                );
                                                                window.setTimeout(
                                                                    () =>
                                                                        setCopiedTemplateId(
                                                                            (
                                                                                current,
                                                                            ) =>
                                                                                current ===
                                                                                template.templateId
                                                                                    ? null
                                                                                    : current,
                                                                        ),
                                                                    2_000,
                                                                );
                                                            } catch {
                                                                setError(
                                                                    "Failed to copy template ID",
                                                                );
                                                            }
                                                        }}
                                                    >
                                                        {copiedTemplateId ===
                                                        template.templateId ? (
                                                            <Check className="size-4" />
                                                        ) : (
                                                            <Copy className="size-4" />
                                                        )}
                                                    </IconButton>
                                                </TooltipTrigger>
                                                <TooltipContent>
                                                    {copiedTemplateId ===
                                                    template.templateId
                                                        ? "Copied template ID"
                                                        : "Copy template ID"}
                                                </TooltipContent>
                                            </Tooltip>
                                        )}
                                        {!template.validationError && (
                                            <Tooltip>
                                                <TooltipTrigger asChild>
                                                    <IconButton
                                                        aria-label="Duplicate template"
                                                        disabled={
                                                            duplicatingTemplateId ===
                                                            template.templateId
                                                        }
                                                        onClick={(event) => {
                                                            event.stopPropagation();
                                                            duplicate(template);
                                                        }}
                                                    >
                                                        <CopyPlus className="size-4" />
                                                    </IconButton>
                                                </TooltipTrigger>
                                                <TooltipContent>
                                                    Duplicate template
                                                </TooltipContent>
                                            </Tooltip>
                                        )}
                                        <IconButton
                                            title="Delete template"
                                            aria-label="Delete template"
                                            onClick={(event) => {
                                                event.stopPropagation();
                                                setTemplatePendingDelete(
                                                    template,
                                                );
                                            }}
                                        >
                                            <Trash2 className="size-4" />
                                        </IconButton>
                                    </div>
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
    const [purpose, setPurpose] = useState<TemplatePurpose | null>(null);

    useEffect(() => {
        if (!open || !purpose) return;
        listSystemTemplates(purpose)
            .catch((err) =>
                onError(
                    err instanceof ApiError
                        ? err.message
                        : "Failed to load system templates",
                ),
            )
            .then((items) => items && setSystemTemplates(items));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, purpose]);

    useEffect(() => {
        if (!open) setPurpose(null);
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
            const template = await duplicateTemplate(choice.templateId, {
                title: choice.title,
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
            <DialogContent className="max-h-[80vh] overflow-y-auto sm:!max-w-2xl">
                <DialogHeader>
                    <DialogTitle>New template</DialogTitle>
                </DialogHeader>
                {!purpose ? (
                    <div className="grid gap-3 lg:grid-cols-2">
                        <Button
                            variant="outline"
                            className="h-auto w-full min-w-0 items-start justify-start whitespace-normal p-5 text-left"
                            onClick={() => setPurpose("marketing")}
                        >
                            <span className="min-w-0">
                                <span className="block font-semibold">
                                    Marketing
                                </span>
                                <span className="mt-1 block text-sm font-normal text-muted-foreground">
                                    Broadcasts and automated sequences with a
                                    managed footer.
                                </span>
                            </span>
                        </Button>
                        <Button
                            variant="outline"
                            className="h-auto w-full min-w-0 items-start justify-start whitespace-normal p-5 text-left"
                            onClick={() => setPurpose("transactional")}
                        >
                            <span className="min-w-0">
                                <span className="block font-semibold">
                                    Transactional
                                </span>
                                <span className="mt-1 block text-sm font-normal text-muted-foreground">
                                    API-triggered receipts, codes, alerts, and
                                    account email.
                                </span>
                            </span>
                        </Button>
                    </div>
                ) : (
                    <>
                        <Button
                            variant="ghost"
                            className="w-fit"
                            onClick={() => setPurpose(null)}
                        >
                            Choose a different purpose
                        </Button>
                        <TemplateChooser
                            purpose={purpose}
                            systemTemplates={systemTemplates}
                            templates={templates.filter(
                                (template) =>
                                    template.purpose === purpose &&
                                    !template.validationError,
                            )}
                            onSelect={onSelect}
                            loading={creating}
                            previewBlocks={
                                purpose === "marketing"
                                    ? MARKETING_EMAIL_EDITOR_BLOCKS
                                    : undefined
                            }
                            previewRenderContext={
                                purpose === "marketing"
                                    ? TEMPLATE_PREVIEW_CONTEXT
                                    : undefined
                            }
                        />
                    </>
                )}
            </DialogContent>
        </Dialog>
    );
}
