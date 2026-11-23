---
"sendlit": minor
"@sendlit/email-blocks": minor
---

See which recipients bounced or complained from a broadcast or sequence:

- SDK: `sequences.deliveries(sequenceId, { outcome })` and `sequences.listAllDeliveries()` list each send with its outcome, bounce type, the ESP's reason and the address's suppression. Contact deliveries now include `messageId` and `outcome`.
- `SequenceAnalyticsMetric` takes `onSelect` and `selectLabel`, which render the value as a button. `sequenceStatsMetrics` takes `onViewBounced` and `onViewComplained` to open the recipients behind the bounce and complaint rates.
- The bounce and complaint tooltips say sending only pauses once 100 emails have gone out.
