# @sendlit/email-blocks

## 0.2.0

### Minor Changes

- ba8c4a3: Add `renderEmailToPlainText` for the plain-text alternative of a rendered email, and an optional "View in browser" link in the managed footer (`renderContext.footer.viewInBrowserUrl` with the `viewInBrowser` label). The default email no longer starts with a plain "View in browser" line that linked nowhere.
- 88c5b75: Types for the hosted sending safeguards. A sequence (broadcast) can now carry `contentScanVerdict` (`clean`, `review`, `blocked` or `approved`), `pacing` (set while a new hosted account's broadcast is sent gradually) and its `bounceRate` and `complaintRate`. A contact import accepts an optional `source`, such as the CSV file name, which is kept in the audit log. `@sendlit/email-blocks` adds the same fields to its sequence type, plus `autoPause`, which is set when SendLit paused a send because of bounces, complaints, repeated failures or an ESP error.

### Patch Changes

- ba8c4a3: `SequenceEmail` has an optional `lastTestSentAt`, when a test of the email was last sent.
- Updated dependencies [ba8c4a3]
  - @sendlit/email-editor@0.2.0

## 0.1.0

### Patch Changes

- 61c1818: Stop depending on the unpublished `@sendlit/api-contract` package. Its types are now inlined into the published type declarations.
- Updated dependencies [092f599]
  - @sendlit/email-editor@0.1.0
