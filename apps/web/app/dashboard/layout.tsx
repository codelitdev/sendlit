import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import Link from "next/link";
import {
    LogOut,
    Mail,
    Radio,
    Send,
    Settings,
    Users,
    Users2,
    Workflow,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ACCESS_TOKEN_COOKIE, REFRESH_TOKEN_COOKIE } from "@/lib/tokens";

const NAV = [
    { href: "/dashboard/contacts", label: "Contacts", icon: Users },
    { href: "/dashboard/templates", label: "Templates", icon: Mail },
    { href: "/dashboard/broadcasts", label: "Broadcasts", icon: Radio },
    { href: "/dashboard/sequences", label: "Sequences", icon: Workflow },
];

const SECONDARY_NAV = [
    { href: "/dashboard/teams", label: "Teams", icon: Users2 },
    { href: "/dashboard/settings", label: "Settings", icon: Settings },
];

export default async function DashboardLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    const cookieStore = await cookies();
    const isAuthed =
        cookieStore.get(ACCESS_TOKEN_COOKIE) ||
        cookieStore.get(REFRESH_TOKEN_COOKIE);
    if (!isAuthed) redirect("/login");

    return (
        <div className="flex h-screen overflow-hidden">
            <aside className="flex w-64 shrink-0 flex-col border-r bg-muted/20 p-4">
                <div className="mb-6 flex items-center gap-2 px-2">
                    <div className="flex size-8 items-center justify-center rounded-full bg-primary text-primary-foreground">
                        <Send className="size-4" />
                    </div>
                    <span className="font-semibold">SendLit</span>
                </div>

                <nav className="flex-1 space-y-1">
                    {NAV.map((item) => (
                        <Link
                            key={item.href}
                            href={item.href}
                            className="flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                        >
                            <item.icon className="size-4" />
                            {item.label}
                        </Link>
                    ))}
                </nav>

                <nav className="space-y-1 border-t pt-2">
                    {SECONDARY_NAV.map((item) => (
                        <Link
                            key={item.href}
                            href={item.href}
                            className="flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                        >
                            <item.icon className="size-4" />
                            {item.label}
                        </Link>
                    ))}
                </nav>

                <form action="/api/auth/logout" method="POST">
                    <Button
                        type="submit"
                        variant="ghost"
                        className="w-full justify-start gap-2.5 text-muted-foreground"
                    >
                        <LogOut className="size-4" />
                        Sign out
                    </Button>
                </form>
            </aside>

            <main className="flex flex-1 flex-col overflow-hidden">
                {children}
            </main>
        </div>
    );
}
