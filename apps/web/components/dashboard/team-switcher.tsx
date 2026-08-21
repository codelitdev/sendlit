"use client";

import Link from "next/link";
import { ChevronsUpDownIcon, PlusIcon } from "lucide-react";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/codelit/dropdown-menu";
import {
    SidebarMenu,
    SidebarMenuButton,
    SidebarMenuItem,
    useSidebar,
} from "@/components/ui/sidebar";
import { SendLitLogo } from "@/components/dashboard/sendlit-logo";
import type { Organization, Team } from "@/lib/api";
import { selectOrganizationContext } from "@/lib/tokens";

export function TeamSwitcher({
    teams,
    organizations,
    currentOrganizationId,
    currentTeamId,
}: {
    teams: Team[];
    organizations: Organization[];
    currentOrganizationId: string | null;
    currentTeamId: string | null;
}) {
    const { isMobile } = useSidebar();
    const activeTeam = teams.find((team) => team.teamId === currentTeamId);
    const teamsByOrganization = organizations.map((organization) => ({
        organizationId: organization.organizationId,
        organizationName: organization.name,
        teams: teams.filter(
            (team) => team.organizationId === organization.organizationId,
        ),
    }));

    const title = activeTeam?.name ?? "Choose a team";
    const subtitle =
        activeTeam?.organizationName ??
        organizations.find(
            (organization) =>
                organization.organizationId === currentOrganizationId,
        )?.name ??
        "Organization workspace";

    return (
        <SidebarMenu>
            <SidebarMenuItem>
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <SidebarMenuButton
                            size="lg"
                            className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
                        >
                            <div className="flex aspect-square size-9 shrink-0 items-center justify-center rounded-md bg-[var(--primary-soft)]">
                                <SendLitLogo className="size-8" />
                            </div>
                            <div className="grid min-w-0 flex-1 text-left text-sm leading-tight">
                                <span className="truncate font-medium">
                                    {title}
                                </span>
                                <span className="truncate text-xs text-muted-foreground">
                                    {subtitle}
                                </span>
                            </div>
                            <ChevronsUpDownIcon className="ml-auto size-4" />
                        </SidebarMenuButton>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent
                        align="start"
                        side={isMobile ? "bottom" : "right"}
                        sideOffset={4}
                    >
                        <DropdownMenuLabel className="text-xs text-muted-foreground">
                            Organizations and teams
                        </DropdownMenuLabel>
                        {teamsByOrganization.map((group, groupIndex) => (
                            <div key={group.organizationId ?? "unaffiliated"}>
                                {groupIndex > 0 && <DropdownMenuSeparator />}
                                <DropdownMenuLabel className="px-2 pt-2 text-xs font-medium text-foreground">
                                    {group.organizationName}
                                </DropdownMenuLabel>
                                {group.teams.map((team) => {
                                    return (
                                        <form
                                            key={team.teamId}
                                            action="/api/team/switch"
                                            method="POST"
                                            className="contents"
                                            onSubmit={() => {
                                                if (team.organizationId) {
                                                    selectOrganizationContext(
                                                        team.organizationId,
                                                    );
                                                }
                                            }}
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
                                            {team.organizationId && (
                                                <input
                                                    type="hidden"
                                                    name="organizationId"
                                                    value={team.organizationId}
                                                />
                                            )}
                                            <DropdownMenuItem asChild>
                                                <button
                                                    type="submit"
                                                    className="w-full gap-2 p-2 text-left"
                                                >
                                                    <div className="flex size-6 items-center justify-center rounded-md border text-xs font-medium">
                                                        {team.name
                                                            .slice(0, 1)
                                                            .toUpperCase()}
                                                    </div>
                                                    <span className="min-w-0 flex-1 truncate">
                                                        {team.name}
                                                    </span>
                                                </button>
                                            </DropdownMenuItem>
                                        </form>
                                    );
                                })}
                                {group.teams.length === 0 && (
                                    <p className="px-2 pb-2 text-xs text-muted-foreground">
                                        No teams you can access
                                    </p>
                                )}
                            </div>
                        ))}
                        <DropdownMenuSeparator />
                        <DropdownMenuItem asChild className="gap-2">
                            <Link href="/organizations">
                                <div className="flex size-6 items-center justify-center rounded-md border bg-transparent">
                                    <PlusIcon className="size-4" />
                                </div>
                                <div className="font-medium text-muted-foreground">
                                    Add team
                                </div>
                            </Link>
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
            </SidebarMenuItem>
        </SidebarMenu>
    );
}
