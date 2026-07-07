import type {
    SequenceAnalyticsMetric,
    SequenceStats,
} from "@sendlit/email-blocks";

/** Maps sequence/broadcast stats to `SequenceAnalytics` metrics. */
export function sequenceStatsMetrics(
    stats: SequenceStats,
): SequenceAnalyticsMetric[] {
    return [
        { label: "Sent", value: stats.sent },
        { label: "Recipients", value: stats.subscribersCount },
        {
            label: "Open rate",
            value: `${Math.round(stats.openRate * 100)}%`,
            helpText: "Share of delivered emails that were opened.",
        },
        {
            label: "Click rate",
            value: `${Math.round(stats.clickThroughRate * 100)}%`,
            helpText: "Share of delivered emails with at least one link click.",
        },
    ];
}
