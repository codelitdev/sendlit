import { describe, expect, it } from "bun:test";
import {
  continueList,
  countWords,
  insertVariable,
  linkSelection,
  slashQuery,
  toggleLinePrefix,
  variableTrigger,
  wrapSelection,
} from "./markdown-edit";

describe("wrapSelection", () => {
  it("wraps and unwraps the selection", () => {
    const wrapped = wrapSelection("hello world", 6, 11, "**");
    expect(wrapped.text).toBe("hello **world**");
    expect(wrapped.text.slice(wrapped.start, wrapped.end)).toBe("world");
    const back = wrapSelection(wrapped.text, wrapped.start, wrapped.end, "**");
    expect(back.text).toBe("hello world");
  });

  it("inserts a placeholder with nothing selected", () => {
    const edit = wrapSelection("", 0, 0, "*");
    expect(edit.text).toBe("*text*");
    expect(edit.text.slice(edit.start, edit.end)).toBe("text");
  });
});

describe("linkSelection", () => {
  it("selects the url so it can be typed over", () => {
    const edit = linkSelection("see docs", 4, 8);
    expect(edit.text).toBe("see [docs](https://)");
    expect(edit.text.slice(edit.start, edit.end)).toBe("https://");
  });
});

describe("toggleLinePrefix", () => {
  it("sets, switches and clears a prefix", () => {
    const heading = toggleLinePrefix("Title", 2, 2, "## ");
    expect(heading.text).toBe("## Title");
    expect(toggleLinePrefix(heading.text, 3, 3, "- ").text).toBe("- Title");
    expect(toggleLinePrefix(heading.text, 3, 3, "## ").text).toBe("Title");
  });

  it("numbers every selected line", () => {
    const edit = toggleLinePrefix("a\nb\nc", 0, 5, "1. ");
    expect(edit.text).toBe("1. a\n2. b\n3. c");
  });

  it("only touches the lines in the selection", () => {
    const edit = toggleLinePrefix("one\ntwo\nthree", 5, 5, "> ");
    expect(edit.text).toBe("one\n> two\nthree");
  });
});

describe("continueList", () => {
  it("continues bullets and numbers", () => {
    const bullet = continueList("- apples", 8);
    expect(bullet?.text).toBe("- apples\n- ");
    expect(bullet?.start).toBe(11);
    expect(continueList("1. one", 6)?.text).toBe("1. one\n2. ");
  });

  it("ends the list on an empty item", () => {
    expect(continueList("- apples\n- ", 11)?.text).toBe("- apples\n");
  });

  it("leaves ordinary lines alone", () => {
    expect(continueList("plain text", 10)).toBeNull();
  });
});

describe("menus", () => {
  it("detects a slash command only on its own line", () => {
    expect(slashQuery("/", 1)).toBe("");
    expect(slashQuery("intro\n/but", 10)).toBe("but");
    expect(slashQuery("a /b", 4)).toBeNull();
  });

  it("detects {{ and replaces it with the variable", () => {
    expect(variableTrigger("Hi {{", 5)).toBe(true);
    const edit = insertVariable("Hi {{", 5, 5, "subscriber.name");
    expect(edit.text).toBe("Hi {{ subscriber.name }}");
    expect(edit.start).toBe(edit.text.length);
  });
});

describe("countWords", () => {
  it("ignores markdown syntax and counts merge tags as words", () => {
    expect(countWords("# Hi {{ subscriber.name }}, read [the docs](https://x.y)")).toBe(
      5,
    );
  });
});
