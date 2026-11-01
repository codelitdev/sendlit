# Introduction

A WYSIWYG email editor by SendLit.

## Installation

The project depends of TailwindCSS, so you need to have it configured on your project, before installating this package.

```sh
npm i @sendlit/email-editor
```

### Importing the CSS

#### 1. Tailwind v4

In your CSS file, add

```css
@source "./node_modules/@sendlit/email-editor";
# ... remaining code ...
```

#### 2. Tailwind v3

In your tailwind config, add

```js
module.exports = {
    content: [
        // ... remaining code ...
        "./node_modules/@sendlit/email-editor",
    ],
    // ... remaining code ...
};
```

## Tech Stack

- [React](https://react.dev/)
- [TailwindCSS](https://tailwindcss.com/)
- [Shadcn/ui](https://ui.shadcn.com/)
- [React email](https://react.email/)

## Usage

To show the email editor

```js
import { EmailEditor } from "@sendlit/email-editor";
import "@sendlit/email-editor/styles.css";

export default App() {
    return (<EmailEditor  />)
}
```

## Writing mode, subject and merge tags

`EmailEditor` opens in Write mode (subject and preview text above the email, inline markdown text, a `/` block menu, `{{` merge tags, drag to reorder) and has a Style mode for the look and the selected block. Pass `subject` and `onSubjectChange` to edit the subject in the editor, `variables` for merge tags, `senderName` for the inbox preview and `theme` (`"sendlit"`, `"neutral"` or `"dark"`).

The editor's look is a set of `--sle-*` CSS variables on the `.sle` element, so it can be re-skinned without touching the components. The styles are in `@sendlit/email-editor/styles.css`.

Besides text, link, image and separator it ships `spacer`, `columns`, `social`, `html` and `conditional` blocks. A `conditional` block becomes a Liquid condition on `subscriber.tags` when rendered for sending; pass `showConditionals` to `renderEmailToHtml` to preview every section.

## Custom blocks

Pass `blocks` to choose the block types: add your own, and leave out any of the built-in ones. A block can provide `quickEdit` (and `quickEditLayout`) for the compact popover shown while writing; its full `settings` form appears in Style mode. Paragraph-by-paragraph writing applies to the built-in `text` block only, so a registry without it, or with a host block named `text`, gets ordinary selectable blocks.
