"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Check, Pause, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Banner } from "@/components/dashboard/banner";
import { ScrollablePage } from "@/components/dashboard/scrollable-page";
import { ApiError } from "@/lib/api-client";
import {
    getSequence,
    getSequenceStats,
    pauseSequence,
    startSequence,
    updateSequence,
    updateSequenceEmail,
} from "@/lib/api";
import {
    SequenceEmailForm,
    SequenceMetaForm,
    type Sequence,
    type SequenceEmailFormValue,
    type SequenceMetaFormValue,
    type SequenceStats,
} from "@sendlit/email-blocks";

const STATUS_VARIANT: Record<Sequence["status"], "success" | "secondary" | "outline"> = {
    active: "success",
    draft: "secondary",
    paused: "outline",
    completed: "outline",
};

export default function BroadcastEditorPage({
    params,
}: {
    params: Promise<{ sequenceId: string }>;
}) {
    const { sequenceId } = use(params);
    const [sequence, setSequence] = useState<Sequence | null>(null);
    const [meta, setMeta] = useState<SequenceMetaFormValue | null>(null);
    const [email, setEmail] = useState<SequenceEmailFormValue | null>(null);
    const [stats, setStats] = useState<SequenceStats | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);

    async function load() {
        try {
            const s = await getSequence(sequenceId);
            setSequence(s);
            setMeta({
                title: s.title,
                fromName: s.fromName,
                fromEmail: s.fromEmail,
                filter: s.filter,
            });
            const firstEmail = s.emails[0];
            if (firstEmail) {
                setEmail({
                    subject: firstEmail.subject,
                    content: firstEmail.content,
                    delayInMillis: firstEmail.delayInMillis,
                    published: firstEmail.published,
                });
            }
            if (s.status !== "draft") {
                setStats(await getSequenceStats(sequenceId));
            }
        } catch (err) {
            setError(err instanceof ApiError ? err.message : "Failed to load broadcast");
        }
    }

    useEffect(() => {
        load();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [sequenceId]);

    async function save() {
        if (!sequence || !meta || !email) return;
        setSaving(true);
        setError(null);
        try {
            const updated = await updateSequence(sequenceId, {
                title: meta.title,
                fromName: meta.fromName || undefined,
                fromEmail: meta.fromEmail || undefined,
                filter: meta.filter || undefined,
            });
            const firstEmail = updated.emails[0];
            const withEmail = firstEmail
                ? await updateSequenceEmail(sequenceId, firstEmail.emailId, {
                      subject: email.subject,
                      content: email.content,
                      published: email.published,
                  })
                : updated;
            setSequence(withEmail);
            setSaved(true);
            setTimeout(() => setSaved(false), 2000);
        } catch (err) {
            setError(err instanceof ApiError ? err.message : "Failed to save");
        } finally {
            setSaving(false);
        }
    }

    async function toggleStatus() {
        if (!sequence) return;
        setError(null);
        try {
            await save();
            const updated =
                sequence.status === "active"
                    ? await pauseSequence(sequenceId)
                    : await startSequence(sequenceId);
            setSequence(updated);
        } catch (err) {
            setError(err instanceof ApiError ? err.message : "Action failed");
        }
    }

    if (error && !sequence) return <Banner>{error}</Banner>;
    if (!sequence || !meta || !email) {
        return <p className="text-sm text-muted-foreground">Loading…</p>;
    }

    return (
        <ScrollablePage>
        <div className="max-w-3xl">
            <Link
                href="/dashboard/broadcasts"
                className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
            >
                <ArrowLeft className="size-3.5" />
                Back to broadcasts
            </Link>

            <div className="mb-6 flex items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                    <h1 className="text-2xl font-semibold tracking-tight">
                        {sequence.title || "Untitled broadcast"}
                    </h1>
                    <Badge variant={STATUS_VARIANT[sequence.status]}>{sequence.status}</Badge>
                </div>
                <div className="flex gap-2">
                    <Button variant="outline" onClick={save} disabled={saving}>
                        {saved ? <Check className="size-4" /> : null}
                        {saved ? "Saved" : saving ? "Saving…" : "Save"}
                    </Button>
                    {sequence.status !== "completed" && (
                        <Button onClick={toggleStatus}>
                            {sequence.status === "active" ? (
                                <Pause className="size-4" />
                            ) : (
                                <Play className="size-4" />
                            )}
                            {sequence.status === "active" ? "Pause" : "Start"}
                        </Button>
                    )}
                </div>
            </div>

            {error && <Banner className="mb-4">{error}</Banner>}

            {stats && (
                <div className="mb-6 grid grid-cols-4 gap-4">
                    <StatCard label="Sent" value={stats.sent} />
                    <StatCard label="Recipients" value={stats.subscribersCount} />
                    <StatCard
                        label="Open rate"
                        value={`${Math.round(stats.openRate * 100)}%`}
                    />
                    <StatCard
                        label="Click rate"
                        value={`${Math.round(stats.clickThroughRate * 100)}%`}
                    />
                </div>
            )}

            <div className="space-y-6">
                <Card>
                    <CardHeader>
                        <CardTitle className="text-base">Sender &amp; audience</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <SequenceMetaForm type="broadcast" value={meta} onChange={setMeta} />
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader>
                        <CardTitle className="text-base">Content</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <SequenceEmailForm value={email} onChange={setEmail} variant="broadcast" />
                    </CardContent>
                </Card>
            </div>
        </div>
        </ScrollablePage>
    );
}

function StatCard({ label, value }: { label: string; value: string | number }) {
    return (
        <Card>
            <CardContent className="p-4">
                <p className="text-xs text-muted-foreground">{label}</p>
                <p className="text-xl font-semibold">{value}</p>
            </CardContent>
        </Card>
    );
}
