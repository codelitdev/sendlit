"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Pause, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/dashboard/page-header";
import { Banner } from "@/components/dashboard/banner";
import { ScrollablePage } from "@/components/dashboard/scrollable-page";
import { NewSequenceDialog } from "@/components/dashboard/new-sequence-dialog";
import { ApiError } from "@/lib/api-client";
import { listSequences, pauseSequence, startSequence } from "@/lib/api";
import type { MailType, Sequence } from "@sendlit/email-blocks";

const STATUS_VARIANT: Record<Sequence["status"], "success" | "secondary" | "outline"> = {
    active: "success",
    draft: "secondary",
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
    const [error, setError] = useState<string | null>(null);

    async function load() {
        try {
            const { items } = await listSequences(type);
            setSequences(items);
        } catch (err) {
            setError(err instanceof ApiError ? err.message : "Failed to load");
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
                        onCreated={(sequenceId) => router.push(`${basePath}/${sequenceId}`)}
                    />
                }
            />

            {error && <Banner className="mb-4">{error}</Banner>}

            {sequences === null ? (
                <p className="text-sm text-muted-foreground">Loading…</p>
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
                                    <th className="px-4 py-3 font-medium">Title</th>
                                    <th className="px-4 py-3 font-medium">Status</th>
                                    <th className="px-4 py-3 font-medium">Emails</th>
                                    <th className="px-4 py-3" />
                                </tr>
                            </thead>
                            <tbody>
                                {sequences.map((sequence) => (
                                    <tr
                                        key={sequence.sequenceId}
                                        className="cursor-pointer border-b last:border-0 hover:bg-accent/50"
                                        onClick={() =>
                                            router.push(`${basePath}/${sequence.sequenceId}`)
                                        }
                                    >
                                        <td className="px-4 py-3 font-medium">
                                            {sequence.title || "Untitled"}
                                        </td>
                                        <td className="px-4 py-3">
                                            <Badge variant={STATUS_VARIANT[sequence.status]}>
                                                {sequence.status}
                                            </Badge>
                                        </td>
                                        <td className="px-4 py-3 text-muted-foreground">
                                            {sequence.emails.length}
                                        </td>
                                        <td className="px-4 py-3 text-right">
                                            {(sequence.status === "active" ||
                                                sequence.status === "draft" ||
                                                sequence.status === "paused") && (
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        toggle(sequence);
                                                    }}
                                                >
                                                    {sequence.status === "active" ? (
                                                        <Pause className="size-4" />
                                                    ) : (
                                                        <Play className="size-4" />
                                                    )}
                                                </Button>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </CardContent>
                </Card>
            )}
        </ScrollablePage>
    );
}
