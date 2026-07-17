import { requireAuth } from "@/lib/server-auth";
import { AppSidebar } from "@/components/dashboard/app-sidebar";
import { OverviewDashboard } from "@/components/dashboard/overview";
import {
    SidebarInset,
    SidebarProvider,
    SidebarTrigger,
} from "@/components/ui/sidebar";

export default async function Home() {
    await requireAuth();
    return (
        <SidebarProvider>
            <AppSidebar />
            <SidebarInset>
                <header className="flex h-12 shrink-0 items-center border-b px-4">
                    <SidebarTrigger />
                </header>
                <OverviewDashboard />
            </SidebarInset>
        </SidebarProvider>
    );
}
