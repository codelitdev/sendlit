---
"@sendlit/email-editor": patch
---

Apps that build Tailwind themselves can now load just the editor's own stylesheet, `@sendlit/email-editor/editor.css`, instead of `styles.css`. Since 0.3.0 the editor's look comes from plain CSS that a Tailwind `@source` scan can't produce, and `styles.css` also carries a full Tailwind build, base reset and theme variables that restyle the host app. The README now explains which to use.
