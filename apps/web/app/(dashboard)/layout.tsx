import { requireAuth } from "@/lib/server-auth";
import { AppSidebar } from "@/components/dashboard/app-sidebar";
import { BreadcrumbProvider } from "@/components/dashboard/breadcrumb-context";
import { DashboardBreadcrumb } from "@/components/dashboard/dashboard-breadcrumb";
import { Separator } from "@/components/ui/separator";
import {
    SidebarInset,
    SidebarProvider,
    SidebarTrigger,
} from "@/components/ui/sidebar";

export default async function DashboardLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    await requireAuth();

    return (
        <SidebarProvider>
            <AppSidebar />

            <SidebarInset>
                <BreadcrumbProvider>
                    <header className="flex h-16 shrink-0 items-center gap-2 border-b transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-12">
                        <div className="flex items-center gap-2 px-4">
                            <SidebarTrigger className="-ml-1" />
                            <Separator
                                orientation="vertical"
                                className="mr-2 data-vertical:h-4 data-vertical:self-auto"
                            />
                            <DashboardBreadcrumb />
                        </div>
                    </header>
                    {children}
                </BreadcrumbProvider>
            </SidebarInset>
        </SidebarProvider>
    );
}
