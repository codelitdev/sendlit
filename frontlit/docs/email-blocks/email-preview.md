---
title: EmailPreview
description: Render a scaled email preview.
nav_order: 110
---

`EmailPreview` renders email HTML into a sandboxed iframe and scales it to the available width.

You can try this component live in the [interactive demo](https://docs.sendlit.app/email-blocks/email-preview/).

## Usage

This is the exact code behind the demo above (using `defaultTemplateEmail` here for brevity — the
demo renders a fuller sample email).

```tsx
import { EmailPreview, defaultTemplateEmail } from "@sendlit/email-blocks";

function Example() {
    return <EmailPreview content={defaultTemplateEmail} minHeight="360px" />;
}
```
