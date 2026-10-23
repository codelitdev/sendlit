import type { SequenceAnalyticsMetric, SequenceStats } from "@sendlit/email-blocks";

/** Maps sequence/broadcast stats to `SequenceAnalytics` metrics. */
export function sequenceStatsMetrics(stats: SequenceStats): SequenceAnalyticsMetric[] {
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
    ...(stats.bounceRate !== undefined
      ? [
          {
            label: "Bounce rate",
            value: `${(stats.bounceRate * 100).toFixed(1)}%`,
            helpText: "Share of sent emails that bounced. Sending pauses above 2%.",
          },
          {
            label: "Spam complaints",
            value: `${((stats.complaintRate ?? 0) * 100).toFixed(2)}%`,
            helpText:
              "Share of sent emails marked as spam. Sending pauses above 0.08%.",
          },
        ]
      : []),
  ];
}
