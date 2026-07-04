"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "./components/ui/avatar";
import { Button } from "./components/ui/button";
import { Skeleton } from "./components/ui/skeleton";
import { cn } from "./lib/utils";

export interface SubscriberListItem {
  id: string;
  email: string;
  name?: string | null;
  image?: string | null;
  /** Link to the subscriber's profile page. When set, the name/email renders as a link. */
  href?: string;
}

export interface SubscriberListProps {
  subscribers: SubscriberListItem[];
  /** Total subscriber count across all pages, used in the "(N)" heading suffix. Defaults to `subscribers.length` for unpaginated use. */
  totalCount?: number;
  title?: string;
  emptyMessage?: string;
  page?: number;
  totalPages?: number;
  onPageChange?: (page: number) => void;
  previousLabel?: string;
  nextLabel?: string;
  /** Shows skeleton rows and disables pagination instead of `subscribers`. */
  loading?: boolean;
  /** Number of skeleton rows to render while `loading`. */
  skeletonRowCount?: number;
  className?: string;
}

/** Paginated list of a sequence/broadcast's subscribers, each with an avatar, name, and email. */
export function SubscriberList({
  subscribers,
  totalCount,
  title = "Subscribers",
  emptyMessage = "No subscribers yet.",
  page = 1,
  totalPages = 1,
  onPageChange,
  previousLabel = "Previous",
  nextLabel = "Next",
  loading = false,
  skeletonRowCount = 5,
  className,
}: SubscriberListProps) {
  return (
    <div className={cn("space-y-3", className)}>
      <h3 className="text-base font-semibold">
        {loading ? (
          <Skeleton className="inline-block h-4 w-24 align-middle" />
        ) : (
          <>
            {title} ({(totalCount ?? subscribers.length).toLocaleString()})
          </>
        )}
      </h3>
      <div className="overflow-hidden rounded-lg border">
        {loading ? (
          <ul className="divide-y">
            {Array.from({ length: skeletonRowCount }).map((_, index) => (
              <li key={index} className="flex items-center gap-3 px-5 py-2.5">
                <Skeleton className="size-9 shrink-0 rounded-full" />
                <div className="min-w-0 flex-1 space-y-1.5">
                  <Skeleton className="h-4 w-48" />
                  <Skeleton className="h-3.5 w-36" />
                </div>
              </li>
            ))}
          </ul>
        ) : subscribers.length === 0 ? (
          <p className="px-5 py-8 text-sm text-muted-foreground">
            {emptyMessage}
          </p>
        ) : (
          <ul className="divide-y">
            {subscribers.map((subscriber) => (
              <li
                key={subscriber.id}
                className="flex items-center gap-3 px-5 py-2.5"
              >
                <Avatar className="size-9 shrink-0 text-sm font-medium text-muted-foreground">
                  {subscriber.image && (
                    <AvatarImage src={subscriber.image} alt="" />
                  )}
                  <AvatarFallback>
                    {(subscriber.name || subscriber.email)
                      .slice(0, 1)
                      .toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    {subscriber.href ? (
                      <a
                        href={subscriber.href}
                        className="hover:underline focus-visible:underline focus-visible:outline-none"
                      >
                        {subscriber.name || subscriber.email}
                      </a>
                    ) : (
                      subscriber.name || subscriber.email
                    )}
                  </p>
                  {subscriber.name && (
                    <p className="truncate text-sm text-muted-foreground">
                      {subscriber.email}
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
      {totalPages > 1 && onPageChange && (
        <nav
          aria-label="Subscriber list pagination"
          className="flex items-center justify-center gap-3"
        >
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="gap-1"
            disabled={loading || page <= 1}
            aria-label="Go to previous page"
            onClick={() => onPageChange(page - 1)}
          >
            <ChevronLeft className="size-4" aria-hidden="true" />
            {previousLabel}
          </Button>
          <span
            className="text-sm font-medium"
            aria-live="polite"
            aria-atomic="true"
          >
            {page} of {totalPages}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="gap-1"
            disabled={loading || page >= totalPages}
            aria-label="Go to next page"
            onClick={() => onPageChange(page + 1)}
          >
            {nextLabel}
            <ChevronRight className="size-4" aria-hidden="true" />
          </Button>
        </nav>
      )}
    </div>
  );
}
