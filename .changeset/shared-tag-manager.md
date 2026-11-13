---
"@sendlit/email-blocks": minor
---

Add `TagManager`, the dashboard's Tags screen as a block, so hosts don't re-implement it. It lists every tag with its contact count, renames a tag everywhere it's used, and deletes one after showing the segments, broadcasts, sequences and signup forms that still name it. Hosts pass functions that call SendLit's `/tags` endpoints through their own backend. `TagSummary`, `TagReferences`, `RenameTagResult` and `DeleteTagResult` are exported for typing them.
