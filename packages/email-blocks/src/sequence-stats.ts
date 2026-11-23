import type { SequenceAnalyticsMetric } from "./sequence-analytics";
import type { SequenceStats } from "./types";

/** Opens the recipients behind the bounce rate or the spam complaint rate.
 * Each is only offered when its rate is above zero. */
export interface SequenceStatsActions {
  onViewBounced?: () => void;
  onViewComplained?: () => void;
}

/** Maps sequence or broadcast stats to `SequenceAnalytics` metrics. Pass
 * `waiting` (from the schedule) to show contacts still waiting for an email. */
export function sequenceStatsMetrics(
  stats: SequenceStats,
  waiting?: number,
  actions: SequenceStatsActions = {},
): SequenceAnalyticsMetric[] {
  return [
    { label: "Sent", value: stats.sent },
    { label: "Recipients", value: stats.subscribersCount },
    ...(waiting !== undefined
      ? [
          {
            label: "Waiting",
            value: waiting,
            helpText: "Contacts in the sequence waiting for their next email.",
          },
        ]
      : []),
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
            helpText:
              "Share of sent emails that bounced. Sending pauses above 2%, checked once 100 emails have gone out.",
            ...(stats.bounceRate > 0 && actions.onViewBounced
              ? {
                  onSelect: actions.onViewBounced,
                  selectLabel: "View recipients who bounced",
                }
              : {}),
          },
          {
            label: "Spam complaints",
            value: `${((stats.complaintRate ?? 0) * 100).toFixed(2)}%`,
            helpText:
              "Share of sent emails marked as spam. Sending pauses above 0.08%, checked once 100 emails have gone out.",
            ...((stats.complaintRate ?? 0) > 0 && actions.onViewComplained
              ? {
                  onSelect: actions.onViewComplained,
                  selectLabel: "View recipients who marked it as spam",
                }
              : {}),
          },
        ]
      : []),
  ];
}
