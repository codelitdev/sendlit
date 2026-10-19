import { describe, expect, it } from "bun:test";
import { defaultEmail } from "./default-email";
import { renderEmailToHtml } from "./email-renderer";
import { renderEmailToPlainText } from "./plain-text";

describe("renderEmailToPlainText", () => {
  it("keeps link targets, bullets the lists and drops the preheader and images", () => {
    const text =
      renderEmailToPlainText(`<html><head><style>p{color:red}</style></head><body>
      <div data-skip-in-text="true">Hidden preheader</div>
      <h1>Big news</h1>
      <p>Read <a href="https://example.com/post">the post</a>.</p>
      <p><a href="https://example.com">https://example.com</a></p>
      <ul><li>One</li><li>Two</li></ul>
      <img src="https://example.com/pixel.gif" alt="">
      <p></p><p></p><p>End</p>
    </body></html>`);

    expect(text).toContain("Big news");
    expect(text).toContain("Read the post (https://example.com/post).");
    expect(text).toContain("https://example.com\n");
    expect(text).not.toContain("(https://example.com)");
    expect(text).toContain("• One\n• Two");
    expect(text).not.toContain("Hidden preheader");
    expect(text).not.toContain("pixel.gif");
    expect(text).not.toContain("color:red");
    expect(text).not.toMatch(/\n{3,}/);
  });

  it("converts a rendered editor email", async () => {
    const html = await renderEmailToHtml({
      email: {
        ...defaultEmail,
        meta: { previewText: "Preview line" },
        content: [
          {
            blockType: "text",
            settings: {
              content: "# Hello\n\nVisit [our site](https://example.com/x).",
            },
          },
        ],
      },
    });
    const text = renderEmailToPlainText(html);

    expect(text).toContain("Hello");
    expect(text).toContain("our site (https://example.com/x)");
    expect(text).not.toContain("Preview line");
  });
});
