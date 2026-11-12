# @sendlit/email-blocks

## 0.5.2

### Patch Changes

- Updated dependencies [bf1a80b]
  - @sendlit/email-editor@0.3.1

## 0.5.1

### Patch Changes

- 5eafaa3: The contact filter builder's segment and filter popovers now stay on screen. They are capped to the space left in the viewport and scroll, so a long list of filters no longer runs off the edge.

## 0.5.0

### Minor Changes

- 3ff09da: Draft and publish for broadcast and sequence emails. While a broadcast or sequence is active (a running sequence or a scheduled broadcast), `sequences.updateEmail` saves subject and content changes as a draft (the email's `draft`, with `hasUnpublishedChanges` on the email and the sequence) and sends keep using the published version. New methods: `sequences.publishChanges` (with `scope: "in_flight" | "new_entrants"` for sequences), `sequences.discardChanges`, `sequences.emailVersions` and `sequences.restoreEmailVersion`. `@sendlit/email-blocks` adds `draft` and `hasUnpublishedChanges` to its sequence types.

## 0.4.0

### Minor Changes

- 449174b: `SequenceReport.autoPause.reason` can now be `render_error`: SendLit paused a broadcast or sequence because its email couldn't be built (for example the managed footer or the mailing address), keeping its recipients queued until it is resumed.
- a48af67: A redesigned email editor focused on writing. Write mode puts the subject and preview text above the email, edits text inline as markdown with a format bar, a `/` block menu and `{{` merge tags, and reorders blocks by dragging; Style mode previews desktop, mobile, sample data and a dark inbox beside a palette, typography and block panel. Text is written paragraph by paragraph: Enter starts a new paragraph or list item, Backspace joins paragraphs, markdown shortcuts (`#`, `##`, `-`, `1.`, `>`) turn a paragraph into a heading, list or quote, and merge tags show as chips; text blocks are still stored as one markdown block each. Blocks can define `quickEdit` for the compact popover shown while writing. Adds undo and redo, a "Before you send" checklist (with one-click fallbacks for merge tags), and `subject`, `onSubjectChange`, `variables`, `senderName`, `theme` and `defaultMode` props on `EmailEditor`.

  New blocks: `spacer`, `columns`, `social`, `html` and `conditional` (a section shown to contacts with or without a tag; marketing only). The API validates them on write, and rejects `conditional` blocks in transactional content with `conditional_not_allowed`. `renderEmailToHtml` takes `showConditionals` for previews.

### Patch Changes

- Updated dependencies [a48af67]
  - @sendlit/email-editor@0.3.0

## 0.3.0

### Minor Changes

- 902cd16: `TriggerPicker` adds the `event:custom` and `contact:property_changed` triggers: a combobox for the event name or custom field (`valueOptions`, `onCreateValue`), a property filter for events (`triggerFilter`, `eventProperties`) or from/to values for field changes, a `valueFooter` slot and `labels` overrides. `onChange` now also returns `triggerFilter`. Also exports `EventPropertyFilterEditor` and `ValueCombobox`, and the `EventDefinition`, `EventPropertyFilter`, `PropertyChangeFilter` and `ReentryMode` types.
- db0c687: A broadcast or sequence has a `viewInBrowser` setting. It is on for broadcasts and off for sequences created from now on; existing sequences keep it on. Turning it off sends its emails without the "View in browser" link and takes down the hosted web versions behind links already sent. `@sendlit/email-blocks` adds `viewInBrowser` to its sequence type.

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
