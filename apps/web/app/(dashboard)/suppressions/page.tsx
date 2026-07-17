"use client";

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { PageHeader } from "@/components/dashboard/page-header";
import { Banner } from "@/components/dashboard/banner";
import { ScrollablePage } from "@/components/dashboard/scrollable-page";
import { ApiError } from "@/lib/api-client";
import {
    isSuppressionOwnerReleasable,
    listSuppressions,
    releaseSuppression,
    type Suppression,
    type SuppressionReason,
} from "@/lib/api";

const PAGE_SIZE = 25;

const REASON_OPTIONS: { value: string; label: string }[] = [
    { value: "all", label: "All reasons" },
    { value: "hard_bounce", label: "Hard bounce" },
    { value: "complaint", label: "Spam complaint" },
    { value: "repeated_soft_bounce", label: "Repeated soft bounce" },
    { value: "provider_suppression", label: "Provider suppression" },
    { value: "manual", label: "Manual" },
];

const REASON_LABEL: Record<SuppressionReason, string> = {
    hard_bounce: "Hard bounce",
    complaint: "Spam complaint",
    repeated_soft_bounce: "Repeated soft bounce",
    provider_suppression: "Provider suppression",
    manual: "Manual",
};

const REASON_BADGE_VARIANT: Record<
    SuppressionReason,
    "destructive" | "secondary" | "outline"
> = {
    hard_bounce: "destructive",
    complaint: "destructive",
    repeated_soft_bounce: "secondary",
    provider_suppression: "secondary",
    manual: "outline",
};

export default function SuppressionsPage() {
    const [items, setItems] = useState<Suppression[] | null>(null);
    const [total, setTotal] = useState(0);
    const [page, setPage] = useState(1);
    const [reason, setReason] = useState("all");
    const [activeOnly, setActiveOnly] = useState("active");
    const [error, setError] = useState<string | null>(null);
    const [loadingMore, setLoadingMore] = useState(false);
    const [releasingId, setReleasingId] = useState<string | null>(null);
    const [releaseTarget, setReleaseTarget] = useState<Suppression | null>(
        null,
    );
    const [releaseNote, setReleaseNote] = useState("");

    async function loadRange(
        reasonFilter: string,
        activeFilter: string,
        pageCount: number,
    ) {
        return listSuppressions({
            reason:
                reasonFilter === "all"
                    ? undefined
                    : (reasonFilter as SuppressionReason),
            active:
                activeFilter === "all" ? undefined : activeFilter === "active",
            offset: 1,
            itemsPerPage: PAGE_SIZE * pageCount,
        });
    }

    async function load() {
        setError(null);
        try {
            const result = await loadRange(reason, activeOnly, 1);
            setItems(result.items);
            setTotal(result.total);
            setPage(1);
        } catch (err) {
            setError(
                err instanceof ApiError
                    ? err.message
                    : "Failed to load suppressions",
            );
        }
    }

    async function loadMore() {
        if (loadingMore) return;
        setLoadingMore(true);
        setError(null);
        try {
            const nextPage = page + 1;
            const result = await loadRange(reason, activeOnly, nextPage);
            setItems(result.items);
            setTotal(result.total);
            setPage(nextPage);
        } catch (err) {
            setError(
                err instanceof ApiError
                    ? err.message
                    : "Failed to load more suppressions",
            );
        } finally {
            setLoadingMore(false);
        }
    }

    useEffect(() => {
        void load();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [reason, activeOnly]);

    function handleRelease(suppression: Suppression) {
        if (!isSuppressionOwnerReleasable(suppression.reason)) return;
        setReleaseNote("");
        setReleaseTarget(suppression);
    }

    async function confirmRelease() {
        if (!releaseTarget) return;
        setReleasingId(releaseTarget.suppressionId);
        setError(null);
        try {
            await releaseSuppression(
                releaseTarget.suppressionId,
                releaseNote.trim() || undefined,
            );
            setReleaseTarget(null);
            await load();
        } catch (err) {
            setError(
                err instanceof ApiError
                    ? err.message
                    : "Failed to release suppression",
            );
        } finally {
            setReleasingId(null);
        }
    }

    return (
        <ScrollablePage>
            <PageHeader
                title="Suppressions"
                description="Addresses that hard-bounced or complained. Suppressed recipients are blocked from every future campaign and transactional send for this workspace, regardless of ESP or contact status."
                action={
                    <div className="flex gap-2">
                        <Select
                            value={activeOnly}
                            onValueChange={setActiveOnly}
                        >
                            <SelectTrigger className="w-32">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="active">Active</SelectItem>
                                <SelectItem value="all">All</SelectItem>
                                <SelectItem value="released">
                                    Released
                                </SelectItem>
                            </SelectContent>
                        </Select>
                        <Select value={reason} onValueChange={setReason}>
                            <SelectTrigger className="w-48">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                {REASON_OPTIONS.map((option) => (
                                    <SelectItem
                                        key={option.value}
                                        value={option.value}
                                    >
                                        {option.label}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                }
            />

            {error && <Banner className="mb-4">{error}</Banner>}

            <Card>
                <CardContent className="p-0">
                    {items === null ? (
                        <p className="p-6 text-sm text-muted-foreground">
                            Loading…
                        </p>
                    ) : items.length === 0 ? (
                        <p className="p-6 text-sm text-muted-foreground">
                            No suppressions match this filter.
                        </p>
                    ) : (
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Recipient</TableHead>
                                    <TableHead>Reason</TableHead>
                                    <TableHead>Status</TableHead>
                                    <TableHead>Last signal</TableHead>
                                    <TableHead />
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {items.map((item) => (
                                    <TableRow key={item.suppressionId}>
                                        <TableCell className="font-medium">
                                            {item.recipientEmail ?? (
                                                <span className="text-muted-foreground">
                                                    (erased)
                                                </span>
                                            )}
                                        </TableCell>
                                        <TableCell>
                                            <Badge
                                                variant={
                                                    REASON_BADGE_VARIANT[
                                                        item.reason
                                                    ]
                                                }
                                            >
                                                {REASON_LABEL[item.reason]}
                                            </Badge>
                                        </TableCell>
                                        <TableCell>
                                            {item.active ? (
                                                <Badge variant="destructive">
                                                    Suppressed
                                                </Badge>
                                            ) : (
                                                <Badge variant="outline">
                                                    Released
                                                </Badge>
                                            )}
                                        </TableCell>
                                        <TableCell className="text-muted-foreground">
                                            {new Date(
                                                item.lastSuppressedAt,
                                            ).toLocaleString()}
                                        </TableCell>
                                        <TableCell className="text-right">
                                            {item.active &&
                                                (isSuppressionOwnerReleasable(
                                                    item.reason,
                                                ) ? (
                                                    <Button
                                                        variant="outline"
                                                        size="sm"
                                                        disabled={
                                                            releasingId ===
                                                            item.suppressionId
                                                        }
                                                        onClick={() =>
                                                            handleRelease(item)
                                                        }
                                                    >
                                                        {releasingId ===
                                                        item.suppressionId
                                                            ? "Releasing…"
                                                            : "Release"}
                                                    </Button>
                                                ) : (
                                                    <span
                                                        className="text-xs text-muted-foreground"
                                                        title="Complaint suppressions can only be released by a SendLit operator."
                                                    >
                                                        Not releasable
                                                    </span>
                                                ))}
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    )}
                </CardContent>
            </Card>

            {items !== null && items.length < total && (
                <div className="mt-4 flex flex-col items-center gap-2">
                    <p className="text-xs text-muted-foreground">
                        Showing {items.length} of {total}
                    </p>
                    <Button
                        type="button"
                        variant="outline"
                        disabled={loadingMore}
                        onClick={() => void loadMore()}
                    >
                        {loadingMore ? "Loading..." : "Load more"}
                    </Button>
                </div>
            )}

            <AlertDialog
                open={releaseTarget !== null}
                onOpenChange={(open: boolean) => {
                    if (!open) setReleaseTarget(null);
                }}
            >
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>
                            Release suppression?
                        </AlertDialogTitle>
                        <AlertDialogDescription>
                            Release suppression for{" "}
                            {releaseTarget?.recipientEmail ?? "this address"}?
                            Only do this after confirming the address was
                            corrected — a new bounce/complaint re-suppresses it
                            immediately.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <div className="grid gap-1.5">
                        <Label htmlFor="release-note">
                            Note for the audit log (optional)
                        </Label>
                        <Textarea
                            id="release-note"
                            value={releaseNote}
                            onChange={(e) => setReleaseNote(e.target.value)}
                            placeholder="Why is this being released?"
                            rows={3}
                        />
                    </div>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                            disabled={releasingId !== null}
                            onClick={(e) => {
                                e.preventDefault();
                                void confirmRelease();
                            }}
                        >
                            {releasingId !== null ? "Releasing…" : "Release"}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </ScrollablePage>
    );
}
