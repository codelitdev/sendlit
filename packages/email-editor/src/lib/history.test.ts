import { describe, expect, it } from "bun:test";
import { History } from "./history";

describe("History", () => {
  it("undoes and redoes", () => {
    const history = new History<string>();
    history.record("a");
    history.record("b");
    expect(history.undo("c")).toBe("b");
    expect(history.undo("b")).toBe("a");
    expect(history.undo("a")).toBeUndefined();
    expect(history.redo("a")).toBe("b");
    expect(history.canRedo).toBe(true);
  });

  it("coalesces quick edits that share a key", () => {
    const history = new History<string>();
    history.record("a", "block-1", 0);
    history.record("ab", "block-1", 100);
    history.record("abc", "block-1", 200);
    expect(history.undo("abcd")).toBe("a");
    expect(history.canUndo).toBe(false);
  });

  it("starts a new step after a pause or another key", () => {
    const history = new History<string>();
    history.record("a", "x", 0);
    history.record("b", "x", 5000);
    history.record("c", "y", 5100);
    expect(history.undo("d")).toBe("c");
    expect(history.undo("c")).toBe("b");
    expect(history.undo("b")).toBe("a");
  });

  it("drops redo history on a new edit", () => {
    const history = new History<string>();
    history.record("a");
    history.undo("b");
    history.record("a");
    expect(history.canRedo).toBe(false);
  });
});
