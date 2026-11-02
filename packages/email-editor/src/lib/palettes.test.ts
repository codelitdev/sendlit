import { describe, expect, it } from "bun:test";
import { defaultEmail } from "./default-email";
import { darkBlock, PALETTES, paletteContent } from "./palettes";

const text = (settings: Record<string, unknown>) => ({
  id: "a",
  blockType: "text",
  settings,
});

describe("darkBlock", () => {
  it("lightens dark text and darkens light backgrounds", () => {
    const shown = darkBlock(
      text({ content: "Hi", foregroundColor: "#0f172a", backgroundColor: "#f8fafc" }),
    );
    expect(shown.settings.foregroundColor).toBe("#d5ddf0");
    expect(shown.settings.backgroundColor).toBe("#121f2b");
    expect(shown.settings.content).toBe("Hi");
  });

  it("keeps light text and mid-tone colours such as a button's", () => {
    const block = text({ foregroundColor: "#ffffff", backgroundColor: "#2563eb" });
    expect(darkBlock(block)).toBe(block);
  });

  it("leaves colours it can't read alone", () => {
    const block = text({ foregroundColor: "rebeccapurple" });
    expect(darkBlock(block)).toBe(block);
  });
});

describe("paletteContent", () => {
  const night = PALETTES.find((palette) => palette.name === "Night");
  if (!night) throw new Error("no Night palette");
  const email = {
    ...defaultEmail,
    style: {
      ...defaultEmail.style,
      colors: { ...defaultEmail.style.colors, foreground: "#0f172a" as const },
      structure: {
        ...defaultEmail.style.structure,
        page: { background: "#ffffff" as const, foreground: "#0f172a" as const },
      },
    },
    content: [
      {
        id: "h",
        blockType: "text",
        settings: { content: "# Hi", foregroundColor: "#0f172a" },
      },
      {
        id: "p",
        blockType: "text",
        settings: { content: "Body", foregroundColor: "#475569" },
      },
      {
        id: "b",
        blockType: "link",
        settings: {
          text: "Go",
          isButton: true,
          buttonColor: "#db2777",
          textColor: "#0284c7",
        },
      },
      { id: "s", blockType: "separator", settings: { color: "#dbe4ee" } },
    ],
  };

  it("keeps each block's tone in the new palette", () => {
    const [heading, body, button, divider] = paletteContent(email, night);
    expect(heading.settings.foregroundColor).toBe(night.text);
    // Muted body text stays between page and text, still readable.
    expect(body.settings.foregroundColor).not.toBe(night.text);
    expect(body.settings.foregroundColor).not.toBe("#475569");
    expect(button.settings.buttonColor).toBe(night.accent);
    expect(button.settings.textColor).toBeUndefined();
    expect(divider.settings.color).toBeUndefined();
    expect(heading.settings.content).toBe("# Hi");
  });
});
