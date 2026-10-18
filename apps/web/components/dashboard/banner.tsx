import { cn } from "@/lib/utils";

export function Banner({
    variant = "error",
    children,
    className,
}: {
    variant?: "error" | "success" | "warning" | "info";
    children: React.ReactNode;
    className?: string;
}) {
    return (
        <div
            className={cn(
                "rounded-md px-3 py-2 text-sm",
                variant === "error"
                    ? "border border-destructive/30 bg-background text-destructive"
                    : variant === "success"
                      ? "bg-success-soft text-success"
                      : variant === "warning"
                        ? "border border-amber-300/70 bg-amber-50 text-amber-950 dark:border-amber-800 dark:bg-amber-950/20 dark:text-amber-100"
                        : "border border-primary/20 bg-primary/5 text-foreground",
                className,
            )}
        >
            {children}
        </div>
    );
}
