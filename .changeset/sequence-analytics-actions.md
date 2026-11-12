---
"@sendlit/email-blocks": minor
---

Share more of the dashboard's mail building blocks so hosts don't re-implement them:

- `SequenceAnalytics` takes `onRefresh` and shows a refresh button in its header.
- `sequenceStatsMetrics` maps `SequenceStats` to `SequenceAnalytics` metrics.
- `ViewInBrowserSetting` is the "View in browser" switch for a broadcast or sequence.
- `@sendlit/email-blocks/footer` exports `marketingPreviewContext`, which leaves the "View in browser" link out of previews when the setting is off, and `DEFAULT_FOOTER_LABELS`; `createFooterBlock()` uses those labels when none are given.
