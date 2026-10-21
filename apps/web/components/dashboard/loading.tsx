import { Loader } from "@codelitdev/design-system";
import { cn } from "@/lib/utils";

/** Standard "loading" state — the design system's animated SendLit mark.
 * `centered` places it in the middle of the surrounding area, such as a
 * dialog body, instead of at its top left. */
export function Loading({
  className,
  centered = false,
}: {
  className?: string;
  centered?: boolean;
}) {
  return (
    <p
      className={cn(
        "flex items-center gap-2 text-sm text-muted-foreground",
        centered && "min-h-32 w-full justify-center",
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
