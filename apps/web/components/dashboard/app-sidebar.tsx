"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
    BadgeCheck,
    ChevronsUpDown,
    Home,
    LogOut,
    Mail,
    MailCheck,
    Images,
    Plus,
    Radio,
    Send,
    Settings,
    ShieldAlert,
    Sparkles,
    Users,
    Workflow,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
    Sidebar,
    SidebarContent,
    SidebarFooter,
    SidebarGroup,
    SidebarGroupLabel,
    SidebarHeader,
    SidebarMenu,
    SidebarMenuButton,
    SidebarMenuItem,
    SidebarRail,
    useSidebar,
} from "@/components/ui/sidebar";
import { Banner } from "@/components/dashboard/banner";
import { ApiError } from "@/lib/api-client";
import { listTeams, type Team } from "@/lib/api";
import { resolveCurrentTeamId } from "@/lib/tokens";
import { cn } from "@/lib/utils";

const NAV = [
    { href: "/", label: "Home", icon: Home },
    { href: "/broadcasts", label: "Broadcasts", icon: Radio },
    { href: "/sequences", label: "Sequences", icon: Workflow },
    { href: "/contacts", label: "Contacts", icon: Users },
];

const LIBRARY_NAV = [
    { href: "/templates", label: "Templates", icon: Mail },
    { href: "/media", label: "Media", icon: Images },
];

const SECONDARY_NAV = [
    { href: "/settings", label: "Settings", icon: Settings },
];

const ACTIVITY_NAV = [
    { href: "/transactional", label: "Transactional log", icon: MailCheck },
    { href: "/suppressions", label: "Suppressions", icon: ShieldAlert },
];

interface CurrentAccount {
    email: string;
    name?: string | null;
}

function initialsFor(account: CurrentAccount | null) {
    const source = account?.name || account?.email || "S";
    return source.slice(0, 1).toUpperCase();
}

function SidebarLink({
    item,
}: {
    item: { href: string; label: string; icon: React.ComponentType<any> };
}) {
    const pathname = usePathname();
    const { isMobile, setOpenMobile } = useSidebar();
    const active =
        pathname === item.href || pathname.startsWith(`${item.href}/`);

    return (
        <SidebarMenuItem>
            <SidebarMenuButton asChild isActive={active}>
                <Link
                    href={item.href}
                    onClick={() => isMobile && setOpenMobile(false)}
                >
                    <item.icon />
                    <span>{item.label}</span>
                </Link>
            </SidebarMenuButton>
        </SidebarMenuItem>
    );
}

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

    const currentTeam = useMemo(
        () => teams.find((team) => team.teamId === currentTeamId) ?? teams[0],
        [currentTeamId, teams],
    );

    return (
        <Sidebar collapsible="icon">
            <SidebarHeader>
                <details className="group">
                    <summary className="flex h-12 cursor-pointer list-none items-center gap-2 rounded-md px-2 text-left hover:bg-sidebar-accent hover:text-sidebar-accent-foreground group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0 [&::-webkit-details-marker]:hidden">
                        <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground">
                            <Send className="size-4" />
                        </div>
                        <div className="min-w-0 flex-1 group-data-[collapsible=icon]:hidden">
                            <div className="truncate text-sm font-semibold">
                                {currentTeam?.name ?? "SendLit"}
                            </div>
                            <div className="truncate text-xs text-muted-foreground">
                                {currentTeam ? "Team workspace" : "Select team"}
                            </div>
                        </div>
                        <ChevronsUpDown className="size-4 text-muted-foreground group-data-[collapsible=icon]:hidden" />
                    </summary>
                    <div className="absolute left-2 top-14 z-30 w-[17rem] overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-lg group-data-[collapsible=icon]:left-14">
                        <div className="px-3 py-2 text-xs font-medium text-muted-foreground">
                            Teams
                        </div>
                        <div className="max-h-64 overflow-auto p-1">
                            {teams.length === 0 ? (
                                <div className="px-2 py-2 text-sm text-muted-foreground">
                                    No teams available.
                                </div>
                            ) : (
                                teams.map((team, index) => (
                                    <form
                                        key={team.teamId}
                                        action="/api/team/switch"
                                        method="POST"
                                    >
                                        <input
                                            type="hidden"
                                            name="teamId"
                                            value={team.teamId}
                                        />
                                        <input
                                            type="hidden"
                                            name="redirectTo"
                                            value="/"
                                        />
                                        <button
                                            type="submit"
                                            className={cn(
                                                "flex w-full items-center gap-2 rounded-sm px-2 py-2 text-left text-sm hover:bg-accent hover:text-accent-foreground",
                                                team.teamId === currentTeamId &&
                                                    "bg-accent text-accent-foreground",
                                            )}
                                        >
                                            <span className="flex size-7 shrink-0 items-center justify-center rounded-md border text-xs font-medium">
                                                {team.name
                                                    .slice(0, 1)
                                                    .toUpperCase()}
                                            </span>
                                            <span className="min-w-0 flex-1 truncate">
                                                {team.name}
                                            </span>
                                            <span className="text-xs text-muted-foreground">
                                                ⌘{index + 1}
                                            </span>
                                        </button>
                                    </form>
                                ))
                            )}
                        </div>
                        <div className="border-t p-1">
                            <Button
                                variant="ghost"
                                size="sm"
                                className="w-full justify-start text-muted-foreground"
                                asChild
                            >
                                <Link href="/teams">
                                    <Plus className="size-4" />
                                    Add team
                                </Link>
                            </Button>
                        </div>
                    </div>
                </details>
            </SidebarHeader>

            {error && (
                <div className="px-2 group-data-[collapsible=icon]:hidden">
                    <Banner>{error}</Banner>
                </div>
            )}

            <SidebarContent>
                <SidebarGroup>
                    <SidebarMenu>
                        {NAV.map((item) => (
                            <SidebarLink key={item.href} item={item} />
                        ))}
                    </SidebarMenu>
                </SidebarGroup>
                <SidebarGroup>
                    <SidebarGroupLabel>Library</SidebarGroupLabel>
                    <SidebarMenu>
                        {LIBRARY_NAV.map((item) => (
                            <SidebarLink key={item.href} item={item} />
                        ))}
                    </SidebarMenu>
                </SidebarGroup>
                <SidebarGroup>
                    <SidebarGroupLabel>Activity</SidebarGroupLabel>
                    <SidebarMenu>
                        {ACTIVITY_NAV.map((item) => (
                            <SidebarLink key={item.href} item={item} />
                        ))}
                    </SidebarMenu>
                </SidebarGroup>
            </SidebarContent>

            <SidebarFooter>
                <SidebarMenu>
                    {SECONDARY_NAV.map((item) => (
                        <SidebarLink key={item.href} item={item} />
                    ))}
                    <SidebarMenuItem>
                        <details className="group/account relative">
                            <summary className="flex h-12 cursor-pointer list-none items-center gap-2 rounded-md px-2 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0 [&::-webkit-details-marker]:hidden">
                                <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-sidebar-accent text-sm font-semibold text-sidebar-accent-foreground">
                                    {initialsFor(account)}
                                </div>
                                <div className="min-w-0 flex-1 group-data-[collapsible=icon]:hidden">
                                    <div className="truncate text-sm font-medium">
                                        {account?.name || "SendLit"}
                                    </div>
                                    <div className="truncate text-xs text-muted-foreground">
                                        {account?.email || "Signed in"}
                                    </div>
                                </div>
                                <ChevronsUpDown className="size-4 text-muted-foreground group-data-[collapsible=icon]:hidden" />
                            </summary>

                            <div className="absolute bottom-14 left-0 z-30 w-[17rem] overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-lg group-data-[collapsible=icon]:left-12">
                                <div className="flex items-center gap-2 p-2">
                                    <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-sidebar-accent text-sm font-semibold text-sidebar-accent-foreground">
                                        {initialsFor(account)}
                                    </div>
                                    <div className="min-w-0">
                                        <div className="truncate text-sm font-medium">
                                            {account?.name || "SendLit"}
                                        </div>
                                        <div className="truncate text-xs text-muted-foreground">
                                            {account?.email || "Signed in"}
                                        </div>
                                    </div>
                                </div>
                                <div className="border-t p-1">
                                    <Link
                                        href="/account?tab=billing"
                                        className="flex h-9 w-full items-center gap-2 rounded-sm px-2 text-sm hover:bg-accent hover:text-accent-foreground"
                                    >
                                        <Sparkles className="size-4" />
                                        Upgrade to Pro
                                    </Link>
                                </div>
                                <div className="border-t p-1">
                                    <Link
                                        href="/account"
                                        className="flex h-9 items-center gap-2 rounded-sm px-2 text-sm hover:bg-accent hover:text-accent-foreground"
                                    >
                                        <BadgeCheck className="size-4" />
                                        Account
                                    </Link>
                                </div>
                                <form
                                    action="/api/auth/sign-out"
                                    method="POST"
                                    className="border-t p-1"
                                >
                                    <button
                                        type="submit"
                                        className="flex h-9 w-full items-center gap-2 rounded-sm px-2 text-sm hover:bg-accent hover:text-accent-foreground"
                                    >
                                        <LogOut className="size-4" />
                                        Log out
                                    </button>
                                </form>
                            </div>
                        </details>
                    </SidebarMenuItem>
                </SidebarMenu>
            </SidebarFooter>

            <SidebarRail />
        </Sidebar>
    );
}
