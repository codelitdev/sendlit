---
"@sendlit/email-blocks": patch
---

`SequenceReport.autoPause.reason` can now be `render_error`: SendLit paused a broadcast or sequence because its email couldn't be built (for example the managed footer or the mailing address), keeping its recipients queued until it is resumed.
