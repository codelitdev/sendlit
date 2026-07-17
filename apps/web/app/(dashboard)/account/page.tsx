"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Bell, CreditCard, Sparkles, UserRound } from "lucide-react";
import { PageHeader } from "@/components/dashboard/page-header";
import { ScrollablePage } from "@/components/dashboard/scrollable-page";
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const ACCOUNT_TABS = ["general", "billing", "notifications"] as const;
type AccountTab = (typeof ACCOUNT_TABS)[number];

interface Account {
    email: string;
    name?: string | null;
}

function isAccountTab(value: string | null): value is AccountTab {
    return ACCOUNT_TABS.includes(value as AccountTab);
}

export default function AccountPage() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const tabParam = searchParams.get("tab");
    const selectedTab = isAccountTab(tabParam) ? tabParam : "general";
    const [account, setAccount] = useState<Account | null>(null);

    useEffect(() => {
        fetch("/api/auth/get-session", { cache: "no-store" })
            .then(async (response) => {
                if (!response.ok) return null;
                const session = (await response.json()) as { user?: Account };
                return session.user ?? null;
            })
            .then(setAccount);
    }, []);

    function selectTab(tab: string) {
        const params = new URLSearchParams(searchParams.toString());
        if (tab === "general") {
            params.delete("tab");
        } else {
            params.set("tab", tab);
        }
        const query = params.toString();
        router.replace(`/account${query ? `?${query}` : ""}`, {
            scroll: false,
        });
    }

    return (
        <ScrollablePage>
            <div className="max-w-3xl">
                <PageHeader
                    title="Account"
                    description="Manage your profile, plan, billing, and account notifications."
                />

                <Tabs
                    value={selectedTab}
                    defaultValue="general"
                    onValueChange={selectTab}
                >
                    <TabsList>
                        <TabsTrigger value="general">General</TabsTrigger>
                        <TabsTrigger value="billing">Billing</TabsTrigger>
                        <TabsTrigger value="notifications">
                            Notifications
                        </TabsTrigger>
                    </TabsList>

                    <TabsContent value="general">
                        <Card>
                            <CardHeader>
                                <CardTitle className="flex items-center gap-2 text-base">
                                    <UserRound className="size-4" />
                                    Profile
                                </CardTitle>
                                <CardDescription>
                                    Your account identity is managed through
                                    your sign-in provider.
                                </CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-3 text-sm">
                                <div>
                                    <p className="text-muted-foreground">
                                        Name
                                    </p>
                                    <p className="font-medium">
                                        {account?.name || "Not provided"}
                                    </p>
                                </div>
                                <div>
                                    <p className="text-muted-foreground">
                                        Email
                                    </p>
                                    <p className="font-medium">
                                        {account?.email || "Loading…"}
                                    </p>
                                </div>
                            </CardContent>
                        </Card>
                    </TabsContent>

                    <TabsContent value="billing">
                        <Card>
                            <CardHeader>
                                <CardTitle className="flex items-center gap-2 text-base">
                                    <CreditCard className="size-4" />
                                    Billing
                                </CardTitle>
                                <CardDescription>
                                    Manage your plan and payment details for
                                    this account.
                                </CardDescription>
                            </CardHeader>
                            <CardContent className="flex items-center gap-3 text-sm">
                                <Sparkles className="size-5 text-muted-foreground" />
                                <div>
                                    <p className="font-medium">Free plan</p>
                                    <p className="text-muted-foreground">
                                        Billing management will appear here when
                                        subscriptions are available.
                                    </p>
                                </div>
                            </CardContent>
                        </Card>
                    </TabsContent>

                    <TabsContent value="notifications">
                        <Card>
                            <CardHeader>
                                <CardTitle className="flex items-center gap-2 text-base">
                                    <Bell className="size-4" />
                                    Notifications
                                </CardTitle>
                                <CardDescription>
                                    Choose how SendLit communicates about your
                                    account and billing.
                                </CardDescription>
                            </CardHeader>
                            <CardContent className="text-sm text-muted-foreground">
                                Notification preferences are not configured yet.
                            </CardContent>
                        </Card>
                    </TabsContent>
                </Tabs>
            </div>
        </ScrollablePage>
    );
}
