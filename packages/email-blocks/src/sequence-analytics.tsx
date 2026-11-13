"use client";

import { HelpCircle, RefreshCw } from "lucide-react";
import { useState } from "react";
import { Button } from "./components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "./components/ui/tooltip";
import { cn } from "./lib/utils";

export interface SequenceAnalyticsMetric {
  label: string;
  value: string | number;
  helpText?: string;
}

export interface SequenceAnalyticsProps {
  metrics: SequenceAnalyticsMetric[];
  title?: string;
  /** Reloads the stats. When set, the header shows a refresh button that
   * spins until the returned promise settles. */
  onRefresh?: () => Promise<void> | void;
  className?: string;
}

/** Renders aggregate email performance metrics for a sequence or broadcast. */
export function SequenceAnalytics({
  metrics,
  title = "Email Performance",
  onRefresh,
  className,
}: SequenceAnalyticsProps) {
  return (
    <section className={cn("rounded-lg border p-4", className)}>
      <div className="mb-4 flex items-center justify-between gap-2">
        <h3 className="min-w-0 truncate text-base font-semibold">{title}</h3>
        {onRefresh ? <RefreshButton onRefresh={onRefresh} /> : null}
      </div>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
        {metrics.map((metric, index) => (
          <div
            // biome-ignore lint/suspicious/noArrayIndexKey: metrics have no id and labels may repeat; list is display-only and not reordered
            key={`${metric.label}-${index}`}
            className="min-w-0 text-center"
          >
            <div className="mb-1 flex items-center justify-center gap-1 text-xs text-muted-foreground">
              <span className="truncate">{metric.label}</span>
              {metric.helpText && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      className="inline-flex shrink-0"
                      aria-label={`${metric.label} info`}
                    >
                      <HelpCircle className="size-3 text-muted-foreground" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent className="w-48">{metric.helpText}</TooltipContent>
                </Tooltip>
              )}
            </div>
            <p className="truncate text-2xl font-bold">{metric.value}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

/** Reloads the numbers without reloading the page. */
export function RefreshButton({
  onRefresh,
}: {
  onRefresh: () => Promise<void> | void;
}) {
  const [refreshing, setRefreshing] = useState(false);

  async function refresh() {
    setRefreshing(true);
    try {
      await onRefresh();
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className="size-8 shrink-0"
      aria-label="Refresh stats"
      title="Refresh stats"
      disabled={refreshing}
      onClick={() => void refresh()}
    >
      <RefreshCw className={cn("size-4", refreshing && "animate-spin")} />
    </Button>
  );
}
