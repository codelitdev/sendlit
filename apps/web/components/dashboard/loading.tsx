import { Loader } from "@codelitdev/design-system";
import { cn } from "@/lib/utils";

/** Standard loading state: the design system's animated SendLit mark, on its
 * own and centred in the area it fills (a page, card or dialog body). No
 * "Loading…" text; the mark itself is a labelled `role="status"`. */
export function Loading({ className }: { className?: string }) {
  return (
    <div className={cn("flex min-h-32 w-full items-center justify-center", className)}>
      <span className="text-primary">
        <Loader product="sendlit" size={40} />
      </span>
    </div>
  );
}
