import { Loader } from "@codelitdev/design-system";
import { cn } from "@/lib/utils";

/** Standard "loading" state — the design system's animated SendLit mark. */
export function Loading({ className }: { className?: string }) {
    return (
        <p
            className={cn(
                "flex items-center gap-2 text-sm text-muted-foreground",
                className,
            )}
        >
            <span className="text-primary">
                <Loader product="sendlit" size={16} />
            </span>
            Loading…
        </p>
    );
}
