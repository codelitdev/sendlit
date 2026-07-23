"use client";

import Link from "next/link";
import { ChevronsUpDownIcon, PlusIcon } from "lucide-react";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuShortcut,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
    SidebarMenu,
    SidebarMenuButton,
    SidebarMenuItem,
    useSidebar,
} from "@/components/ui/sidebar";
import type { Team } from "@/lib/api";

export function TeamSwitcher({
    teams,
    currentTeamId,
}: {
    teams: Team[];
    currentTeamId: string | null;
}) {
    const { isMobile } = useSidebar();
    const activeTeam =
        teams.find((team) => team.teamId === currentTeamId) ?? teams[0];

    if (!activeTeam) {
        return null;
    }

    return (
        <SidebarMenu>
            <SidebarMenuItem>
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <SidebarMenuButton
                            size="lg"
                            className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
                        >
                            <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sm font-medium text-sidebar-primary-foreground">
                                {activeTeam.name.slice(0, 1).toUpperCase()}
                            </div>
                            <div className="grid flex-1 text-left text-sm leading-tight">
                                <span className="truncate font-medium">
                                    {activeTeam.name}
                                </span>
                                <span className="truncate text-xs">
                                    Team workspace
                                </span>
                            </div>
                            <ChevronsUpDownIcon className="ml-auto" />
                        </SidebarMenuButton>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent
                        align="start"
                        side={isMobile ? "bottom" : "right"}
                        sideOffset={4}
                    >
                        <DropdownMenuLabel className="text-xs text-muted-foreground">
                            Teams
                        </DropdownMenuLabel>
                        {teams.map((team, index) => (
                            <form
                                key={team.teamId}
                                action="/api/team/switch"
                                method="POST"
                                className="contents"
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
                                        <DropdownMenuShortcut>
                                            ⌘{index + 1}
                                        </DropdownMenuShortcut>
                                    </button>
                                </DropdownMenuItem>
                            </form>
                        ))}
                        <DropdownMenuSeparator />
                        <DropdownMenuItem asChild className="gap-2">
                            <Link href="/teams">
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
