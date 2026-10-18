"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { UserRound } from "lucide-react";
import { Loader } from "@codelitdev/design-system";
import { Loading } from "@/components/dashboard/loading";
import { PageHeader } from "@/components/dashboard/page-header";
import { ScrollablePage } from "@/components/dashboard/scrollable-page";
import { useSetBreadcrumb } from "@/components/dashboard/breadcrumb-context";
import { Button } from "@/components/ui/codelit/button";
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/codelit/input";
import { Label } from "@/components/ui/codelit/label";
import {
    Tabs,
    TabsContent,
    TabsList,
    TabsTrigger,
} from "@/components/ui/codelit/tabs";

const ACCOUNT_TABS = ["general"] as const;
type AccountTab = (typeof ACCOUNT_TABS)[number];

interface Account {
    email: string;
    name?: string | null;
}

function isAccountTab(value: string | null): value is AccountTab {
    return ACCOUNT_TABS.includes(value as AccountTab);
}

export default function AccountPage() {
    useSetBreadcrumb([{ label: "Account" }]);
    const router = useRouter();
    const searchParams = useSearchParams();
    const tabParam = searchParams.get("tab");
    const selectedTab = isAccountTab(tabParam) ? tabParam : "general";
    const [account, setAccount] = useState<Account | null>(null);
    const [name, setName] = useState("");
    const [isEditingProfile, setIsEditingProfile] = useState(false);
    const [isSavingProfile, setIsSavingProfile] = useState(false);
    const [profileError, setProfileError] = useState<string | null>(null);

    useEffect(() => {
        if (tabParam !== "billing" && tabParam !== "notifications") return;

        if (tabParam === "billing") {
            router.replace("/organizations?tab=plan", { scroll: false });
            return;
        }

        const params = new URLSearchParams(searchParams.toString());
        params.delete("tab");
        const query = params.toString();
        router.replace(`/account${query ? `?${query}` : ""}`, {
            scroll: false,
        });
    }, [router, searchParams, tabParam]);

    useEffect(() => {
        fetch("/api/auth/get-session", { cache: "no-store" })
            .then(async (response) => {
                if (!response.ok) return null;
                const session = (await response.json()) as { user?: Account };
                return session.user ?? null;
            })
            .then((user) => {
                setAccount(user);
                setName(user?.name ?? "");
            });
    }, []);

    async function saveProfile(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault();
        const trimmedName = name.trim();

        if (!trimmedName) {
            setProfileError("Enter your name to continue.");
            return;
        }

        setIsSavingProfile(true);
        setProfileError(null);

        try {
            const response = await fetch("/api/auth/update-user", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ name: trimmedName }),
            });

            if (!response.ok) {
                throw new Error("Unable to update your profile.");
            }

            setAccount((current) =>
                current ? { ...current, name: trimmedName } : current,
            );
            setName(trimmedName);
            setIsEditingProfile(false);
        } catch {
            setProfileError("Unable to update your profile. Please try again.");
        } finally {
            setIsSavingProfile(false);
        }
    }

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
            <div className="w-full">
                <PageHeader
                    title="Account"
                    description="Manage your profile. Organization plans and billing are managed from Organizations."
                />

                <Tabs
                    value={selectedTab}
                    defaultValue="general"
                    onValueChange={selectTab}
                >
                    <TabsList>
                        <TabsTrigger value="general">General</TabsTrigger>
                    </TabsList>

                    <TabsContent value="general">
                        <Card>
                            <CardHeader>
                                <CardTitle className="flex items-center gap-2 text-base">
                                    <UserRound className="size-4" />
                                    Profile
                                </CardTitle>
                                <CardDescription>
                                    Update the name shown in SendLit. Email
                                    changes require verification and are not
                                    available yet.
                                </CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-4 text-sm">
                                {isEditingProfile ? (
                                    <form
                                        className="space-y-4"
                                        onSubmit={saveProfile}
                                    >
                                        <div className="space-y-2">
                                            <Label htmlFor="profile-name">
                                                Name
                                            </Label>
                                            <Input
                                                id="profile-name"
                                                value={name}
                                                onChange={(event) =>
                                                    setName(event.target.value)
                                                }
                                                autoComplete="name"
                                                disabled={isSavingProfile}
                                                aria-invalid={Boolean(
                                                    profileError,
                                                )}
                                            />
                                        </div>
                                        {profileError && (
                                            <p
                                                className="text-destructive"
                                                role="alert"
                                            >
                                                {profileError}
                                            </p>
                                        )}
                                        <div className="flex gap-2">
                                            <Button
                                                type="submit"
                                                disabled={isSavingProfile}
                                            >
                                                {isSavingProfile ? (
                                                    <Loader size={16} />
                                                ) : null}
                                                {isSavingProfile
                                                    ? "Saving…"
                                                    : "Save changes"}
                                            </Button>
                                            <Button
                                                type="button"
                                                variant="outline"
                                                disabled={isSavingProfile}
                                                onClick={() => {
                                                    setName(
                                                        account?.name ?? "",
                                                    );
                                                    setProfileError(null);
                                                    setIsEditingProfile(false);
                                                }}
                                            >
                                                Cancel
                                            </Button>
                                        </div>
                                    </form>
                                ) : (
                                    <>
                                        <div>
                                            <p className="text-muted-foreground">
                                                Name
                                            </p>
                                            <p className="font-medium">
                                                {account?.name ||
                                                    "Not provided"}
                                            </p>
                                        </div>
                                        <Button
                                            type="button"
                                            variant="outline"
                                            onClick={() => {
                                                setName(account?.name ?? "");
                                                setProfileError(null);
                                                setIsEditingProfile(true);
                                            }}
                                        >
                                            Edit profile
                                        </Button>
                                    </>
                                )}
                                <div>
                                    <p className="text-muted-foreground">
                                        Email
                                    </p>
                                    {account ? (
                                        <p className="font-medium">
                                            {account.email}
                                        </p>
                                    ) : (
                                        <Loading />
                                    )}
                                </div>
                            </CardContent>
                        </Card>
                    </TabsContent>
                </Tabs>
            </div>
        </ScrollablePage>
    );
}
