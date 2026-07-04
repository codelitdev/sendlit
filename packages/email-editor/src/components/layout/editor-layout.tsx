import type { ReactNode } from "react";

interface EditorLayoutProps {
    editor: ReactNode;
    settings?: ReactNode;
    showSettings?: boolean;
}

export function EditorLayout({
    editor,
    settings,
    showSettings = true,
}: EditorLayoutProps) {
    return (
        <div className="h-full w-full bg-muted flex gap-4 p-4">
            <div className="min-w-0 flex-1 rounded-xl border bg-background shadow-sm overflow-y-auto">
                {editor}
            </div>

            {showSettings && settings && (
                <div className="w-80 shrink-0 rounded-xl border bg-background shadow-sm overflow-y-auto">
                    {settings}
                </div>
            )}
        </div>
    );
}
