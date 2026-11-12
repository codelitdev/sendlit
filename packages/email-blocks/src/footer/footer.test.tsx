import { describe, expect, it } from "bun:test";
import { defaultEmail, type Email, renderEmailToHtml } from "@sendlit/email-editor";
import {
  createFooterBlock,
  createFooterEmailBlock,
  DEFAULT_FOOTER_LABELS,
  marketingPreviewContext,
} from ".";

function labelsFor(viewInBrowser?: string) {
  return {
    displayName: "Footer",
    description: "Managed email footer",
    unsubscribe: "Unsubscribe",
    viewInBrowser,
    alignment: "Alignment",
    alignmentLeft: "Left",
    alignmentCenter: "Center",
    alignmentRight: "Right",
    foregroundColor: "Text color",
    backgroundColor: "Background color",
    fontSize: "Font size",
    paddingTop: "Top padding",
    paddingBottom: "Bottom padding",
    paddingX: "Horizontal padding",
  };
}

const footer = createFooterBlock({
  labels: {
    displayName: "Footer",
    description: "Managed email footer",
    unsubscribe: "Unsubscribe",
    alignment: "Alignment",
    alignmentLeft: "Left",
    alignmentCenter: "Center",
    alignmentRight: "Right",
    foregroundColor: "Text color",
    backgroundColor: "Background color",
    fontSize: "Font size",
    paddingTop: "Top padding",
    paddingBottom: "Bottom padding",
    paddingX: "Horizontal padding",
  },
});

function emailWithFooter(): Email {
  return {
    ...defaultEmail,
    content: [
      { blockType: "text", settings: { content: "Hello" } },
      createFooterEmailBlock(),
    ],
  };
}

describe("SendLit footer block", () => {
  it("renders server-owned address and unsubscribe values", async () => {
    const email = emailWithFooter();
    const html = await renderEmailToHtml({
      email,
      blocks: [footer],
      renderContext: {
        footer: {
          mailingAddress: "123 Main Street",
          unsubscribeUrl: "https://example.com/unsubscribe/token",
        },
      },
    });

    expect(html).toContain("123 Main Street");
    expect(html).toContain("https://example.com/unsubscribe/token");
    expect(html).toContain("Unsubscribe");
    expect(JSON.stringify(email)).not.toContain("123 Main Street");
    expect(JSON.stringify(email)).not.toContain("unsubscribe/token");
  });

  it("preserves multi-line mailing addresses with line breaks", async () => {
    const html = await renderEmailToHtml({
      email: emailWithFooter(),
      blocks: [footer],
      renderContext: {
        footer: {
          mailingAddress: "23 St Streets, Maine County\nNovark",
          unsubscribeUrl: "https://example.com/unsubscribe/token",
        },
      },
    });

    expect(html).toContain("23 St Streets, Maine County");
    expect(html).toContain("Novark");
    expect(html).toMatch(/Maine County\s*<br\s*\/?>\s*Novark/i);
    expect(html).toContain("https://example.com/unsubscribe/token");
  });

  it("links the web version when given a URL and a label", async () => {
    const withLabel = createFooterBlock({
      labels: labelsFor("View in browser"),
    });
    const html = await renderEmailToHtml({
      email: emailWithFooter(),
      blocks: [withLabel],
      renderContext: {
        footer: {
          mailingAddress: "123 Main Street",
          unsubscribeUrl: "https://example.com/unsubscribe/token",
          viewInBrowserUrl: "https://example.com/view/abc",
        },
      },
    });
    expect(html).toContain('href="https://example.com/view/abc"');
    expect(html).toContain("View in browser");

    const withoutLabel = await renderEmailToHtml({
      email: emailWithFooter(),
      blocks: [footer],
      renderContext: {
        footer: {
          mailingAddress: "123 Main Street",
          unsubscribeUrl: "https://example.com/unsubscribe/token",
          viewInBrowserUrl: "https://example.com/view/abc",
        },
      },
    });
    expect(withoutLabel).not.toContain("https://example.com/view/abc");
  });

  it("fails rendering when the managed context is absent", async () => {
    const html = await renderEmailToHtml({
      email: emailWithFooter(),
      blocks: [footer],
    });

    expect(html).toContain("footer_render_context_required");
  });

  it("uses the email's text font, not one saved on the footer", async () => {
    const email = emailWithFooter();
    const html = await renderEmailToHtml({
      email: {
        ...email,
        style: {
          ...email.style,
          typography: {
            ...email.style.typography,
            text: { ...email.style.typography.text, fontFamily: "Georgia, serif" },
          },
        },
        content: [{ blockType: "footer", settings: { fontFamily: "Courier" } }],
      },
      blocks: [footer],
      renderContext: {
        footer: {
          mailingAddress: "123 Main Street",
          unsubscribeUrl: "https://example.com/unsubscribe/token",
        },
      },
    });

    expect(html).toContain("Georgia, serif");
    expect(html).not.toContain("Courier");
  });

  it("is a locked final-placement add-on", () => {
    expect(footer.capabilities).toEqual({
      insertable: false,
      deletable: false,
      duplicable: false,
      movable: false,
      placement: "last",
    });
    expect(createFooterEmailBlock()).toEqual({
      blockType: "footer",
      settings: expect.objectContaining({
        alignment: "center",
        fontSize: "12px",
      }),
    });
  });
});

describe("marketingPreviewContext", () => {
  it("shows placeholder footer values with the view-in-browser link", () => {
    expect(marketingPreviewContext().footer).toEqual({
      mailingAddress: "Your mailing address",
      unsubscribeUrl: "#unsubscribe-preview",
      viewInBrowserUrl: "#view-in-browser-preview",
    });
  });

  it("leaves the link out when view in browser is off", () => {
    const footer = marketingPreviewContext({
      mailingAddress: "1 Main St",
      viewInBrowser: false,
    }).footer;
    expect(footer?.viewInBrowserUrl).toBeUndefined();
    expect(footer?.mailingAddress).toBe("1 Main St");
  });
});

describe("createFooterBlock defaults", () => {
  it("uses the English labels when none are given", () => {
    expect(createFooterBlock().metadata.displayName).toBe(
      DEFAULT_FOOTER_LABELS.displayName,
    );
  });
});
