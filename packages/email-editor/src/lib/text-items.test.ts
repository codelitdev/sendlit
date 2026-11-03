import { describe, expect, it } from "bun:test";
import { defaultEmail } from "./default-email";
import {
  explodeTextBlocks,
  itemMarkdown,
  joinItems,
  mergeTextItems,
  parseItem,
  splitMarkdown,
  toRows,
} from "./text-items";

let next = 0;
const id = () => `id${next++}`;

describe("parseItem and itemMarkdown", () => {
  it("round-trips every kind", () => {
    for (const unit of [
      "Plain paragraph\nwith a soft break",
      "# Title",
      "## Heading",
      "### Small heading",
      "- Bullet\n  continued",
      "3. Third",
      "> Quoted\n> twice",
    ]) {
      const { prefix, body } = parseItem(unit);
      expect(itemMarkdown(prefix, body)).toBe(unit);
    }
  });

  it("reads kinds and bodies", () => {
    expect(parseItem("## Hi")).toEqual({ kind: "h2", prefix: "## ", body: "Hi" });
    expect(parseItem("12. Twelve").kind).toBe("ol");
    expect(parseItem("> a\n> b")).toEqual({
      kind: "quote",
      prefix: "> ",
      body: "a\nb",
    });
  });
});

describe("splitMarkdown and joinItems", () => {
  it("splits headings, paragraphs, list items and quotes", () => {
    const md =
      "# Title\nIntro line\n\nPara one\nsame para\n\n- a\n- b\n\n1. x\n2. y\n\n> q";
    expect(splitMarkdown(md)).toEqual([
      "# Title",
      "Intro line",
      "Para one\nsame para",
      "- a",
      "- b",
      "1. x",
      "2. y",
      "> q",
    ]);
  });

  it("keeps list items of one list on consecutive lines when joining", () => {
    expect(joinItems(["## H", "- a", "- b", "Para", "1. x", "2. y"])).toBe(
      "## H\n\n- a\n- b\n\nPara\n\n1. x\n2. y",
    );
  });

  it("joins what it split for ordinary markdown", () => {
    const md = "# Your Company Name\n\nThis is some paragraph text.\n\n- one\n- two";
    expect(joinItems(splitMarkdown(md))).toBe(md);
  });

  it("leaves code blocks whole", () => {
    const md = "```\nline\n\nline\n```";
    expect(splitMarkdown(md)).toEqual([md]);
  });
});

describe("explodeTextBlocks and mergeTextItems", () => {
  const email = {
    ...defaultEmail,
    content: [
      {
        blockType: "text",
        settings: { content: "# Hi\n\nPara\n\n- a\n- b", alignment: "center" },
      },
      { blockType: "custom-widget", settings: { anything: 1 } },
      { blockType: "text", settings: { content: "Second block" } },
    ],
  };

  it("gives each paragraph its own item, grouped by block", () => {
    const items = explodeTextBlocks(email.content, id);
    expect(items.map((item) => item.settings.content)).toEqual([
      "# Hi",
      "Para",
      "- a",
      "- b",
      undefined,
      "Second block",
    ]);
    expect(new Set(items.slice(0, 4).map((item) => item.group)).size).toBe(1);
    expect(items[0].group).not.toBe(items[5].group);
    expect(items[1].settings.alignment).toBe("center");
    expect(items[4]).toMatchObject({
      blockType: "custom-widget",
      settings: { anything: 1 },
    });
  });

  it("merges back to the stored shape, without editor fields", () => {
    const merged = mergeTextItems({
      ...email,
      content: explodeTextBlocks(email.content, id),
    });
    expect(merged.content).toEqual([
      {
        blockType: "text",
        settings: { content: "# Hi\n\nPara\n\n- a\n- b", alignment: "center" },
      },
      { blockType: "custom-widget", settings: { anything: 1 } },
      { blockType: "text", settings: { content: "Second block" } },
    ]);
  });

  it("drops empty items and blocks left with no text", () => {
    const items = explodeTextBlocks(
      [{ blockType: "text", settings: { content: "Keep" } }],
      id,
    );
    items.push({ ...items[0], id: id(), settings: { content: "" } });
    items.push({
      id: id(),
      blockType: "text",
      group: "lonely",
      settings: { content: "- " },
    });
    expect(mergeTextItems({ ...defaultEmail, content: items }).content).toEqual([
      { blockType: "text", settings: { content: "Keep" } },
    ]);
  });

  it("splits a block in two when something lands between its items", () => {
    const items = explodeTextBlocks(
      [{ blockType: "text", settings: { content: "One\n\nTwo" } }],
      id,
    );
    items.splice(1, 0, { id: id(), blockType: "separator", settings: {} });
    const rows = toRows(items);
    expect(
      rows.map((row) => row.block.settings.content ?? row.block.blockType),
    ).toEqual(["One", "separator", "Two"]);
  });
});
