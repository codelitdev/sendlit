# Email Blocks

Headless, ready-to-use, and fully customizable React components for building
your own email workflow UIs — broadcasts, sequences, templates, contact
segmentation — powered by SendLit.

These aren't drop-in pages; they're building blocks. Each one owns a single,
well-scoped piece of UI (a filter builder, a trigger picker, a paginated
subscriber list, a template chooser, ...) so you can assemble your own
broadcast/sequence composer, contact editor, or analytics view out of them,
in whatever layout your app actually needs — rather than being forced into
one prescribed page shape.

## Install

```bash
npm install @sendlit/email-blocks
```

See [Getting Started](https://sendlit.dev/email-blocks/getting-started)
for the peer dependency and Tailwind setup this package needs (it ships
utility classes and shadcn theme tokens, not a compiled stylesheet).

## Architecture

Every component is fully controlled: a `value`/current-state prop in, an
`onChange`/`onSelect`/etc. callback out. This package holds no
network/data-fetching or persistence logic itself — the host app owns state,
API calls, and how the pieces are laid out together.

Every visible string a component renders — labels, button text, dialog
copy, aria-labels — is an optional prop with a sensible English default, so
you can localize or reword anything without forking the component.

## Components

- `ContactFilterBuilder` — segment picker, filter builder (tag / email /
  subscription / signup-date conditions, plus host-injectable custom filter
  types), applied-filter chips, and optional segment save/delete.
- `TriggerPicker` — picks the event (`tag:added`, `tag:removed`,
  `subscriber:added`, or host-supplied custom triggers) that enrolls contacts
  into a sequence.
- `TagEditor` — combobox for a contact's tags: chips, a dropdown of existing
  tags, and create-new.
- `TemplateChooser` — grid of system + saved templates with real rendered
  previews, for picking a starting point.
- `SequenceEmailList` — ordered list of a sequence's steps: pick one to
  edit, reorder, delete (with a confirmation dialog), and add a new one from
  a template.
- `SequenceAnalytics` — aggregate delivery metrics (sent, open rate, click
  rate, ...) for a broadcast or sequence.
- `SubscriberList` — paginated list of a sequence/broadcast's subscribers,
  with avatars and optional profile links.
- `EmailPreview` — real (not mocked) scaled-down preview of an email's
  content, rendered through the same pipeline used for outgoing mail.
- `EmailEditor` and the rest of `@sendlit/email-editor`'s surface (`Email`,
  `EmailBlock`, `renderEmailToHtml`, `defaultEmail`, ...) are re-exported in
  full, so this one dependency covers both composing flows and
  editing/rendering the emails inside them.

All components are built on `@sendlit/email-editor` and vendored shadcn/ui
primitives (Button, Input, Select, Switch, Dialog, AlertDialog, Command,
Popover, Avatar, etc.), following shadcn conventions throughout.

## Docs

Full prop reference and a live, editable demo for every component:
https://sendlit.dev/email-blocks/overview
