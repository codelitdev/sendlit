"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { PageHeader } from "@/components/dashboard/page-header";
import { Banner } from "@/components/dashboard/banner";
import { ScrollablePage } from "@/components/dashboard/scrollable-page";
import { ApiError } from "@/lib/api-client";
import { listTransactionalEmails, type TransactionalEmail } from "@/lib/api";

const PAGE_SIZE = 20;

const STATUS_OPTIONS: { value: string; label: string }[] = [
    { value: "all", label: "All statuses" },
    { value: "queued", label: "Queued" },
    { value: "sent", label: "Sent" },
    { value: "failed", label: "Failed" },
    { value: "bounced", label: "Bounced" },
];

const STATUS_BADGE_VARIANT: Record<
    TransactionalEmail["status"],
    "success" | "secondary" | "destructive"
> = {
    sent: "success",
    queued: "secondary",
    failed: "destructive",
    bounced: "destructive",
};

function formatSentDate(item: TransactionalEmail) {
    const value = item.sentAt || item.createdAt;
    return value ? new Date(value).toLocaleString() : "—";
}

export default function TransactionalPage() {
    const [items, setItems] = useState<TransactionalEmail[] | null>(null);
    const [total, setTotal] = useState(0);
    const [page, setPage] = useState(1);
    const [status, setStatus] = useState("all");
    const [error, setError] = useState<string | null>(null);
    const [loadingMore, setLoadingMore] = useState(false);

    // Fetches the first `pageCount` pages worth of items in one request
    // (rather than appending page-by-page), matching the media page's
    // pagination pattern.
    async function loadRange(statusFilter: string, pageCount: number) {
        return listTransactionalEmails({
            status:
                statusFilter === "all"
                    ? undefined
                    : (statusFilter as TransactionalEmail["status"]),
            offset: 1,
            itemsPerPage: PAGE_SIZE * pageCount,
        });
    }

    async function load(statusFilter = status) {
        setError(null);
        try {
            const result = await loadRange(statusFilter, 1);
            setItems(result.items);
            setTotal(result.total);
            setPage(1);
        } catch (err) {
            setError(
                err instanceof ApiError
                    ? err.message
                    : "Failed to load transactional emails",
            );
        }
    }

    async function loadMore() {
        if (loadingMore) return;
        setLoadingMore(true);
        setError(null);
        try {
            const nextPage = page + 1;
            const result = await loadRange(status, nextPage);
            setItems(result.items);
            setTotal(result.total);
            setPage(nextPage);
        } catch (err) {
            setError(
                err instanceof ApiError
                    ? err.message
                    : "Failed to load more transactional emails",
            );
        } finally {
            setLoadingMore(false);
        }
    }

    useEffect(() => {
        void load(status);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [status]);

    return (
        <ScrollablePage>
            <PageHeader
                title="Transactional"
                description="Read-only activity log of API-triggered emails — receipts, password resets, and other one-off sends."
                action={
                    <Select
                        value={status}
                        onValueChange={(value) => setStatus(value)}
                    >
                        <SelectTrigger className="w-40">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            {STATUS_OPTIONS.map((option) => (
                                <SelectItem
                                    key={option.value}
                                    value={option.value}
                                >
                                    {option.label}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
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
                            {status === "all"
                                ? "No transactional emails sent yet."
                                : "No transactional emails match this filter."}
                        </p>
                    ) : (
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="border-b text-left text-muted-foreground">
                                    <th className="px-4 py-3 font-medium">
                                        To
                                    </th>
                                    <th className="px-4 py-3 font-medium">
                                        Subject
                                    </th>
                                    <th className="px-4 py-3 font-medium">
                                        Status
                                    </th>
                                    <th className="px-4 py-3 font-medium">
                                        Sent
                                    </th>
                                </tr>
                            </thead>
                            <tbody>
                                {items.map((item) => (
                                    <tr
                                        key={item.txeId}
                                        className="border-b last:border-0"
                                    >
                                        <td className="px-4 py-3">
                                            <Link
                                                href={`/dashboard/transactional/${item.txeId}`}
                                                className="font-medium hover:underline"
                                            >
                                                {item.to}
                                            </Link>
                                        </td>
                                        <td className="px-4 py-3 text-muted-foreground">
                                            {item.subject}
                                        </td>
                                        <td className="px-4 py-3">
                                            <Badge
                                                variant={
                                                    STATUS_BADGE_VARIANT[
                                                        item.status
                                                    ]
                                                }
                                            >
                                                {item.status}
                                            </Badge>
                                        </td>
                                        <td className="px-4 py-3 text-muted-foreground">
                                            {formatSentDate(item)}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
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
        </ScrollablePage>
    );
}
