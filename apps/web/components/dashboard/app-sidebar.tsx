"use client";

import { useEffect, useState } from "react";
import {
    Home,
    Images,
    Mail,
    MailCheck,
    Radio,
    Send,
    Settings,
    ShieldAlert,
    Users,
    Workflow,
} from "lucide-react";
import {
    Sidebar,
    SidebarContent,
    SidebarFooter,
    SidebarHeader,
    SidebarMenu,
    SidebarMenuItem,
    SidebarRail,
} from "@/components/ui/sidebar";
import { NavMain, type NavMainItem } from "@/components/dashboard/nav-main";
import { NavUser, type CurrentAccount } from "@/components/dashboard/nav-user";
import { TeamSwitcher } from "@/components/dashboard/team-switcher";
import { Banner } from "@/components/dashboard/banner";
import { ApiError } from "@/lib/api-client";
import { listTeams, type Team } from "@/lib/api";
import { resolveCurrentTeamId } from "@/lib/tokens";

const NAV: NavMainItem[] = [
    { url: "/", title: "Home", icon: Home },
    { url: "/broadcasts", title: "Broadcasts", icon: Radio },
    { url: "/sequences", title: "Sequences", icon: Workflow },
    { url: "/contacts", title: "Contacts", icon: Users },
];

const LIBRARY_NAV: NavMainItem[] = [
    { url: "/templates", title: "Templates", icon: Mail },
    { url: "/media", title: "Media", icon: Images },
];

const ACTIVITY_NAV: NavMainItem[] = [
    { url: "/transactional", title: "Transactional log", icon: MailCheck },
    { url: "/suppressions", title: "Suppressions", icon: ShieldAlert },
];

const SECONDARY_NAV: NavMainItem[] = [
    { url: "/settings", title: "Settings", icon: Settings },
];

export function AppSidebar() {
    const [teams, setTeams] = useState<Team[]>([]);
    const [currentTeamId, setCurrentTeamId] = useState<string | null>(null);
    const [account, setAccount] = useState<CurrentAccount | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        async function load() {
            try {
                const [teamsResult, userInfoResult] = await Promise.allSettled([
                    listTeams(),
                    fetch("/api/auth/get-session", {
                        cache: "no-store",
                    }).then(async (res) => {
                        if (res.status === 401) {
                            window.location.href = "/login";
                            return new Promise<CurrentAccount>(() => {});
                        }
                        if (!res.ok) return null;
                        const session = (await res.json()) as {
                            user?: CurrentAccount;
                        };
                        return session.user ?? null;
                    }),
                ]);
                if (cancelled) return;

                if (teamsResult.status === "fulfilled") {
                    const { items } = teamsResult.value;
                    setTeams(items);
                    setCurrentTeamId(resolveCurrentTeamId(items));
                } else {
                    throw teamsResult.reason;
                }

                if (
                    userInfoResult.status === "fulfilled" &&
                    userInfoResult.value
                ) {
                    setAccount(userInfoResult.value);
                }
            } catch (err) {
                if (cancelled) return;
                setError(
                    err instanceof ApiError
                        ? err.message
                        : "Failed to load teams",
                );
            }
        }
        load();
        return () => {
            cancelled = true;
        };
    }, []);

    return (
        <Sidebar collapsible="icon">
            <SidebarHeader>
                {teams.length > 0 ? (
                    <TeamSwitcher teams={teams} currentTeamId={currentTeamId} />
                ) : (
                    <SidebarMenu>
                        <SidebarMenuItem className="flex h-12 items-center gap-2 px-2">
                            <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
                                <Send className="size-4" />
                            </div>
                            <span className="truncate text-sm font-medium group-data-[collapsible=icon]:hidden">
                                SendLit
                            </span>
                        </SidebarMenuItem>
                    </SidebarMenu>
                )}
            </SidebarHeader>

            {error && (
                <div className="px-2 group-data-[collapsible=icon]:hidden">
                    <Banner>{error}</Banner>
                </div>
            )}

            <SidebarContent>
                <NavMain items={NAV} />
                <NavMain label="Library" items={LIBRARY_NAV} />
                <NavMain label="Activity" items={ACTIVITY_NAV} />
            </SidebarContent>

            <SidebarFooter>
                <NavMain items={SECONDARY_NAV} />
                <NavUser user={account} />
            </SidebarFooter>

            <SidebarRail />
        </Sidebar>
    );
}
