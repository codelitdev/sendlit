"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Check, Pause, Pencil, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Banner } from "@/components/dashboard/banner";
import { ScrollablePage } from "@/components/dashboard/scrollable-page";
import { ApiError } from "@/lib/api-client";
import {
    addSequenceEmail,
    deleteSequenceEmail,
    getSequence,
    getSequenceStats,
    listSystemTemplates,
    listTemplates,
    pauseSequence,
    startSequence,
    updateSequence,
    updateSequenceEmail,
    type SystemTemplate,
} from "@/lib/api";
import {
    EmailPreview,
    SequenceAnalytics,
    SequenceEmailList,
    TriggerPicker,
    type Email,
    type EmailActionType,
    type EmailTemplate,
    type Sequence,
    type SequenceStats,
} from "@sendlit/email-blocks";
import { sequenceStatsMetrics } from "@/lib/stats";

interface SequenceMeta {
    title: string;
    triggerType?: string | null;
    triggerData?: string | null;
}

const MILLIS_IN_DAY = 86400000;

interface EmailDraft {
    subject: string;
    content: Email;
    delayInMillis: number;
    published: boolean;
    actionType?: EmailActionType | null;
    actionData?: Record<string, unknown> | null;
}

const STATUS_VARIANT: Record<
    Sequence["status"],
    "success" | "secondary" | "outline"
> = {
    active: "success",
    draft: "secondary",
    paused: "outline",
    completed: "outline",
};

export default function SequenceEditorPage({
    params,
}: {
    params: Promise<{ sequenceId: string }>;
}) {
    const { sequenceId } = use(params);
    const [sequence, setSequence] = useState<Sequence | null>(null);
    const [meta, setMeta] = useState<SequenceMeta | null>(null);
    const [selectedEmailId, setSelectedEmailId] = useState<string | null>(null);
    const [emailDraft, setEmailDraft] = useState<EmailDraft | null>(null);
    const [stats, setStats] = useState<SequenceStats | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [savingMeta, setSavingMeta] = useState(false);
    const [savingEmail, setSavingEmail] = useState(false);
    const [systemTemplates, setSystemTemplates] = useState<SystemTemplate[]>(
        [],
    );
    const [templates, setTemplates] = useState<EmailTemplate[]>([]);
    const [templatesLoading, setTemplatesLoading] = useState(false);

    async function load(selectId?: string) {
        try {
            const s = await getSequence(sequenceId);
            setSequence(s);
            setMeta({
                title: s.title,
                triggerType: s.triggerType,
                triggerData: s.triggerData,
            });
            const nextSelected =
                s.emails.find(
                    (e) => e.emailId === (selectId ?? selectedEmailId),
                )?.emailId ?? s.emailsOrder[0];
            selectEmail(s, nextSelected);
            if (s.status !== "draft") {
                setStats(await getSequenceStats(sequenceId));
            }
        } catch (err) {
            setError(
                err instanceof ApiError
                    ? err.message
                    : "Failed to load sequence",
            );
        }
    }

    function selectEmail(s: Sequence, emailId?: string) {
        setSelectedEmailId(emailId ?? null);
        const found = s.emails.find((e) => e.emailId === emailId);
        setEmailDraft(
            found
                ? {
                      subject: found.subject,
                      content: found.content,
                      delayInMillis: found.delayInMillis,
                      published: found.published,
                      actionType: found.actionType,
                      actionData: found.actionData,
                  }
                : null,
        );
    }

    useEffect(() => {
        load();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [sequenceId]);

    useEffect(() => {
        setTemplatesLoading(true);
        Promise.all([listSystemTemplates(), listTemplates()])
            .then(([system, own]) => {
                setSystemTemplates(system);
                setTemplates(own);
            })
            .catch((err) =>
                setError(
                    err instanceof ApiError
                        ? err.message
                        : "Failed to load templates",
                ),
            )
            .finally(() => setTemplatesLoading(false));
    }, []);

    async function saveMeta() {
        if (!meta) return;
        setSavingMeta(true);
        setError(null);
        try {
            const updated = await updateSequence(sequenceId, {
                title: meta.title,
                triggerType: meta.triggerType || undefined,
                triggerData: meta.triggerData || undefined,
            });
            setSequence(updated);
        } catch (err) {
            setError(err instanceof ApiError ? err.message : "Failed to save");
        } finally {
            setSavingMeta(false);
        }
    }

    async function saveEmail() {
        if (!selectedEmailId || !emailDraft) return;
        setSavingEmail(true);
        setError(null);
        try {
            // Content is edited on its own full-screen editor route, so this
            // metadata save must not overwrite it.
            const patch: Parameters<typeof updateSequenceEmail>[2] = {
                subject: emailDraft.subject,
                delayInMillis: emailDraft.delayInMillis,
                published: emailDraft.published,
            };
            if (emailDraft.actionType) {
                patch.actionType = emailDraft.actionType;
                patch.actionData = emailDraft.actionData ?? undefined;
            }
            const updated = await updateSequenceEmail(
                sequenceId,
                selectedEmailId,
                patch,
            );
            setSequence(updated);
        } catch (err) {
            setError(
                err instanceof ApiError ? err.message : "Failed to save email",
            );
        } finally {
            setSavingEmail(false);
        }
    }

    async function toggleStatus() {
        if (!sequence) return;
        setError(null);
        try {
            const updated =
                sequence.status === "active"
                    ? await pauseSequence(sequenceId)
                    : await startSequence(sequenceId);
            setSequence(updated);
        } catch (err) {
            setError(err instanceof ApiError ? err.message : "Action failed");
        }
    }

    async function handleDelete(emailId: string) {
        try {
            const updated = await deleteSequenceEmail(sequenceId, emailId);
            setSequence(updated);
            selectEmail(updated, updated.emailsOrder[0]);
        } catch (err) {
            setError(
                err instanceof ApiError
                    ? err.message
                    : "Failed to delete email",
            );
        }
    }

    async function handleReorder(newEmailsOrder: string[]) {
        try {
            const updated = await updateSequence(sequenceId, {
                emailsOrder: newEmailsOrder,
            });
            setSequence(updated);
        } catch (err) {
            setError(
                err instanceof ApiError
                    ? err.message
                    : "Failed to reorder emails",
            );
        }
    }

    if (error && !sequence) return <Banner>{error}</Banner>;
    if (!sequence || !meta)
        return <p className="text-sm text-muted-foreground">Loading…</p>;

    return (
        <ScrollablePage>
            <div className="max-w-5xl">
                <Link
                    href="/dashboard/sequences"
                    className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
                >
                    <ArrowLeft className="size-3.5" />
                    Back to sequences
                </Link>

                <div className="mb-6 flex items-center justify-between gap-4">
                    <div className="flex items-center gap-3">
                        <h1 className="text-2xl font-semibold tracking-tight">
                            {sequence.title || "Untitled sequence"}
                        </h1>
                        <Badge variant={STATUS_VARIANT[sequence.status]}>
                            {sequence.status}
                        </Badge>
                    </div>
                    {sequence.status !== "completed" && (
                        <Button onClick={toggleStatus}>
                            {sequence.status === "active" ? (
                                <Pause className="size-4" />
                            ) : (
                                <Play className="size-4" />
                            )}
                            {sequence.status === "active"
                                ? "Pause"
                                : "Activate"}
                        </Button>
                    )}
                </div>

                {error && <Banner className="mb-4">{error}</Banner>}

                {stats && (
                    <SequenceAnalytics
                        className="mb-6"
                        metrics={sequenceStatsMetrics(stats)}
                    />
                )}

                <div className="mb-6">
                    <Card>
                        <CardHeader className="flex-row items-center justify-between space-y-0">
                            <CardTitle className="text-base">
                                Details &amp; trigger
                            </CardTitle>
                            <Button
                                size="sm"
                                variant="outline"
                                onClick={saveMeta}
                                disabled={savingMeta}
                            >
                                {savingMeta ? "Saving…" : "Save"}
                            </Button>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="space-y-1.5">
                                <Label htmlFor="sequence-title">Title</Label>
                                <Input
                                    id="sequence-title"
                                    value={meta.title}
                                    onChange={(e) =>
                                        setMeta({
                                            ...meta,
                                            title: e.target.value,
                                        })
                                    }
                                    placeholder="e.g. Onboarding drip"
                                />
                            </div>
                            <TriggerPicker
                                triggerType={meta.triggerType}
                                triggerData={meta.triggerData}
                                onChange={({ triggerType, triggerData }) =>
                                    setMeta({
                                        ...meta,
                                        triggerType,
                                        triggerData,
                                    })
                                }
                            />
                        </CardContent>
                    </Card>
                </div>

                <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
                    <div>
                        <h2 className="mb-2 text-sm font-medium text-muted-foreground">
                            Emails
                        </h2>
                        <SequenceEmailList
                            emails={sequence.emails}
                            emailsOrder={sequence.emailsOrder}
                            selectedEmailId={selectedEmailId ?? undefined}
                            onSelect={(emailId) =>
                                selectEmail(sequence, emailId)
                            }
                            onAdd={async (templateId) => {
                                const updated = await addSequenceEmail(
                                    sequenceId,
                                    templateId,
                                );
                                setSequence(updated);
                                selectEmail(
                                    updated,
                                    updated.emailsOrder[
                                        updated.emailsOrder.length - 1
                                    ],
                                );
                            }}
                            onDelete={handleDelete}
                            onReorder={handleReorder}
                            systemTemplates={systemTemplates}
                            templates={templates}
                            templatesLoading={templatesLoading}
                        />
                    </div>

                    <div>
                        {emailDraft ? (
                            <Card>
                                <CardHeader className="flex-row items-center justify-between space-y-0">
                                    <CardTitle className="text-base">
                                        Edit email
                                    </CardTitle>
                                    <Button
                                        size="sm"
                                        onClick={saveEmail}
                                        disabled={savingEmail}
                                    >
                                        {savingEmail ? (
                                            "Saving…"
                                        ) : (
                                            <>
                                                <Check className="size-4" />
                                                Save
                                            </>
                                        )}
                                    </Button>
                                </CardHeader>
                                <CardContent className="flex flex-col gap-4">
                                    <div className="grid gap-4 sm:grid-cols-2">
                                        <div className="space-y-1.5">
                                            <Label htmlFor="email-subject">
                                                Subject
                                            </Label>
                                            <Input
                                                id="email-subject"
                                                value={emailDraft.subject}
                                                onChange={(e) =>
                                                    setEmailDraft({
                                                        ...emailDraft,
                                                        subject: e.target.value,
                                                    })
                                                }
                                                placeholder="Your subject line"
                                            />
                                        </div>
                                        <div className="flex items-center justify-between gap-4 sm:justify-start">
                                            <Label
                                                htmlFor="email-published"
                                                className="flex-1 sm:flex-none"
                                            >
                                                Published
                                            </Label>
                                            <Switch
                                                id="email-published"
                                                checked={emailDraft.published}
                                                onCheckedChange={(published) =>
                                                    setEmailDraft({
                                                        ...emailDraft,
                                                        published,
                                                    })
                                                }
                                            />
                                        </div>
                                    </div>

                                    <div className="grid gap-4 sm:grid-cols-3">
                                        <div className="space-y-1.5">
                                            <Label htmlFor="email-delay">
                                                Send after (days)
                                            </Label>
                                            <Input
                                                id="email-delay"
                                                type="number"
                                                min={0}
                                                value={
                                                    emailDraft.delayInMillis /
                                                    MILLIS_IN_DAY
                                                }
                                                onChange={(e) =>
                                                    setEmailDraft({
                                                        ...emailDraft,
                                                        delayInMillis:
                                                            Number(
                                                                e.target
                                                                    .value || 0,
                                                            ) * MILLIS_IN_DAY,
                                                    })
                                                }
                                            />
                                        </div>
                                        <div className="space-y-1.5">
                                            <Label>On send, tag contact</Label>
                                            <Select
                                                value={
                                                    emailDraft.actionType ??
                                                    "none"
                                                }
                                                onValueChange={(actionType) =>
                                                    setEmailDraft({
                                                        ...emailDraft,
                                                        actionType:
                                                            actionType ===
                                                            "none"
                                                                ? null
                                                                : (actionType as EmailActionType),
                                                    })
                                                }
                                            >
                                                <SelectTrigger className="w-full">
                                                    <SelectValue />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    <SelectItem value="none">
                                                        No action
                                                    </SelectItem>
                                                    <SelectItem value="tag:add">
                                                        Add tag
                                                    </SelectItem>
                                                    <SelectItem value="tag:remove">
                                                        Remove tag
                                                    </SelectItem>
                                                </SelectContent>
                                            </Select>
                                        </div>
                                        {emailDraft.actionType && (
                                            <div className="space-y-1.5">
                                                <Label htmlFor="email-action-data">
                                                    Tag name
                                                </Label>
                                                <Input
                                                    id="email-action-data"
                                                    value={
                                                        (emailDraft.actionData
                                                            ?.tag as string) ??
                                                        ""
                                                    }
                                                    onChange={(e) =>
                                                        setEmailDraft({
                                                            ...emailDraft,
                                                            actionData: {
                                                                tag: e.target
                                                                    .value,
                                                            },
                                                        })
                                                    }
                                                />
                                            </div>
                                        )}
                                    </div>

                                    <div className="space-y-1.5">
                                        <div className="flex items-center justify-between">
                                            <Label>Content</Label>
                                            <Button
                                                size="sm"
                                                variant="outline"
                                                asChild
                                            >
                                                <Link
                                                    href={`/editor/sequences/${sequenceId}/emails/${selectedEmailId}`}
                                                >
                                                    <Pencil className="size-4" />
                                                    Edit content
                                                </Link>
                                            </Button>
                                        </div>
                                        <EmailPreview
                                            content={emailDraft.content}
                                            minHeight="420px"
                                        />
                                    </div>
                                </CardContent>
                            </Card>
                        ) : (
                            <Card>
                                <CardContent className="p-6 text-sm text-muted-foreground">
                                    Select or add an email to edit its content.
                                </CardContent>
                            </Card>
                        )}
                    </div>
                </div>
            </div>
        </ScrollablePage>
    );
}
