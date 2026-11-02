import { describe, expect, it } from "bun:test";
import { darkBlock } from "./palettes";

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
