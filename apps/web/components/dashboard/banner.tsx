import { cn } from "@/lib/utils";

export function Banner({
    variant = "error",
    children,
    className,
}: {
    variant?: "error" | "success";
    children: React.ReactNode;
    className?: string;
}) {
    return (
        <div
            className={cn(
                "rounded-md px-3 py-2 text-sm",
                variant === "error"
                    ? "border border-destructive/30 bg-background text-destructive"
                    : "bg-success-soft text-success",
                className,
            )}
        >
            {children}
        </div>
    );
}
