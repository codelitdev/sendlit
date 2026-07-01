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
