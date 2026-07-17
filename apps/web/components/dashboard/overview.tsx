"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Activity, Mail, Workflow } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { getOverview, type Overview } from "@/lib/api";

export function OverviewDashboard() {
    const [data, setData] = useState<Overview | null>(null);
    useEffect(() => {
        void getOverview()
            .then(setData)
            .catch(() => setData(null));
    }, []);
    if (!data)
        return (
            <main className="p-6 text-sm text-muted-foreground">
                Loading overview…
            </main>
        );
    const total =
        data.mail.sent +
        data.mail.queued +
        data.mail.failed +
        data.mail.bounced;
    const daily = data.quota.dailyLimit
        ? Math.round((data.quota.dailyUsed / data.quota.dailyLimit) * 100)
        : 0;
    return (
        <main className="mx-auto w-full max-w-6xl space-y-6 p-4 sm:p-6">
            <div>
                <h1 className="text-2xl font-semibold">Overview</h1>
                <p className="text-sm text-muted-foreground">
                    Your email operation at a glance.
                </p>
            </div>
            <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <Metric
                    icon={Workflow}
                    label="Active sequences"
                    value={data.activeSequences}
                    detail={`${data.ongoingContacts} contacts in progress`}
                    href="/sequences"
                />
                <Metric
                    icon={Activity}
                    label="Mails sent"
                    value={data.mail.sent}
                    detail={`${total} total transactional`}
                    href="/transactional"
                />
                <Metric
                    icon={Mail}
                    label="Queued mail"
                    value={data.mail.queued}
                    detail={`${data.scheduledBroadcasts} scheduled broadcast${data.scheduledBroadcasts === 1 ? "" : "s"}`}
                    href="/broadcasts"
                />
                <Metric
                    icon={Mail}
                    label="Daily quota"
                    value={`${data.quota.dailyUsed.toLocaleString()} / ${data.quota.dailyLimit.toLocaleString()}`}
                    detail={`${Math.max(0, data.quota.dailyLimit - data.quota.dailyUsed).toLocaleString()} remaining`}
                    href="/account?tab=billing"
                />
            </section>
            <section className="grid gap-4 lg:grid-cols-2">
                <Card>
                    <CardContent className="space-y-4 p-5">
                        <h2 className="font-semibold">Mail delivery</h2>
                        <div className="grid grid-cols-2 gap-3 text-sm">
                            <Status label="Sent" value={data.mail.sent} />
                            <Status label="Queued" value={data.mail.queued} />
                            <Status label="Failed" value={data.mail.failed} />
                            <Status label="Bounced" value={data.mail.bounced} />
                        </div>
                        <Link
                            className="text-sm font-medium underline"
                            href="/transactional"
                        >
                            View transactional activity
                        </Link>
                    </CardContent>
                </Card>
                <Card>
                    <CardContent className="space-y-4 p-5">
                        <h2 className="font-semibold">Sending allowance</h2>
                        <div className="h-2 overflow-hidden rounded bg-muted">
                            <div
                                className="h-full bg-primary"
                                style={{ width: `${Math.min(100, daily)}%` }}
                            />
                        </div>
                        <p className="text-sm text-muted-foreground">
                            {daily}% of daily quota used. Monthly:{" "}
                            {data.quota.monthlyUsed.toLocaleString()} /{" "}
                            {data.quota.monthlyLimit.toLocaleString()}.
                        </p>
                        <Link
                            className="text-sm font-medium underline"
                            href="/account?tab=billing"
                        >
                            Manage billing
                        </Link>
                    </CardContent>
                </Card>
            </section>
        </main>
    );
}
function Metric({
    icon: Icon,
    label,
    value,
    detail,
    href,
}: {
    icon: typeof Mail;
    label: string;
    value: string | number;
    detail: string;
    href: string;
}) {
    return (
        <Link href={href}>
            <Card className="h-full transition-colors hover:bg-accent/50">
                <CardContent className="p-5">
                    <Icon className="mb-3 size-4 text-muted-foreground" />
                    <p className="text-sm text-muted-foreground">{label}</p>
                    <p className="text-2xl font-semibold">{value}</p>
                    <p className="text-xs text-muted-foreground">{detail}</p>
                </CardContent>
            </Card>
        </Link>
    );
}
function Status({ label, value }: { label: string; value: number }) {
    return (
        <div>
            <p className="text-muted-foreground">{label}</p>
            <p className="text-lg font-semibold">{value}</p>
        </div>
    );
}
