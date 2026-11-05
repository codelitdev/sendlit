"use client";

import { ChevronDown } from "lucide-react";
import type { ReactNode } from "react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

/** One collapsible topic of a dialog body: status icon, name, one-line
 * summary, status pill and chevron (see the dialog guidelines in AGENTS.md). */
export function DialogSection({
  open,
  onOpenChange,
  icon,
  iconClassName = "bg-[var(--warning-soft)] text-[var(--warning)]",
  name,
  summary,
  badge,
  children,
}: {
  open: boolean;
  onOpenChange?: (open: boolean) => void;
  icon: ReactNode;
  iconClassName?: string;
  name: string;
  summary: string;
  badge: ReactNode;
  children: ReactNode;
}) {
  return (
    <Collapsible
      open={open}
      onOpenChange={onOpenChange}
      className="rounded-lg border bg-card"
    >
      <CollapsibleTrigger className="flex w-full items-center gap-4 rounded-lg px-5 py-4 text-left outline-none focus-visible:shadow-[var(--shadow-focus)]">
        <span
          className={cn(
            "grid size-9 shrink-0 place-items-center rounded-full text-sm font-bold",
            iconClassName,
          )}
        >
          {icon}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{name}</span>
          <span className="block text-sm text-muted-foreground">{summary}</span>
        </span>
        {badge}
        <ChevronDown
          className={cn(
            "size-4 shrink-0 text-muted-foreground transition-transform",
            open && "rotate-180",
          )}
        />
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-4 px-5 pb-5 sm:pl-[4.75rem]">
        {children}
      </CollapsibleContent>
    </Collapsible>
  );
}
