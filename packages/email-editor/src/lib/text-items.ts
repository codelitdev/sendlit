import type { Email, EmailBlock } from "../types/email-editor";

/**
 * While writing, a text block is edited as one item per paragraph, heading,
 * list item or quote, so Enter, Backspace and the arrow keys behave like a
 * document. Storage keeps the original shape: one `text` block holding
 * markdown. Items carry an editor-only `group` (the block they came from) and
 * neighbouring items of a group are joined back into one block when the email
 * is handed to the host.
 */

export type ItemKind = "p" | "h1" | "h2" | "h3" | "li" | "ol" | "quote";

export interface ParsedItem {
  kind: ItemKind;
  /** The markdown marker, e.g. `## `, `- `, `3. `, `> `. Empty for paragraphs. */
  prefix: string;
  /** The text a writer edits, without the marker. */
  body: string;
}

const MARKER = /^(#{1,6} |[-*+] |\d+[.)] |> ?)/;

export function parseItem(unit: string): ParsedItem {
  const match = unit.match(MARKER);
  if (!match) return { kind: "p", prefix: "", body: unit };
  const marker = match[1];
  const rest = unit.slice(marker.length);
  if (marker.startsWith("#")) {
    const level = marker.trim().length;
    const kind = level === 1 ? "h1" : level === 2 ? "h2" : "h3";
    return { kind, prefix: marker, body: rest };
  }
  if (marker.startsWith(">")) {
    const body = unit
      .split("\n")
      .map((line) => line.replace(/^> ?/, ""))
      .join("\n");
    return { kind: "quote", prefix: "> ", body };
  }
  const indent = " ".repeat(marker.length);
  const [first, ...more] = rest.split("\n");
  const body = [
    first,
    ...more.map((line) => (line.startsWith(indent) ? line.slice(indent.length) : line)),
  ].join("\n");
  return { kind: /^\d/.test(marker) ? "ol" : "li", prefix: marker, body };
}

/** The stored markdown of one item. */
export function itemMarkdown(prefix: string, body: string): string {
  if (prefix.startsWith(">")) {
    return body
      .split("\n")
      .map((line) => (line ? `> ${line}` : ">"))
      .join("\n");
  }
  if (prefix.startsWith("#")) return prefix + body.replace(/\n+/g, " ");
  if (!prefix) return body;
  const indent = " ".repeat(prefix.length);
  const [first, ...more] = body.split("\n");
  return [prefix + first, ...more.map((line) => indent + line)].join("\n");
}

const HEADING = /^#{1,6} /;
const LIST = /^ {0,3}([-*+] |\d+[.)] )/;
const QUOTE = /^ {0,3}>/;

/** Splits a text block's markdown into items. Code blocks stay whole, since
 * splitting them on blank lines would change what they mean. */
export function splitMarkdown(markdown: string): string[] {
  const source = markdown.replace(/\r/g, "");
  if (source.includes("```")) return source.trim() ? [source] : [];

  const units: string[] = [];
  for (const chunk of source.split(/\n[ \t]*\n/)) {
    let current: { kind: "p" | "list" | "quote"; text: string } | null = null;
    const flush = () => {
      if (current?.text.trim()) units.push(current.text);
      current = null;
    };
    for (const line of chunk.split("\n")) {
      if (HEADING.test(line)) {
        flush();
        units.push(line);
      } else if (LIST.test(line)) {
        flush();
        current = { kind: "list", text: line.replace(/^ {1,3}/, "") };
      } else if (QUOTE.test(line)) {
        if (current?.kind === "quote") current.text += `\n${line.trimStart()}`;
        else {
          flush();
          current = { kind: "quote", text: line.trimStart() };
        }
      } else if (current?.kind === "list" && /^\s+\S/.test(line)) {
        current.text += `\n${line}`;
      } else if (current?.kind === "p") {
        current.text += `\n${line}`;
      } else {
        flush();
        current = { kind: "p", text: line };
      }
    }
    flush();
  }
  return units;
}

function listType(kind: ItemKind) {
  return kind === "li" || kind === "ol" ? kind : null;
}

/** Joins items back into one block's markdown. Items of the same list sit on
 * consecutive lines; everything else is a separate paragraph. */
export function joinItems(units: string[]): string {
  let out = "";
  let previous: ItemKind | null = null;
  for (const unit of units) {
    const kind = parseItem(unit).kind;
    if (out) {
      const sameList = listType(kind) !== null && listType(kind) === previous;
      out += sameList ? "\n" : "\n\n";
    }
    out += unit;
    previous = listType(kind);
  }
  return out;
}

function isEmptyItem(unit: string) {
  return parseItem(unit).body.trim() === "";
}

type IdFactory = () => string;

/** Turns every text block into items. Other blocks pass through. */
export function explodeTextBlocks(content: EmailBlock[], id: IdFactory): EmailBlock[] {
  return content.flatMap((block) => {
    if (block.blockType !== "text") return [{ ...block, id: block.id ?? id() }];
    const group = id();
    const { content: markdown = "", ...settings } = block.settings ?? {};
    const units = splitMarkdown(String(markdown));
    return (units.length ? units : [""]).map((unit) => ({
      id: id(),
      blockType: "text",
      group,
      settings: { ...settings, content: unit },
    }));
  });
}

/** A run of neighbouring items from one block, or a single other block. */
export interface Row {
  /** The id of the first item, which stands for the whole run. */
  id: string;
  start: number;
  end: number;
  block: EmailBlock;
}

/** Groups the editor's flat list back into blocks. Empty items are dropped and
 * a block left with no text disappears, so a stray empty line never sends. */
export function toRows(content: EmailBlock[], { keepEmpty = false } = {}): Row[] {
  const rows: Row[] = [];
  for (let index = 0; index < content.length; ) {
    const block = content[index];
    if (block.blockType !== "text" || !block.group) {
      rows.push({ id: block.id!, start: index, end: index + 1, block });
      index++;
      continue;
    }
    let end = index + 1;
    while (
      end < content.length &&
      content[end].blockType === "text" &&
      content[end].group === block.group
    ) {
      end++;
    }
    const units = content
      .slice(index, end)
      .map((item) => String(item.settings?.content ?? ""))
      .filter((unit) => keepEmpty || !isEmptyItem(unit));
    if (units.length || keepEmpty) {
      rows.push({
        id: block.id!,
        start: index,
        end,
        block: {
          id: block.id,
          blockType: "text",
          settings: { ...block.settings, content: joinItems(units) },
        },
      });
    }
    index = end;
  }
  return rows;
}

/** The email as the host stores it: text items joined, editor fields removed. */
export function mergeTextItems(email: Email): Email {
  return {
    ...email,
    content: toRows(email.content).map(({ block }) => {
      const { id: _id, group: _group, ...rest } = block;
      return rest;
    }),
  };
}

/** A markdown shortcut typed at the start of a paragraph. */
export const SHORTCUTS: [string, string][] = [
  ["## ", "## "],
  ["# ", "# "],
  ["- ", "- "],
  ["* ", "- "],
  ["1. ", "1. "],
  ["> ", "> "],
];
