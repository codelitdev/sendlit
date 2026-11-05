/** Inline pieces of an item, for showing it while not being edited. */
export type Segment =
  | { type: "text"; text: string }
  | { type: "bold"; text: string }
  | { type: "italic"; text: string }
  | { type: "link"; text: string; url: string }
  | { type: "tag"; path: string; fallback?: string };

const TOKEN =
  /(\*\*[^*]+\*\*|__[^_]+__|\*[^*\s][^*]*\*|_[^_\s][^_]*_|\[[^\]]+\]\([^)]+\)|\{\{-?\s*[\w.]+(?:\s*\|\s*default:\s*"[^"]*")?\s*-?\}\})/;

/** Where a piece sits in the markdown: `from` is the offset of its first
 * visible character, `end` the offset just after the whole piece. */
export type PlacedSegment = Segment & { from: number; end: number };

/** Splits inline markdown into bold, italic, link and merge-tag pieces. */
export function segments(text: string): Segment[] {
  return placedSegments(text).map(
    ({ from: _from, end: _end, ...segment }) => segment as Segment,
  );
}

/** `segments`, with where each piece sits in the markdown, so a click on the
 * formatted text can put the caret at the same place in the source. */
export function placedSegments(text: string): PlacedSegment[] {
  let offset = 0;
  return text
    .split(TOKEN)
    .filter(Boolean)
    .map((part): PlacedSegment => {
      const start = offset;
      offset += part.length;
      const segment = classify(part);
      const lead =
        segment.type === "bold"
          ? 2
          : segment.type === "italic" || segment.type === "link"
            ? 1
            : 0;
      return { ...segment, from: start + lead, end: offset };
    });
}

function classify(part: string): Segment {
  const tag = part.match(
    /^\{\{-?\s*([\w.]+)(?:\s*\|\s*default:\s*"([^"]*)")?\s*-?\}\}$/,
  );
  if (tag) return { type: "tag", path: tag[1], fallback: tag[2] };
  if (/^(\*\*|__).+(\*\*|__)$/.test(part)) {
    return { type: "bold", text: part.slice(2, -2) };
  }
  if (/^[*_].+[*_]$/.test(part) && part.length > 2) {
    return { type: "italic", text: part.slice(1, -1) };
  }
  const link = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
  if (link) return { type: "link", text: link[1], url: link[2] };
  return { type: "text", text: part };
}

/** Merge-tag paths that can come out blank for some contacts: a missing name,
 * no tags, or an event property the event didn't send. */
export function mayBeBlank(path: string): boolean {
  if (path === "subscriber.email") return false;
  return path.startsWith("subscriber.") || path.startsWith("event.");
}

/** Every `{{ path }}` in some text, and whether each use has a fallback. */
export function tagUses(text: string): { path: string; hasFallback: boolean }[] {
  return Array.from(
    text.matchAll(/\{\{-?\s*([\w.]+)(\s*\|\s*default:\s*"[^"]*")?\s*-?\}\}/g),
    (match) => ({ path: match[1], hasFallback: Boolean(match[2]) }),
  );
}

/** Gives every use of `path` the fallback `value` (or removes it when empty). */
export function setFallback(text: string, path: string, value: string): string {
  const escaped = path.replace(/\./g, "\\.");
  const pattern = new RegExp(
    `\\{\\{-?\\s*${escaped}(?:\\s*\\|\\s*default:\\s*"[^"]*")?\\s*-?\\}\\}`,
    "g",
  );
  const clean = value.replace(/"/g, "").trim();
  return text.replace(
    pattern,
    clean ? `{{ ${path} | default: "${clean}" }}` : `{{ ${path} }}`,
  );
}
