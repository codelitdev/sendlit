"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
    SidebarGroup,
    SidebarGroupLabel,
    SidebarMenu,
    SidebarMenuButton,
    SidebarMenuItem,
    useSidebar,
} from "@/components/ui/sidebar";

export interface NavMainItem {
    title: string;
    url: string;
    icon: React.ComponentType<{ className?: string }>;
}

export function NavMain({
    label,
    items,
}: {
    label?: string;
    items: NavMainItem[];
}) {
    const pathname = usePathname();
    const { isMobile, setOpenMobile } = useSidebar();

    return (
        <SidebarGroup>
            {label && <SidebarGroupLabel>{label}</SidebarGroupLabel>}
            <SidebarMenu>
                {items.map((item) => {
                    const isActive =
                        pathname === item.url ||
                        pathname.startsWith(`${item.url}/`);
                    return (
                        <SidebarMenuItem key={item.url}>
                            <SidebarMenuButton
                                asChild
                                tooltip={item.title}
                                isActive={isActive}
                            >
                                <Link
                                    href={item.url}
                                    onClick={() =>
                                        isMobile && setOpenMobile(false)
                                    }
                                >
                                    <item.icon />
                                    <span>{item.title}</span>
                                </Link>
                            </SidebarMenuButton>
                        </SidebarMenuItem>
                    );
                })}
            </SidebarMenu>
        </SidebarGroup>
    );
}
