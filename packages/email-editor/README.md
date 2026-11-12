# @sendlit/email-editor

A React editor for designing marketing and transactional emails, by
[SendLit](https://github.com/codelitdev/sendlit).

You write the email like a document: type paragraphs, press `/` to add blocks
(buttons, images, columns and more) and `{{` to add merge tags such as the
reader's name. Switch to **Style** mode to pick colours and fonts and to preview
the email on desktop, on mobile and in a dark-mode inbox. When you're done,
turn the email into HTML that works in mail clients.

## Installation

```sh
npm i @sendlit/email-editor
```

It needs React 19.

## Quick start

The editor works on an `Email` object: its blocks and its style. Keep it in
state, pass it in, and save it whenever `onChange` gives you a new one.

```tsx
import { useState } from "react";
import { EmailEditor, defaultEmail, type Email } from "@sendlit/email-editor";
import "@sendlit/email-editor/styles.css";

export default function App() {
  const [email, setEmail] = useState<Email>(defaultEmail);

  return (
    // The editor fills its container, so give it a height.
    <div style={{ height: "100vh" }}>
      <EmailEditor email={email} onChange={setEmail} />
    </div>
  );
}
```

The editor keeps track of edits and undo history itself, so passing the value
from `onChange` back in is safe: it recognises its own change. Passing a
different email, such as one you just loaded, replaces what's in the editor
and clears its undo history.

## Sending the email

The `Email` object is what you store. To send it, turn it into HTML and,
optionally, a plain-text version:

```ts
import { renderEmailToHtml, renderEmailToPlainText } from "@sendlit/email-editor";

const html = await renderEmailToHtml({ email });
const text = renderEmailToPlainText(html);
```

The HTML is built with [React Email](https://react.email/), which produces
table-based markup that mail clients such as Gmail and Outlook display
correctly.

## Options

| Prop              | What it does                                                                                       |
| ----------------- | -------------------------------------------------------------------------------------------------- |
| `email`           | The email to start with. Required.                                                                 |
| `onChange`        | Called with the updated email after every change. Required.                                        |
| `subject`         | The subject line, shown above the email. Leave it out to hide the subject field.                   |
| `onSubjectChange` | Called when the subject changes. Saving it is up to you.                                           |
| `variables`       | Merge tags offered after `{{`, for example `{ tag: "{{ subscriber.name }}", description: "Name", sample: "Priya" }`. `sample` is shown when "Sample data" is on. |
| `senderName`      | The sender shown in the inbox preview.                                                             |
| `theme`           | The editor's own look: `"sendlit"` (default), `"neutral"` or `"dark"`. This doesn't change the email. |
| `defaultMode`     | `"write"` (default) or `"style"`.                                                                  |
| `blocks`          | The block types to offer. See [Choosing blocks](#choosing-blocks).                                 |
| `renderContext`   | Data your own blocks need to render, such as an unsubscribe link. It is never saved in the email.  |

## Writing and styling

**Write** mode is for the words:

- Type as you would in a document. Start a line with `#` for a heading, `-` for
  a list or `>` for a quote. Select text for bold, italic and links.
- Press `/` for the block menu, or `{{` for merge tags.
- Drag a block by its handle to move it.
- Undo and redo with Ctrl/⌘+Z and Shift+Ctrl/⌘+Z.
- The subject and the preview text (the line inboxes show after the subject)
  sit above the email, with an inbox preview.

**Style** mode is for the look:

- Pick a palette (Default, Warm, Forest, Mono, Plain or Night) or set your own
  colours and fonts. Fonts apply to the whole email; blocks don't have their
  own.
- Select a block to change its settings.
- Preview on desktop or mobile, with sample data, or in a dark-mode inbox.

A **"Before you send"** checklist flags common problems, such as a missing
subject or preview text, an empty button or an image without alt text.

## Built-in blocks

| Block         | What it is                                                       |
| ------------- | ---------------------------------------------------------------- |
| `text`        | Paragraphs, headings, lists and quotes, written as markdown      |
| `link`        | A link, or a button                                              |
| `image`       | An image with alt text, size and alignment                       |
| `separator`   | A divider line                                                   |
| `spacer`      | Empty space                                                      |
| `columns`     | Two columns of text that can stack on small screens              |
| `social`      | Buttons linking to your social profiles                          |
| `html`        | Your own HTML, sent as written                                   |
| `conditional` | Text shown only to contacts with (or without) a tag              |

A `conditional` block is sent as a [Liquid](https://shopify.github.io/liquid/)
condition on `subscriber.tags`, so it needs a sending tool that fills in
subscriber data. Pass `showConditionals: true` to `renderEmailToHtml` to
preview every section.

## Choosing blocks

`blocks` replaces the default list, so you can leave out built-in blocks or
add your own:

```tsx
import { Image, Link, Text } from "@sendlit/email-editor/blocks";

<EmailEditor email={email} onChange={setEmail} blocks={[Text, Link, Image]} />;
```

A block is an object with a `block` component (how it looks), a `settings`
component (its form in Style mode), `metadata` (name, label and icon) and
`defaultSettings`. It can also have a `quickEdit` component with the few fields
worth changing while writing, shown in a small popover. Writing paragraph by
paragraph only works with the built-in `text` block; without it, every block
is added from the menu and edited through its settings.

## Accessibility

We build and test the editor against
[WCAG 2.2](https://www.w3.org/TR/WCAG22/) at **Level AA**, the level most
accessibility laws and policies ask for.

**Using the editor**

- Everything works from the keyboard. Each paragraph or block is one Tab stop,
  and focus is always visible and never lost when a popover or menu closes.
- Controls follow the [WAI-ARIA Authoring Practices](https://www.w3.org/WAI/ARIA/apg/)
  for tabs, menus, listboxes and toolbars, so screen readers announce them as
  expected. Rows are named after their content ("Paragraph: Thanks for
  joining", "Button block: Get started"), and moves and messages are announced.
- Links and buttons inside the email preview can't be followed by accident.
- We check the editor with [axe-core](https://github.com/dequelabs/axe-core)
  and by hand with the keyboard.

**The emails you make**

- The built-in palettes keep text at a contrast ratio of at least **4.5:1**
  (WCAG AA). Choosing a palette recolours the blocks to match, and the
  dark-inbox preview lightens text and links the way dark-mode mail apps do.
- The checklist reminds you to give images alt text.
- Colours you pick yourself aren't checked, so check their contrast when you
  change them.

This is our own testing, not a formal audit or certification. If you find a
barrier, please [open an issue](https://github.com/codelitdev/sendlit/issues).

### Keyboard shortcuts

| Key                        | Does                                                         |
| -------------------------- | ------------------------------------------------------------ |
| Tab, Shift+Tab             | Moves between paragraphs, blocks and controls                |
| Enter on a row             | Edits a paragraph, or opens a block's settings               |
| Escape                     | Stops editing or closes the settings, staying on the row     |
| ↑ / ↓                      | Moves between paragraphs and blocks, and up to the preview text |
| Alt+Shift+↑ / ↓            | Moves the current paragraph or block up or down              |
| `/`, `{{`                  | Opens the block menu or the merge tag menu                   |
| Ctrl/⌘+B, I, K             | Bold, italic, link                                           |
| Alt+F10                    | Moves to the format toolbar while text is selected           |
| Ctrl/⌘+Z, Shift+Ctrl/⌘+Z   | Undo, redo                                                   |

In Style mode, Enter on a block moves to its settings, Escape returns to the
block, and the arrow keys move between blocks.

## Styling the editor

`styles.css` is pre-built and contains everything the editor needs, so you
don't need Tailwind CSS. The editor's own look comes from `--sle-*` CSS
variables on the `.sle` element (colours, corner radii and fonts). Override
them in a stylesheet loaded after `styles.css` to re-skin it without touching
the components:

```css
.sle {
  --sle-accent: #7c3aed;
  --sle-font: "Inter", sans-serif;
}
```

For the `neutral` and `dark` themes, use `.sle.t-neutral` or `.sle.t-dark` as
the selector instead.

If your app already uses Tailwind CSS, don't load `styles.css`: it carries its
own Tailwind build, base reset and theme variables, which would restyle the
rest of your app. Instead, let your Tailwind build the editor's utility classes
and load only the editor's own stylesheet:

```ts
import "@sendlit/email-editor/editor.css";
```

- **Tailwind v4:** add `@source "./node_modules/@sendlit/email-editor";` to your CSS.
- **Tailwind v3:** add `"./node_modules/@sendlit/email-editor"` to `content` in
  your Tailwind config.

`editor.css` only styles the editor (its rules are scoped to `.sle`), so it is
safe to load next to your own styles.

## Built with

[React](https://react.dev/), [React Email](https://react.email/),
[shadcn/ui](https://ui.shadcn.com/) and [Tailwind CSS](https://tailwindcss.com/).

## License

MIT
