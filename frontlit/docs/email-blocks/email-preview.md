---
title: EmailPreview
description: Render a scaled email preview.
nav_order: 110
---

`EmailPreview` renders email HTML into a sandboxed iframe and scales it to the available width.

## Usage

A complete example (using `defaultTemplateEmail` for brevity):

```tsx
import { EmailPreview, defaultTemplateEmail } from "@sendlit/email-blocks";

function Example() {
    return <EmailPreview content={defaultTemplateEmail} minHeight="360px" />;
}
```
