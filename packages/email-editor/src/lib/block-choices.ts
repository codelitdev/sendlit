import {
  Heading1,
  Heading2,
  List,
  ListOrdered,
  MousePointerClick,
  Pilcrow,
  TextQuote,
} from "lucide-react";
import type { BlockChoice } from "../types/editor-ui";
import type { BlockRegistry } from "../types/block-registry";
import { getInsertableBlocks } from "./block-policy";

const TEXT_CHOICES: BlockChoice[] = [
  {
    id: "text",
    name: "Text",
    description: "Just start writing",
    keywords: "paragraph",
    icon: Pilcrow,
    text: "",
  },
  {
    id: "title",
    name: "Title",
    description: "A big heading",
    keywords: "heading 1 h1",
    icon: Heading1,
    text: "# ",
  },
  {
    id: "heading",
    name: "Heading",
    description: "A section heading",
    keywords: "heading 2 h2 subheading",
    icon: Heading2,
    text: "## ",
  },
  {
    id: "bullets",
    name: "Bullets",
    description: "A bulleted list",
    keywords: "list bulleted unordered",
    icon: List,
    text: "- ",
  },
  {
    id: "numbers",
    name: "Numbers",
    description: "A numbered list",
    keywords: "list numbered ordered",
    icon: ListOrdered,
    text: "1. ",
  },
  {
    id: "quote",
    name: "Quote",
    description: "Set a quote apart",
    keywords: "blockquote",
    icon: TextQuote,
    text: "> ",
  },
];

const BUTTON_CHOICE: BlockChoice = {
  id: "button",
  name: "Button",
  description: "A link people can tap",
  keywords: "cta link call to action",
  icon: MousePointerClick,
  blockType: "link",
  settings: {
    text: "Click here",
    url: "https://",
    isButton: true,
    alignment: "left",
  },
};

const BLOCK_KEYWORDS: Record<string, string> = {
  image: "photo picture",
  separator: "line hr divider",
  columns: "two side",
  social: "links profiles",
  html: "code custom",
  conditional: "tag section segment if",
  spacer: "space gap",
  link: "url",
};

/** What the insert menu offers, in the order a writer reaches for them. */
export function getBlockChoices(registry: BlockRegistry): BlockChoice[] {
  const order = [
    "image",
    "separator",
    "spacer",
    "columns",
    "social",
    "conditional",
    "html",
  ];
  const rest = getInsertableBlocks(registry).filter(
    (block) => block.metadata.name !== "text" && block.metadata.name !== "link",
  );
  rest.sort((a, b) => {
    const ia = order.indexOf(a.metadata.name);
    const ib = order.indexOf(b.metadata.name);
    return (ia === -1 ? order.length : ia) - (ib === -1 ? order.length : ib);
  });
  const objects: BlockChoice[] = rest.map((block) => ({
    id: block.metadata.name,
    name: block.metadata.name === "separator" ? "Divider" : block.metadata.displayName,
    description: block.metadata.description,
    keywords: BLOCK_KEYWORDS[block.metadata.name] ?? "",
    icon: block.metadata.icon,
    blockType: block.metadata.name,
  }));
  const hasLink = Boolean(registry.link);
  return [
    ...(registry.text ? TEXT_CHOICES : []),
    ...(hasLink ? [BUTTON_CHOICE] : []),
    ...objects,
  ];
}

export function filterChoices(choices: BlockChoice[], query: string): BlockChoice[] {
  const q = query.trim().toLowerCase();
  if (!q) return choices;
  return choices.filter((choice) =>
    `${choice.name} ${choice.keywords}`.toLowerCase().includes(q),
  );
}
