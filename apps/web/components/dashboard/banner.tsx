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
                    ? "bg-destructive/10 text-destructive"
                    : "bg-emerald-100 text-emerald-800",
                className,
            )}
        >
            {children}
        </div>
    );
}
