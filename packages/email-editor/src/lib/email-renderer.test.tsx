import { describe, expect, it } from "bun:test";
import { defaultEmail } from "./default-email";
import { renderEmailToHtml } from "./email-renderer";

describe("renderEmailToHtml", () => {
  it("renders preview text and the default block content", async () => {
    const html = await renderEmailToHtml({
      email: {
        ...defaultEmail,
        meta: { previewText: "Inbox preview" },
      },
    });

    expect(html).toContain("Inbox preview");
    expect(html).toContain("Your Company Name");
    expect(html).toContain("Visit Our Website");
  });

  it("adds UTM parameters without mutating the editor document", async () => {
    const email = structuredClone(defaultEmail);
    const link = email.content.find((block) => block.blockType === "link")!;
    link.settings.url = "https://example.com/offer?existing=1";

    const html = await renderEmailToHtml({
      email,
      utmParams: {
        source: "newsletter",
        medium: "email",
        campaign: "launch",
      },
    });

    expect(html).toContain("existing=1");
    expect(html).toContain("utm_source=newsletter");
    expect(html).toContain("utm_medium=email");
    expect(html).toContain("utm_campaign=launch");
    expect(link.settings.url).toBe("https://example.com/offer?existing=1");
  });

  it("preserves invalid link values rather than failing the whole render", async () => {
    const email = structuredClone(defaultEmail);
    const link = email.content.find((block) => block.blockType === "link")!;
    link.settings.url = "not a valid URL";

    const html = await renderEmailToHtml({
      email,
      utmParams: { source: "s", medium: "m", campaign: "c" },
    });

    expect(html).toContain("not a valid URL");
    expect(html).not.toContain("utm_source");
  });

  it("renders an explicit placeholder for unknown block types", async () => {
    const html = await renderEmailToHtml({
      email: {
        ...defaultEmail,
        content: [{ blockType: "future-block", settings: {} } as any],
      },
    });

    expect(html).toContain("Unknown block type:");
    expect(html).toContain("future-block");
  });

  it("passes render context to custom blocks without persisting it", async () => {
    const contextBlock = {
      metadata: {
        name: "context",
        displayName: "Context",
        description: "Context block",
        icon: () => null,
        docs: { settings: {} },
      },
      settings: () => null,
      block: ({ renderContext }: { renderContext?: { value: string } }) => (
        <div>{renderContext?.value}</div>
      ),
    };
    const email = {
      ...defaultEmail,
      content: [{ blockType: "context", settings: {} }],
    };

    const html = await renderEmailToHtml({
      email,
      blocks: [contextBlock],
      renderContext: { value: "render-only-value" },
    });

    expect(html).toContain("render-only-value");
    expect(JSON.stringify(email)).not.toContain("render-only-value");
  });

  it("returns safe error markup when a custom block throws", async () => {
    const brokenBlock = {
      metadata: {
        name: "broken",
        displayName: "Broken",
        description: "Broken block",
        icon: () => null,
        docs: { settings: {} },
      },
      settings: () => null,
      block: () => {
        throw new Error("render exploded");
      },
    };
    const html = await renderEmailToHtml({
      email: {
        ...defaultEmail,
        content: [{ blockType: "broken", settings: {} } as any],
      },
      blocks: [brokenBlock],
    });

    expect(html).toContain("Error: render exploded");
  });
});

describe("new blocks", () => {
  const withBlock = (blockType: string, settings: Record<string, unknown>) => ({
    ...defaultEmail,
    content: [{ blockType, settings }],
  });

  it("renders a spacer of the requested height", async () => {
    const html = await renderEmailToHtml({
      email: withBlock("spacer", { height: "40px" }),
    });
    expect(html).toContain("height:40px");
  });

  it("renders both columns with their markdown", async () => {
    const html = await renderEmailToHtml({
      email: withBlock("columns", {
        left: "**Left**",
        right: "Right *text*",
        ratio: "12",
        stack: true,
      }),
    });
    expect(html).toContain("<strong");
    expect(html).toContain("Left");
    expect(html).toContain("Right");
    expect(html).toContain("width:33%");
    expect(html).toContain("width:67%");
    expect(html).toContain("max-width:480px");
  });

  it("renders only social links with a web url", async () => {
    const html = await renderEmailToHtml({
      email: withBlock("social", {
        links: [
          { network: "instagram", url: "https://instagram.com/sendlit" },
          { network: "x", url: "javascript:alert(1)" },
          { network: "youtube", url: "" },
        ],
      }),
    });
    expect(html).toContain("https://instagram.com/sendlit");
    expect(html).toContain("Instagram");
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("YouTube");
  });

  it("sends the code of an html block as-is", async () => {
    const html = await renderEmailToHtml({
      email: withBlock("html", { code: '<p class="x">Hello <b>there</b></p>' }),
    });
    expect(html).toContain('<p class="x">Hello <b>there</b></p>');
  });

  it("wraps a conditional section in Liquid when sending", async () => {
    const html = await renderEmailToHtml({
      email: withBlock("conditional", {
        tag: "customer",
        has: true,
        content: "Members only",
      }),
    });
    expect(html).toContain("{% if subscriber.tags contains");
    expect(html).toContain("customer");
    expect(html).toContain("Members only");
    expect(html).toContain("{% endif %}");
  });

  it("uses unless for contacts without the tag", async () => {
    const html = await renderEmailToHtml({
      email: withBlock("conditional", { tag: "customer", has: false, content: "Hi" }),
    });
    expect(html).toContain("{% unless subscriber.tags contains");
    expect(html).toContain("{% endunless %}");
  });

  it("drops a conditional section whose tag could break the Liquid expression", async () => {
    const html = await renderEmailToHtml({
      email: withBlock("conditional", {
        tag: 'x" %}{% endif %}secret{% if "y',
        content: "Secret offer",
      }),
    });
    expect(html).not.toContain("Secret offer");
    expect(html).not.toContain("{% if");
  });

  it("shows conditional sections to everyone in previews", async () => {
    const html = await renderEmailToHtml({
      email: withBlock("conditional", { tag: "customer", content: "Members only" }),
      showConditionals: true,
    });
    expect(html).toContain("Members only");
    expect(html).not.toContain("{% if");
  });
});

describe("fonts", () => {
  it("uses the email's fonts and ignores a font saved on a block", async () => {
    const html = await renderEmailToHtml({
      email: {
        ...defaultEmail,
        style: {
          ...defaultEmail.style,
          typography: {
            ...defaultEmail.style.typography,
            text: {
              ...defaultEmail.style.typography.text,
              fontFamily: "Georgia, serif",
            },
            link: {
              ...defaultEmail.style.typography.link,
              fontFamily: "Verdana, sans-serif",
            },
          },
        },
        content: [
          { blockType: "text", settings: { content: "Hello", fontFamily: "Courier" } },
          {
            blockType: "link",
            settings: { text: "Go", url: "https://example.com", fontFamily: "Courier" },
          },
        ],
      },
    });
    expect(html).toContain("Georgia, serif");
    expect(html).toContain("Verdana, sans-serif");
    expect(html).not.toContain("Courier");
  });
});
