---
"sendlit": minor
"@sendlit/email-blocks": minor
---

Draft and publish for broadcast and sequence emails. While a broadcast or sequence is active (a running sequence or a scheduled broadcast), `sequences.updateEmail` saves subject and content changes as a draft (the email's `draft`, with `hasUnpublishedChanges` on the email and the sequence) and sends keep using the published version. New methods: `sequences.publishChanges` (with `scope: "in_flight" | "new_entrants"` for sequences), `sequences.discardChanges`, `sequences.emailVersions` and `sequences.restoreEmailVersion`. `@sendlit/email-blocks` adds `draft` and `hasUnpublishedChanges` to its sequence types.
