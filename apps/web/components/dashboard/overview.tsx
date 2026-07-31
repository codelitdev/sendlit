"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Activity, ArrowRight, Circle, Mail, Workflow } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/codelit/select";
import {
    getGeneralSettings,
    getOverview,
    listSendingOptions,
    type Overview,
} from "@/lib/api";
import { useSetBreadcrumb } from "@/components/dashboard/breadcrumb-context";

interface SetupStatus {
    hasDeliverySource: boolean;
    hasMailingAddress: boolean;
}

export function OverviewDashboard() {
    useSetBreadcrumb([{ label: "Overview" }]);
    const [data, setData] = useState<Overview | null>(null);
    const [setup, setSetup] = useState<SetupStatus | null>(null);
    const [rangeDays, setRangeDays] = useState(7);
    useEffect(() => {
        void Promise.all([
            getOverview(rangeDays),
            listSendingOptions(),
            getGeneralSettings(),
        ])
            .then(([overview, sendingOptions, settings]) => {
                setData(overview);
                setSetup({
                    // A shared organization ESP is a complete delivery setup
                    // for this team, even though its credentials are never
                    // exposed through the team-facing settings API.
                    hasDeliverySource: sendingOptions.items.length > 0,
                    hasMailingAddress: Boolean(settings.mailingAddress?.trim()),
                });
            })
            .catch(() => setData(null));
    }, [rangeDays]);
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
    const pendingSteps = [
        !setup?.hasDeliverySource && {
            title: "Set up an email service provider",
            description:
                "Connect an ESP to send broadcasts, sequences, and transactional email.",
            href: "/settings?tab=esp",
        },
        !setup?.hasMailingAddress && {
            title: "Add your mailing address",
            description:
                "A physical mailing address is required before this workspace can send email.",
            href: "/settings",
        },
    ].filter(Boolean) as {
        title: string;
        description: string;
        href: string;
    }[];
    return (
        <main className="w-full space-y-6 p-4 sm:p-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-semibold">Overview</h1>
                    <p className="text-sm text-muted-foreground">
                        Your email operation at a glance.
                    </p>
                </div>
                <Select
                    value={String(rangeDays)}
                    onValueChange={(value) => setRangeDays(Number(value))}
                >
                    <SelectTrigger className="w-36" aria-label="Date range">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="1">Last 1 day</SelectItem>
                        <SelectItem value="3">Last 3 days</SelectItem>
                        <SelectItem value="7">Last 7 days</SelectItem>
                        <SelectItem value="30">Last 30 days</SelectItem>
                    </SelectContent>
                </Select>
            </div>
            {pendingSteps.length > 0 && (
                <Card>
                    <CardContent className="space-y-4 p-5">
                        <div>
                            <h2 className="font-semibold">Get started</h2>
                            <p className="text-sm text-muted-foreground">
                                Complete these steps before sending your first
                                email.
                            </p>
                        </div>
                        <div className="space-y-3">
                            {pendingSteps.map((step) => (
                                <Link
                                    key={step.href}
                                    href={step.href}
                                    className="flex items-center gap-3 rounded-lg border p-3 transition-colors hover:bg-accent/50"
                                >
                                    <Circle className="size-4 shrink-0 text-muted-foreground" />
                                    <div className="min-w-0 flex-1">
                                        <p className="font-medium">
                                            {step.title}
                                        </p>
                                        <p className="text-sm text-muted-foreground">
                                            {step.description}
                                        </p>
                                    </div>
                                    <ArrowRight className="size-4 shrink-0 text-muted-foreground" />
                                </Link>
                            ))}
                        </div>
                    </CardContent>
                </Card>
            )}
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
            </section>
            <section>
                <Card>
                    <CardContent className="space-y-4 p-5">
                        <div>
                            <h2 className="font-semibold">Mail delivery</h2>
                            <p className="text-sm text-muted-foreground">
                                Transactional delivery activity in the last{" "}
                                {rangeDays} {rangeDays === 1 ? "day" : "days"}.
                            </p>
                        </div>
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
