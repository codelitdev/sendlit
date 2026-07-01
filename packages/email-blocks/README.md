# Email Blocks
This package contains headless ready to use email blocks for:
- broadcasts
- sequences
- templates

Simply throw in these components into your app and they will render fully working blocks which provide end to end functionality for composing emails.

## Architecture

Every block accepts a `value` prop and `onChange` prop; this package holds no
network/data-fetching logic itself — `apps/web` wires these components up to
`@sendlit/api`'s REST endpoints.

## Components

- `TemplateForm` — title + WYSIWYG content editor for a reusable email template.
- `SequenceMetaForm` — title/sender + audience filter (broadcasts) or trigger
  (sequences).
- `SequenceEmailForm` — subject + WYSIWYG content + delay/tag-action for one
  email inside a sequence (or the single email of a broadcast).
- `SequenceEmailList` — ordered list of a sequence's steps, for picking one to edit.
- `ContactFilterBuilder` — builds a `ContactFilterWithAggregator` (tag / email /
  subscription / signup-date conditions).
- `TriggerPicker` — picks the event (`tag:added`, `tag:removed`,
  `subscriber:added`) that enrolls contacts into a sequence.
- `TagEditor` — add/remove tags on a contact.

All components are built on `@sendlit/email-editor` and the same vendored
shadcn/ui primitives (Button, Input, Select, Switch, etc.) so they compose
cleanly with the rest of the SendLit UI.

## Status

Used by `apps/web`'s dashboard. See the root [`ARCHITECTURE.md`](../../ARCHITECTURE.md)
for the overall project roadmap.
