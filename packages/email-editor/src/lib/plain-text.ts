import { toPlainText } from "@react-email/render";

/**
 * Converts rendered email HTML into the `text/plain` alternative part sent
 * alongside it. Links become `text (url)`, list items get a `• ` bullet, and
 * images, the hidden preheader, `<head>`, styles and scripts are dropped.
 */
export function renderEmailToPlainText(html: string): string {
  return toPlainText(html, {
    selectors: [
      {
        selector: "a",
        options: { linkBrackets: ["(", ")"], hideLinkHrefIfSameAsText: true },
      },
      { selector: "ul", options: { itemPrefix: "• " } },
      { selector: "h1", options: { uppercase: false } },
      { selector: "h2", options: { uppercase: false } },
      { selector: "h3", options: { uppercase: false } },
      { selector: "h4", options: { uppercase: false } },
      { selector: "h5", options: { uppercase: false } },
      { selector: "h6", options: { uppercase: false } },
      { selector: "table", format: "block" },
      { selector: "tr", format: "block" },
      { selector: "td", format: "block" },
      { selector: "th", format: "block" },
    ],
  })
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
