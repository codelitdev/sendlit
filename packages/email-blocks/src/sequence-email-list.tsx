"use client";

import { ChevronDown, ChevronUp, Mail, Plus, Trash2 } from "lucide-react";
import { Button } from "./components/ui/button";
import { cn } from "./lib/utils";
import type { SequenceEmail } from "./types";

export interface SequenceEmailListProps {
  emails: SequenceEmail[];
  emailsOrder: string[];
  selectedEmailId?: string;
  onSelect: (emailId: string) => void;
  onAdd: () => void;
  onDelete: (emailId: string) => void;
  /** Called with the full reordered list of email ids when the user moves a
   * step up/down. Omit to hide the reordering controls (e.g. for broadcasts,
   * which only ever have one email). */
  onReorder?: (emailsOrder: string[]) => void;
  className?: string;
}

function formatDelay(ms: number): string {
  if (ms <= 0) return "Immediately";
  const days = ms / 86400000;
  return `${days % 1 === 0 ? days : days.toFixed(1)} day${days === 1 ? "" : "s"} later`;
}

function swap(order: string[], index: number, direction: -1 | 1): string[] {
  const next = [...order];
  const target = index + direction;
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

/** Lists the steps of a sequence in order, letting you pick one to edit,
 * reorder (move up/down) and delete. */
export function SequenceEmailList({
  emails,
  emailsOrder,
  selectedEmailId,
  onSelect,
  onAdd,
  onDelete,
  onReorder,
  className,
}: SequenceEmailListProps) {
  const ordered = emailsOrder
    .map((id) => emails.find((e) => e.emailId === id))
    .filter((e): e is SequenceEmail => Boolean(e));

  return (
    <div className={cn("space-y-2", className)}>
      {ordered.map((email, index) => (
        <div
          key={email.emailId}
          onClick={() => onSelect(email.emailId)}
          className={cn(
            "flex cursor-pointer items-center gap-3 rounded-lg border p-3 text-sm transition-colors hover:bg-accent",
            selectedEmailId === email.emailId && "border-primary bg-accent",
          )}
        >
          <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium">
            {index + 1}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium">
              {email.subject || "Untitled email"}
            </p>
            <p className="truncate text-xs text-muted-foreground">
              {formatDelay(email.delayInMillis)}
              {" · "}
              {email.published ? "Published" : "Draft"}
            </p>
          </div>
          {onReorder && ordered.length > 1 && (
            <div className="flex flex-col">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-6"
                disabled={index === 0}
                onClick={(e) => {
                  e.stopPropagation();
                  onReorder(swap(emailsOrder, index, -1));
                }}
                aria-label="Move up"
              >
                <ChevronUp className="size-3.5" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-6"
                disabled={index === ordered.length - 1}
                onClick={(e) => {
                  e.stopPropagation();
                  onReorder(swap(emailsOrder, index, 1));
                }}
                aria-label="Move down"
              >
                <ChevronDown className="size-3.5" />
              </Button>
            </div>
          )}
          {ordered.length > 1 && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={(e) => {
                e.stopPropagation();
                onDelete(email.emailId);
              }}
            >
              <Trash2 className="size-4" />
            </Button>
          )}
        </div>
      ))}

      {ordered.length === 0 && (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          <Mail className="size-5" />
          No emails yet.
        </div>
      )}

      <Button type="button" variant="outline" size="sm" onClick={onAdd}>
        <Plus className="size-4" />
        Add email
      </Button>
    </div>
  );
}
