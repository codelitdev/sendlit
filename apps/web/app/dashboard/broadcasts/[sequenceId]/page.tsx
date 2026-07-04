"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, CalendarClock, Check, Send, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Banner } from "@/components/dashboard/banner";
import { ScrollablePage } from "@/components/dashboard/scrollable-page";
import { ApiError } from "@/lib/api-client";
import { broadcastScheduledFor, presentBroadcastStatus } from "@/lib/broadcast";
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

/** Local-timezone value for a `datetime-local` input. */
function toLocalInputValue(date: Date): string {
    return new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
        .toISOString()
        .slice(0, 16);
}

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
    const [confirmSendOpen, setConfirmSendOpen] = useState(false);
    const [scheduleOpen, setScheduleOpen] = useState(false);
    const [scheduleAt, setScheduleAt] = useState("");
    const [working, setWorking] = useState(false);

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

    /** Persists the meta + email forms; `sendAtMillis` also stamps the
     * broadcast's absolute send time (emails[0].delayInMillis). */
    async function save(sendAtMillis?: number) {
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
                      ...(sendAtMillis !== undefined
                          ? { delayInMillis: sendAtMillis }
                          : {}),
                  })
                : updated;
            setSequence(withEmail);
            if (sendAtMillis !== undefined) {
                setEmail({ ...email, delayInMillis: sendAtMillis });
            }
            setSaved(true);
            setTimeout(() => setSaved(false), 2000);
        } catch (err) {
            setError(err instanceof ApiError ? err.message : "Failed to save");
            throw err;
        } finally {
            setSaving(false);
        }
    }

    async function startAt(sendAtMillis: number) {
        setWorking(true);
        setError(null);
        try {
            await save(sendAtMillis);
            const updated = await startSequence(sequenceId);
            setSequence(updated);
            setConfirmSendOpen(false);
            setScheduleOpen(false);
        } catch (err) {
            setError(err instanceof ApiError ? err.message : "Action failed");
        } finally {
            setWorking(false);
        }
    }

    async function cancelSchedule() {
        setWorking(true);
        setError(null);
        try {
            const updated = await pauseSequence(sequenceId);
            setSequence(updated);
        } catch (err) {
            setError(err instanceof ApiError ? err.message : "Action failed");
        } finally {
            setWorking(false);
        }
    }

    function openSchedule() {
        setScheduleAt(toLocalInputValue(new Date(Date.now() + 60 * 60_000)));
        setScheduleOpen(true);
    }

    function confirmSchedule() {
        const at = new Date(scheduleAt).getTime();
        if (!scheduleAt || Number.isNaN(at)) {
            setError("Pick a valid date and time");
            return;
        }
        if (at <= Date.now()) {
            setError("The scheduled time must be in the future");
            return;
        }
        startAt(at);
    }

    if (error && !sequence) return <Banner>{error}</Banner>;
    if (!sequence || !meta || !email) {
        return <p className="text-sm text-muted-foreground">Loading…</p>;
    }

    const status = presentBroadcastStatus(sequence);
    const scheduledFor = broadcastScheduledFor(sequence);
    const scheduledForLabel = scheduledFor?.toLocaleString();
    const editable = sequence.status === "draft" || sequence.status === "paused";

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

            <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex min-w-0 items-center gap-3">
                    <h1 className="text-2xl font-semibold tracking-tight">
                        {sequence.title || "Untitled broadcast"}
                    </h1>
                    <Badge variant={status.variant}>{status.label}</Badge>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    {editable && (
                        <>
                            <Button variant="outline" onClick={() => save()} disabled={saving}>
                                {saved ? <Check className="size-4" /> : null}
                                {saved ? "Saved" : saving ? "Saving…" : "Save"}
                            </Button>
                            <Button variant="outline" onClick={openSchedule} disabled={working}>
                                <CalendarClock className="size-4" />
                                Schedule
                            </Button>
                            <Button onClick={() => setConfirmSendOpen(true)} disabled={working}>
                                <Send className="size-4" />
                                Send now
                            </Button>
                        </>
                    )}
                </div>
            </div>

            {error && <Banner className="mb-4">{error}</Banner>}

            {scheduledForLabel && (
                <Banner variant="success" className="mb-4 flex items-center justify-between gap-3">
                    <span className="inline-flex items-center gap-1.5">
                        <CalendarClock className="size-4" />
                        Scheduled for {scheduledForLabel}
                    </span>
                    <Button variant="outline" size="sm" onClick={cancelSchedule} disabled={working}>
                        <X className="size-4" />
                        Cancel
                    </Button>
                </Banner>
            )}

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

            <Dialog open={confirmSendOpen} onOpenChange={setConfirmSendOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Send broadcast</DialogTitle>
                        <DialogDescription>
                            Your changes will be saved and the email will go out to
                            every contact matching the audience filter. This can&apos;t
                            be undone.
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                        <Button
                            variant="outline"
                            onClick={() => setConfirmSendOpen(false)}
                            disabled={working}
                        >
                            Cancel
                        </Button>
                        <Button onClick={() => startAt(Date.now())} disabled={working}>
                            <Send className="size-4" />
                            {working ? "Sending…" : "Send now"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <Dialog open={scheduleOpen} onOpenChange={setScheduleOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Schedule broadcast</DialogTitle>
                        <DialogDescription>
                            Your changes will be saved and the email will go out to
                            every contact matching the audience filter at the chosen
                            time. You can cancel any time before it sends.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-2">
                        <Label htmlFor="broadcast-schedule-at">Send at</Label>
                        <Input
                            id="broadcast-schedule-at"
                            type="datetime-local"
                            value={scheduleAt}
                            min={toLocalInputValue(new Date())}
                            onChange={(e) => setScheduleAt(e.target.value)}
                        />
                    </div>
                    <DialogFooter>
                        <Button
                            variant="outline"
                            onClick={() => setScheduleOpen(false)}
                            disabled={working}
                        >
                            Cancel
                        </Button>
                        <Button onClick={confirmSchedule} disabled={working}>
                            <CalendarClock className="size-4" />
                            {working ? "Scheduling…" : "Schedule"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
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
