# @sendlit/email-editor

## 0.3.0

### Minor Changes

- a48af67: A redesigned email editor focused on writing. Write mode puts the subject and preview text above the email, edits text inline as markdown with a format bar, a `/` block menu and `{{` merge tags, and reorders blocks by dragging; Style mode previews desktop, mobile, sample data and a dark inbox beside a palette, typography and block panel. Text is written paragraph by paragraph: Enter starts a new paragraph or list item, Backspace joins paragraphs, markdown shortcuts (`#`, `##`, `-`, `1.`, `>`) turn a paragraph into a heading, list or quote, and merge tags show as chips; text blocks are still stored as one markdown block each. Blocks can define `quickEdit` for the compact popover shown while writing. Adds undo and redo, a "Before you send" checklist (with one-click fallbacks for merge tags), and `subject`, `onSubjectChange`, `variables`, `senderName`, `theme` and `defaultMode` props on `EmailEditor`.

  New blocks: `spacer`, `columns`, `social`, `html` and `conditional` (a section shown to contacts with or without a tag; marketing only). The API validates them on write, and rejects `conditional` blocks in transactional content with `conditional_not_allowed`. `renderEmailToHtml` takes `showConditionals` for previews.

## 0.2.0

### Minor Changes

- ba8c4a3: Add `renderEmailToPlainText` for the plain-text alternative of a rendered email, and an optional "View in browser" link in the managed footer (`renderContext.footer.viewInBrowserUrl` with the `viewInBrowser` label). The default email no longer starts with a plain "View in browser" line that linked nowhere.

## 0.1.0

### Patch Changes

- 092f599: Add the `repository` field to the package manifest so npm can verify trusted publishing.
