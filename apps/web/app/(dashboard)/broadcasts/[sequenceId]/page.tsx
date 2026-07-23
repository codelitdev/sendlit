"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { CalendarClock, Check, Pencil, Send, X } from "lucide-react";
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
import { EspPicker } from "@/components/dashboard/esp-picker";
import { ApiError } from "@/lib/api-client";
import { broadcastScheduledFor, presentBroadcastStatus } from "@/lib/broadcast";
import {
    getSequence,
    getSequenceStats,
    listContacts,
    listEsps,
    pauseSequence,
    startSequence,
    updateSequence,
    updateSequenceEmail,
    type EspConfig,
} from "@/lib/api";
import { useSegments } from "@/lib/use-segments";
import {
    ContactFilterBuilder,
    EmailPreview,
    SequenceAnalytics,
    type ContactFilterWithAggregator,
    type Email,
    type Sequence,
    type SequenceStats,
} from "@sendlit/email-blocks";
import { sequenceStatsMetrics } from "@/lib/stats";
import { useSetBreadcrumb } from "@/components/dashboard/breadcrumb-context";

interface BroadcastMeta {
    title: string;
    filter?: ContactFilterWithAggregator | null;
    espId?: string | null;
}

interface BroadcastEmailDraft {
    content: Email;
    delayInMillis: number;
}

const emptyFilter: ContactFilterWithAggregator = {
    aggregator: "or",
    filters: [],
};

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
    const [meta, setMeta] = useState<BroadcastMeta | null>(null);
    const [email, setEmail] = useState<BroadcastEmailDraft | null>(null);
    const [stats, setStats] = useState<SequenceStats | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);
    const [confirmSendOpen, setConfirmSendOpen] = useState(false);
    const [scheduleOpen, setScheduleOpen] = useState(false);
    const [scheduleAt, setScheduleAt] = useState("");
    const [working, setWorking] = useState(false);
    const [audienceCount, setAudienceCount] = useState<number>();
    const [esps, setEsps] = useState<EspConfig[]>([]);
    const { segmentProps, clearSelection } = useSegments(setError);

    useSetBreadcrumb([
        { label: "Broadcasts", href: "/broadcasts" },
        { label: sequence?.title || "Untitled broadcast" },
    ]);

    useEffect(() => {
        listEsps()
            .then(({ items }) => setEsps(items))
            .catch(() => {});
    }, []);

    async function load() {
        try {
            const s = await getSequence(sequenceId);
            setSequence(s);
            setMeta({
                title: s.title,
                filter: s.filter,
                espId: s.espId,
            });
            const firstEmail = s.emails[0];
            if (firstEmail) {
                setEmail({
                    content: firstEmail.content,
                    delayInMillis: firstEmail.delayInMillis,
                });
            }
            if (s.status !== "draft") {
                setStats(await getSequenceStats(sequenceId));
            }
        } catch (err) {
            setError(
                err instanceof ApiError
                    ? err.message
                    : "Failed to load broadcast",
            );
        }
    }

    useEffect(() => {
        load();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [sequenceId]);

    // Live "how many contacts match this audience" count, matching what the
    // send will actually target (`listContacts` and the sender share the same
    // filter semantics).
    // Undefined until the broadcast loads so the effect re-fires even when the
    // loaded filter serializes the same as "no meta yet".
    const filterKey = meta ? JSON.stringify(meta.filter ?? null) : undefined;
    useEffect(() => {
        if (!meta) return;
        let stale = false;
        const filter = meta.filter;
        listContacts({
            filter: filter && filter.filters.length > 0 ? filter : undefined,
        })
            .then(({ total }) => {
                if (!stale) setAudienceCount(total);
            })
            .catch(() => {
                if (!stale) setAudienceCount(undefined);
            });
        return () => {
            stale = true;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [filterKey]);

    /** Persists the meta + email forms; `sendAtMillis` also stamps the
     * broadcast's absolute send time (emails[0].delayInMillis). */
    async function save(sendAtMillis?: number) {
        if (!sequence || !meta || !email) return;
        setSaving(true);
        setError(null);
        try {
            // The API only accepts an ESP change while draft/paused (an
            // active/completed broadcast has already pinned its ESP).
            const espEditable =
                sequence.status === "draft" || sequence.status === "paused";
            const updated = await updateSequence(sequenceId, {
                title: meta.title,
                filter: meta.filter || undefined,
                ...(espEditable ? { espId: meta.espId ?? null } : {}),
            });
            const firstEmail = updated.emails[0];
            // Content is edited on its own full-screen editor route, so this
            // metadata save must not overwrite it. Subject and published are
            // derived server-side from the broadcast's title/type, so only
            // the send time needs to be pushed here.
            const withEmail =
                firstEmail && sendAtMillis !== undefined
                    ? await updateSequenceEmail(
                          sequenceId,
                          firstEmail.emailId,
                          {
                              delayInMillis: sendAtMillis,
                          },
                      )
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
    const editable =
        sequence.status === "draft" || sequence.status === "paused";

    return (
        <ScrollablePage>
            <div>
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
                                <Button
                                    variant="outline"
                                    onClick={() => save()}
                                    disabled={saving}
                                >
                                    {saved ? (
                                        <Check className="size-4" />
                                    ) : null}
                                    {saved
                                        ? "Saved"
                                        : saving
                                          ? "Saving…"
                                          : "Save"}
                                </Button>
                                <Button
                                    variant="outline"
                                    onClick={openSchedule}
                                    disabled={working}
                                >
                                    <CalendarClock className="size-4" />
                                    Schedule
                                </Button>
                                <Button
                                    onClick={() => setConfirmSendOpen(true)}
                                    disabled={working}
                                >
                                    <Send className="size-4" />
                                    Send now
                                </Button>
                            </>
                        )}
                    </div>
                </div>

                {error && <Banner className="mb-4">{error}</Banner>}

                {scheduledForLabel && (
                    <Banner
                        variant="success"
                        className="mb-4 flex items-center justify-between gap-3"
                    >
                        <span className="inline-flex items-center gap-1.5">
                            <CalendarClock className="size-4" />
                            Scheduled for {scheduledForLabel}
                        </span>
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={cancelSchedule}
                            disabled={working}
                        >
                            <X className="size-4" />
                            Cancel
                        </Button>
                    </Banner>
                )}

                {stats && (
                    <SequenceAnalytics
                        className="mb-6"
                        metrics={sequenceStatsMetrics(stats)}
                    />
                )}

                <div className="space-y-6">
                    <Card>
                        <CardHeader>
                            <CardTitle className="text-base">
                                Details &amp; audience
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="space-y-1.5">
                                <Label htmlFor="broadcast-title">Title</Label>
                                <Input
                                    id="broadcast-title"
                                    value={meta.title}
                                    onChange={(e) =>
                                        setMeta({
                                            ...meta,
                                            title: e.target.value,
                                        })
                                    }
                                    placeholder="e.g. October newsletter"
                                />
                            </div>
                            {esps.length > 1 && (
                                <div className="space-y-1.5">
                                    <Label>Sending ESP</Label>
                                    <EspPicker
                                        esps={esps}
                                        value={meta.espId}
                                        onChange={(espId) =>
                                            setMeta({ ...meta, espId })
                                        }
                                        disabled={!editable}
                                    />
                                </div>
                            )}
                            <div className="space-y-1.5">
                                <Label>Audience</Label>
                                <ContactFilterBuilder
                                    value={meta.filter ?? emptyFilter}
                                    onChange={(filter) => {
                                        setMeta({ ...meta, filter });
                                        clearSelection();
                                    }}
                                    disabled={!editable}
                                    {...segmentProps}
                                    count={audienceCount}
                                    countLabel="recipients"
                                />
                            </div>
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader className="flex-row items-center justify-between">
                            <CardTitle className="text-base">Content</CardTitle>
                            {editable && (
                                <Button size="sm" variant="outline" asChild>
                                    <Link
                                        href={`/editor/broadcasts/${sequenceId}`}
                                    >
                                        <Pencil className="size-4" />
                                        Edit content
                                    </Link>
                                </Button>
                            )}
                        </CardHeader>
                        <CardContent>
                            <EmailPreview
                                content={email.content}
                                minHeight="420px"
                            />
                        </CardContent>
                    </Card>
                </div>

                <Dialog
                    open={confirmSendOpen}
                    onOpenChange={setConfirmSendOpen}
                >
                    <DialogContent>
                        <DialogHeader>
                            <DialogTitle>Send broadcast</DialogTitle>
                            <DialogDescription>
                                Your changes will be saved and the email will go
                                out to every contact matching the audience
                                filter. This can&apos;t be undone.
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
                            <Button
                                onClick={() => startAt(Date.now())}
                                disabled={working}
                            >
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
                                Your changes will be saved and the email will go
                                out to every contact matching the audience
                                filter at the chosen time. You can cancel any
                                time before it sends.
                            </DialogDescription>
                        </DialogHeader>
                        <div className="space-y-2">
                            <Label htmlFor="broadcast-schedule-at">
                                Send at
                            </Label>
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
                            <Button
                                onClick={confirmSchedule}
                                disabled={working}
                            >
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
