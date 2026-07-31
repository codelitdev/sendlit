"use client";

import { useEffect, useState } from "react";
import {
    Home,
    Building2,
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
import { Loader } from "@codelitdev/design-system";
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
import {
    listOrganizations,
    listTeams,
    type Organization,
    type Team,
} from "@/lib/api";
import {
    clearTeamIdCookie,
    ORGANIZATION_CONTEXT_CHANGED,
    TEAMS_CHANGED,
    resolveCurrentOrganizationId,
    resolveCurrentTeamIdForOrganization,
    setOrganizationIdCookie,
    setTeamIdCookie,
} from "@/lib/tokens";

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
    { url: "/organizations", title: "Organizations", icon: Building2 },
    { url: "/settings", title: "Settings", icon: Settings },
];

export function AppSidebar() {
    const [teams, setTeams] = useState<Team[]>([]);
    const [organizations, setOrganizations] = useState<Organization[]>([]);
    const [organizationId, setOrganizationId] = useState<string | null>(null);
    const [currentTeamId, setCurrentTeamId] = useState<string | null>(null);
    const [account, setAccount] = useState<CurrentAccount | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [loadingTeams, setLoadingTeams] = useState(true);

    useEffect(() => {
        let cancelled = false;
        async function load() {
            try {
                const [teamsResult, organizationsResult, userInfoResult] =
                    await Promise.allSettled([
                        listTeams(),
                        listOrganizations(),
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

                if (teamsResult.status === "rejected") {
                    throw teamsResult.reason;
                }
                if (organizationsResult.status === "rejected") {
                    throw organizationsResult.reason;
                }
                const { items } = teamsResult.value;
                const { items: organizationItems } = organizationsResult.value;
                setTeams(items);
                setOrganizations(organizationItems);
                const initialOrganizationId = resolveCurrentOrganizationId(
                    items,
                    organizationItems,
                );
                setOrganizationId(initialOrganizationId);
                if (initialOrganizationId) {
                    setOrganizationIdCookie(initialOrganizationId);
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
            } finally {
                if (!cancelled) setLoadingTeams(false);
            }
        }
        load();
        return () => {
            cancelled = true;
        };
    }, []);

    useEffect(() => {
        const reloadTeams = () => {
            void listTeams()
                .then(({ items }) => setTeams(items))
                .catch((err: unknown) => {
                    setError(
                        err instanceof ApiError
                            ? err.message
                            : "Failed to refresh teams",
                    );
                });
        };
        window.addEventListener(TEAMS_CHANGED, reloadTeams);
        return () => window.removeEventListener(TEAMS_CHANGED, reloadTeams);
    }, []);

    useEffect(() => {
        const onOrganizationChanged = (event: Event) => {
            const nextOrganizationId = (event as CustomEvent<string>).detail;
            if (typeof nextOrganizationId === "string" && nextOrganizationId) {
                setOrganizationId(nextOrganizationId);
            }
        };
        window.addEventListener(
            ORGANIZATION_CONTEXT_CHANGED,
            onOrganizationChanged,
        );
        return () =>
            window.removeEventListener(
                ORGANIZATION_CONTEXT_CHANGED,
                onOrganizationChanged,
            );
    }, []);

    useEffect(() => {
        if (!organizationId) return;
        const nextTeamId = resolveCurrentTeamIdForOrganization(
            teams,
            organizationId,
        );
        setCurrentTeamId(nextTeamId);
        if (nextTeamId) setTeamIdCookie(nextTeamId);
        else clearTeamIdCookie();
    }, [organizationId, teams]);

    return (
        <Sidebar collapsible="icon">
            <SidebarHeader>
                {teams.length > 0 || organizations.length > 0 ? (
                    <TeamSwitcher
                        teams={teams}
                        organizations={organizations}
                        currentOrganizationId={organizationId}
                        currentTeamId={currentTeamId}
                    />
                ) : loadingTeams ? (
                    <SidebarMenu>
                        <SidebarMenuItem className="flex h-12 items-center gap-2 px-2">
                            <Loader size={18} />
                            <span className="truncate text-sm font-medium text-muted-foreground group-data-[collapsible=icon]:hidden">
                                Loading…
                            </span>
                        </SidebarMenuItem>
                    </SidebarMenu>
                ) : (
                    <SidebarMenu>
                        <SidebarMenuItem className="flex h-12 items-center gap-2 px-2">
                            <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
                                <Send className="size-4" />
                            </div>
                            <span className="truncate text-sm font-medium group-data-[collapsible=icon]:hidden">
                                {organizationId
                                    ? "No team in this organization"
                                    : "SendLit"}
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

            <SidebarFooter className="p-0">
                <NavMain items={SECONDARY_NAV} />
                <div className="p-2">
                    <NavUser user={account} />
                </div>
            </SidebarFooter>

            <SidebarRail />
        </Sidebar>
    );
}
