/**
 * Pure text transforms behind the inline writing surface. Text blocks hold
 * markdown, so formatting is edited as markdown: these helpers take the
 * textarea value plus selection and return the next value and selection.
 */

export interface TextEdit {
  text: string;
  start: number;
  end: number;
}

/** Wraps the selection with `before`/`after`, or unwraps it if already wrapped. */
export function wrapSelection(
  text: string,
  start: number,
  end: number,
  before: string,
  after: string = before,
  placeholder = "text",
): TextEdit {
  const selected = text.slice(start, end);
  const wrapped =
    text.slice(start - before.length, start) === before &&
    text.slice(end, end + after.length) === after;
  if (wrapped) {
    return {
      text:
        text.slice(0, start - before.length) +
        selected +
        text.slice(end + after.length),
      start: start - before.length,
      end: end - before.length,
    };
  }
  const inner = selected || placeholder;
  return {
    text: text.slice(0, start) + before + inner + after + text.slice(end),
    start: start + before.length,
    end: start + before.length + inner.length,
  };
}

/** Turns the selection into a markdown link to `url`. */
export function linkSelection(
  text: string,
  start: number,
  end: number,
  url = "https://",
): TextEdit {
  const label = text.slice(start, end) || "link text";
  const link = `[${label}](${url})`;
  const urlStart = start + label.length + 3;
  return {
    text: text.slice(0, start) + link + text.slice(end),
    start: urlStart,
    end: urlStart + url.length,
  };
}

const LINE_PREFIX = /^(#{1,6} |[-*] |\d+\. |> )/;

export type LinePrefix = "# " | "## " | "- " | "1. " | "> ";

/** Switches the lines touching the selection to `prefix`, or back to plain
 * paragraphs when they all already have it. */
export function toggleLinePrefix(
  text: string,
  start: number,
  end: number,
  prefix: LinePrefix,
): TextEdit {
  const lineStart = text.lastIndexOf("\n", start - 1) + 1;
  const nextBreak = text.indexOf("\n", end);
  const lineEnd = nextBreak === -1 ? text.length : nextBreak;
  const lines = text.slice(lineStart, lineEnd).split("\n");
  const allHave = lines.every((line) => line.startsWith(prefix));
  const next = lines.map((line, index) => {
    const bare = line.replace(LINE_PREFIX, "");
    if (allHave) return bare;
    return prefix === "1. " ? `${index + 1}. ${bare}` : prefix + bare;
  });
  const replaced = next.join("\n");
  const delta = replaced.length - (lineEnd - lineStart);
  return {
    text: text.slice(0, lineStart) + replaced + text.slice(lineEnd),
    start: Math.max(lineStart, start + (lines.length === 1 ? delta : 0)),
    end: end + delta,
  };
}

/** What the first line of a block reads as, to style the editing surface. */
export function lineKind(
  line: string,
): "h1" | "h2" | "h3" | "list" | "quote" | "paragraph" {
  if (/^# /.test(line)) return "h1";
  if (/^## /.test(line)) return "h2";
  if (/^#{3,6} /.test(line)) return "h3";
  if (/^([-*] |\d+\. )/.test(line)) return "list";
  if (/^> /.test(line)) return "quote";
  return "paragraph";
}

/**
 * Enter inside a list continues it; Enter on an empty list item ends it.
 * Returns null when the browser's default newline is right.
 */
export function continueList(text: string, caret: number): TextEdit | null {
  const lineStart = text.lastIndexOf("\n", caret - 1) + 1;
  const lineEndIdx = text.indexOf("\n", caret);
  const lineEnd = lineEndIdx === -1 ? text.length : lineEndIdx;
  const line = text.slice(lineStart, lineEnd);
  const match = line.match(/^([-*] |(\d+)\. |> )/);
  if (!match || caret < lineStart + match[0].length) return null;

  const content = line.slice(match[0].length);
  if (content.trim() === "") {
    const at = lineStart;
    return { text: text.slice(0, at) + text.slice(lineEnd), start: at, end: at };
  }
  const marker = match[2] ? `${Number(match[2]) + 1}. ` : match[0];
  const insert = `\n${marker}`;
  const pos = caret + insert.length;
  return {
    text: text.slice(0, caret) + insert + text.slice(caret),
    start: pos,
    end: pos,
  };
}

/** `/query` typed alone on a line opens the block menu. */
export function slashQuery(text: string, caret: number): string | null {
  const lineStart = text.lastIndexOf("\n", caret - 1) + 1;
  const before = text.slice(lineStart, caret);
  const match = before.match(/^\/(\w*)$/);
  return match ? match[1] : null;
}

/** `{{` typed right before the caret opens the variable menu. */
export function variableTrigger(text: string, caret: number): boolean {
  return text.slice(caret - 2, caret) === "{{";
}

/** Inserts `{{ path }}` at the selection, replacing a just-typed `{{`. */
export function insertVariable(
  text: string,
  start: number,
  end: number,
  path: string,
): TextEdit {
  const from = text.slice(start - 2, start) === "{{" ? start - 2 : start;
  const token = `{{ ${path} }}`;
  const caret = from + token.length;
  return {
    text: text.slice(0, from) + token + text.slice(end),
    start: caret,
    end: caret,
  };
}

/** Words a reader would count: markdown syntax and merge tags are not words. */
export function countWords(markdown: string): number {
  return markdown
    .replace(/\{\{[\s\S]*?\}\}|\{%[\s\S]*?%\}/g, " x ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[*_`#>[\]()-]/g, " ")
    .split(/\s+/)
    .filter((word) => /[\p{L}\p{N}]/u.test(word)).length;
}
