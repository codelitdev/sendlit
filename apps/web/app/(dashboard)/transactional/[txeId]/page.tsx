"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/dashboard/page-header";
import { Banner } from "@/components/dashboard/banner";
import { ScrollablePage } from "@/components/dashboard/scrollable-page";
import { ApiError } from "@/lib/api-client";
import {
    getTransactionalEmail,
    type TransactionalEmailDetail,
} from "@/lib/api";

const STATUS_BADGE_VARIANT: Record<
    TransactionalEmailDetail["status"],
    "success" | "secondary" | "destructive"
> = {
    sent: "success",
    queued: "secondary",
    failed: "destructive",
    bounced: "destructive",
};

function formatDate(value: string | null) {
    return value ? new Date(value).toLocaleString() : "—";
}

export default function TransactionalDetailPage({
    params,
}: {
    params: Promise<{ txeId: string }>;
}) {
    const { txeId } = use(params);
    const [email, setEmail] = useState<TransactionalEmailDetail | null>(null);
    const [error, setError] = useState<string | null>(null);

    async function load() {
        try {
            setEmail(await getTransactionalEmail(txeId));
        } catch (err) {
            setError(
                err instanceof ApiError
                    ? err.message
                    : "Failed to load transactional email",
            );
        }
    }

    useEffect(() => {
        load();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [txeId]);

    if (error) return <Banner>{error}</Banner>;
    if (!email)
        return <p className="text-sm text-muted-foreground">Loading…</p>;

    const hasVariables = Object.keys(email.variables).length > 0;

    return (
        <ScrollablePage>
            <div className="max-w-3xl">
                <Link
                    href="/transactional"
                    className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
                >
                    <ArrowLeft className="size-3.5" />
                    Back to transactional emails
                </Link>

                <PageHeader
                    title={email.subject}
                    description={email.to}
                    action={
                        <Badge variant={STATUS_BADGE_VARIANT[email.status]}>
                            {email.status}
                        </Badge>
                    }
                />

                <div className="space-y-6">
                    {email.error && <Banner>{email.error}</Banner>}

                    <Card>
                        <CardHeader>
                            <CardTitle className="text-base">Details</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-3 text-sm">
                            <DetailRow
                                label="Transactional email ID"
                                value={email.txeId}
                            />
                            <DetailRow label="To" value={email.to} />
                            <DetailRow label="From" value={email.from || "—"} />
                            <DetailRow
                                label="Reply-to"
                                value={email.replyTo || "—"}
                            />
                            <DetailRow
                                label="Template"
                                value={email.templateId || "Inline HTML"}
                            />
                            <DetailRow
                                label="Sent"
                                value={formatDate(email.sentAt)}
                            />
                            <DetailRow
                                label="Created"
                                value={formatDate(email.createdAt)}
                            />
                            <DetailRow
                                label="Updated"
                                value={formatDate(email.updatedAt)}
                            />

                            {(email.trackOpens || email.trackClicks) && (
                                <div className="flex gap-2 pt-2">
                                    {email.trackOpens && (
                                        <Badge variant="secondary">
                                            {email.openCount} open
                                            {email.openCount === 1 ? "" : "s"}
                                        </Badge>
                                    )}
                                    {email.trackClicks && (
                                        <Badge variant="secondary">
                                            {email.clickCount} click
                                            {email.clickCount === 1 ? "" : "s"}
                                        </Badge>
                                    )}
                                </div>
                            )}
                        </CardContent>
                    </Card>

                    {hasVariables && (
                        <Card>
                            <CardHeader>
                                <CardTitle className="text-base">
                                    Variables
                                </CardTitle>
                            </CardHeader>
                            <CardContent>
                                <pre className="overflow-x-auto rounded-md bg-muted p-3 text-xs">
                                    {JSON.stringify(email.variables, null, 2)}
                                </pre>
                            </CardContent>
                        </Card>
                    )}

                    <Card>
                        <CardHeader>
                            <CardTitle className="text-base">Preview</CardTitle>
                        </CardHeader>
                        <CardContent>
                            {email.html ? (
                                <iframe
                                    srcDoc={email.html}
                                    sandbox=""
                                    className="h-[32rem] w-full rounded-md border bg-white"
                                    title="Email preview"
                                />
                            ) : (
                                <p className="text-sm text-muted-foreground">
                                    No HTML snapshot available.
                                </p>
                            )}
                        </CardContent>
                    </Card>
                </div>
            </div>
        </ScrollablePage>
    );
}

function DetailRow({ label, value }: { label: string; value: string }) {
    return (
        <div className="flex items-start justify-between gap-4">
            <span className="text-muted-foreground">{label}</span>
            <span className="text-right font-medium break-all">{value}</span>
        </div>
    );
}
