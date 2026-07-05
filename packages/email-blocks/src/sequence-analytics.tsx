"use client";

import { HelpCircle } from "lucide-react";
import {
    Tooltip,
    TooltipContent,
    TooltipTrigger,
} from "./components/ui/tooltip";
import { cn } from "./lib/utils";

export interface SequenceAnalyticsMetric {
    label: string;
    value: string | number;
    helpText?: string;
}

export interface SequenceAnalyticsProps {
    metrics: SequenceAnalyticsMetric[];
    title?: string;
    className?: string;
}

/** Renders aggregate email performance metrics for a sequence or broadcast. */
export function SequenceAnalytics({
    metrics,
    title = "Email Performance",
    className,
}: SequenceAnalyticsProps) {
    return (
        <section className={cn("rounded-lg border p-4", className)}>
            <h3 className="mb-4 text-base font-semibold">{title}</h3>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                {metrics.map((metric, index) => (
                    <div
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
                                    <TooltipContent className="w-48">
                                        {metric.helpText}
                                    </TooltipContent>
                                </Tooltip>
                            )}
                        </div>
                        <p className="truncate text-2xl font-bold">
                            {metric.value}
                        </p>
                    </div>
                ))}
            </div>
        </section>
    );
}
