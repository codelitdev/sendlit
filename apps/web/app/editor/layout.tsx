import { requireAuth } from "@/lib/server-auth";

/**
 * Chrome-free layout for full-screen email editing — no sidebar skeleton, the
 * editor owns the whole viewport. Pages here are reached via an edit button
 * next to an `EmailPreview` in the dashboard, and exit back to it.
 */
export default async function EditorLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    await requireAuth();

    return <div className="h-dvh overflow-hidden">{children}</div>;
}
