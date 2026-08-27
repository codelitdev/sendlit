"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Pause, Play } from "lucide-react";
import { IconButton } from "@/components/ui/codelit/icon-button";
import { Badge } from "@/components/ui/codelit/badge";
import { Card, CardContent } from "@/components/ui/codelit/card";
import { PageHeader } from "@/components/dashboard/page-header";
import { Banner } from "@/components/dashboard/banner";
import { SendErrorMessage } from "@/components/dashboard/send-error-message";
import { Loading } from "@/components/dashboard/loading";
import { ScrollablePage } from "@/components/dashboard/scrollable-page";
import { NewSequenceDialog } from "@/components/dashboard/new-sequence-dialog";
import { ListPagination } from "@/components/dashboard/list-pagination";
import { useSetBreadcrumb } from "@/components/dashboard/breadcrumb-context";
import { ApiError } from "@/lib/api-client";
import { presentBroadcastStatus } from "@/lib/broadcast";
import { ITEMS_PER_PAGE } from "@/lib/pagination";
import { listSequences, pauseSequence, startSequence } from "@/lib/api";
import type { MailType, Sequence } from "@sendlit/email-blocks";

const STATUS_VARIANT: Record<
    Sequence["status"],
    "success" | "neutral" | "outline"
> = {
    active: "success",
    draft: "neutral",
    paused: "outline",
    completed: "outline",
};

export function SequenceListPage({
    type,
    title,
    description,
    createLabel,
    basePath,
}: {
    type: MailType;
    title: string;
    description: string;
    createLabel: string;
    basePath: string;
}) {
    const router = useRouter();
    const [sequences, setSequences] = useState<Sequence[] | null>(null);
    const [total, setTotal] = useState(0);
    const [page, setPage] = useState(1);
    const [error, setError] = useState<string | null>(null);
    const [loadingPage, setLoadingPage] = useState(false);

    useSetBreadcrumb([{ label: title }]);

    async function load(pageToLoad = 1) {
        setLoadingPage(true);
        try {
            const result = await listSequences(type, {
                offset: pageToLoad,
                itemsPerPage: ITEMS_PER_PAGE,
            });
            setSequences(result.items);
            setTotal(result.total);
            setPage(pageToLoad);
        } catch (err) {
            setError(err instanceof ApiError ? err.message : "Failed to load");
        } finally {
            setLoadingPage(false);
        }
    }

    useEffect(() => {
        load();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [type]);

    async function toggle(sequence: Sequence) {
        try {
            if (sequence.status === "active") {
                await pauseSequence(sequence.sequenceId);
            } else {
                await startSequence(sequence.sequenceId);
            }
            load();
        } catch (err) {
            setError(err instanceof ApiError ? err.message : "Action failed");
        }
    }

    return (
        <ScrollablePage>
            <PageHeader
                title={title}
                description={description}
                action={
                    <NewSequenceDialog
                        type={type}
                        label={createLabel}
                        onCreated={(sequenceId) =>
                            router.push(`${basePath}/${sequenceId}`)
                        }
                    />
                }
            />

            {error && (
                <Banner className="mb-4">
                    <SendErrorMessage error={error} />
                </Banner>
            )}

            {sequences === null ? (
                <Loading />
            ) : sequences.length === 0 ? (
                <Card>
                    <CardContent className="p-6 text-sm text-muted-foreground">
                        Nothing here yet.
                    </CardContent>
                </Card>
            ) : (
                <Card>
                    <CardContent className="p-0">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="border-b text-left text-muted-foreground">
                                    <th className="px-4 py-3 font-medium">
                                        Title
                                    </th>
                                    <th className="px-4 py-3 font-medium">
                                        Status
                                    </th>
                                    <th className="px-4 py-3 font-medium">
                                        Emails
                                    </th>
                                    <th className="px-4 py-3" />
                                </tr>
                            </thead>
                            <tbody>
                                {sequences.map((sequence) => (
                                    <tr
                                        key={sequence.sequenceId}
                                        className="cursor-pointer border-b last:border-0 hover:bg-accent/50"
                                        onClick={() =>
                                            router.push(
                                                `${basePath}/${sequence.sequenceId}`,
                                            )
                                        }
                                    >
                                        <td className="px-4 py-3 font-medium">
                                            {sequence.title || "Untitled"}
                                        </td>
                                        <td className="px-4 py-3">
                                            {type === "broadcast" ? (
                                                <Badge
                                                    variant={
                                                        presentBroadcastStatus(
                                                            sequence,
                                                        ).variant
                                                    }
                                                >
                                                    {
                                                        presentBroadcastStatus(
                                                            sequence,
                                                        ).label
                                                    }
                                                </Badge>
                                            ) : (
                                                <Badge
                                                    variant={
                                                        STATUS_VARIANT[
                                                            sequence.status
                                                        ]
                                                    }
                                                >
                                                    {sequence.status}
                                                </Badge>
                                            )}
                                        </td>
                                        <td className="px-4 py-3 text-muted-foreground">
                                            {sequence.emails.length}
                                        </td>
                                        <td className="px-4 py-3 text-right">
                                            {/* Broadcasts are sent/scheduled from the editor —
                                                a quick-start here would send immediately since
                                                a draft broadcast's send time defaults to the
                                                past (see lib/broadcast.ts). */}
                                            {type !== "broadcast" &&
                                                (sequence.status === "active" ||
                                                    sequence.status ===
                                                        "draft" ||
                                                    sequence.status ===
                                                        "paused") && (
                                                    <IconButton
                                                        aria-label={
                                                            sequence.status ===
                                                            "active"
                                                                ? "Pause sequence"
                                                                : "Start sequence"
                                                        }
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            toggle(sequence);
                                                        }}
                                                    >
                                                        {sequence.status ===
                                                        "active" ? (
                                                            <Pause className="size-4" />
                                                        ) : (
                                                            <Play className="size-4" />
                                                        )}
                                                    </IconButton>
                                                )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </CardContent>
                </Card>
            )}

            {sequences !== null && (
                <ListPagination
                    page={page}
                    total={total}
                    itemsPerPage={ITEMS_PER_PAGE}
                    disabled={loadingPage}
                    onPageChange={(nextPage) => void load(nextPage)}
                />
            )}
        </ScrollablePage>
    );
}
