import type { Email, EmailBlock } from "../types/email-editor";
import { mayBeBlank, tagUses } from "./inline-markdown";

export interface ChecklistItem {
  id: string;
  level: "must" | "should";
  title: string;
  detail: string;
  /** Where to jump to fix it. */
  target: { type: "subject" | "preview" } | { type: "block"; blockId: string };
  /** The fix button's label. */
  fixLabel: string;
  /** Set for a merge tag without a fallback: the checklist offers to add one. */
  fallback?: { path: string };
}

const NETWORK_NAMES: Record<string, string> = {
  website: "Website",
  instagram: "Instagram",
  linkedin: "LinkedIn",
  youtube: "YouTube",
  x: "X",
  facebook: "Facebook",
  tiktok: "TikTok",
};

/** A link someone can follow: a web address, an email address, or a merge tag. */
export function isUsableUrl(url: unknown): boolean {
  return (
    typeof url === "string" &&
    /^(https?:\/\/[^\s]+\.[^\s]+|mailto:\S+|\{\{.+\}\})$/.test(url.trim())
  );
}

/** The text of a block that a contact reads, where merge tags can appear. */
function readableText(block: EmailBlock): string[] {
  const s = block.settings ?? {};
  return [s.content, s.left, s.right, s.text].filter(
    (value): value is string => typeof value === "string",
  );
}

function label(block: EmailBlock) {
  return block.blockType === "link" && block.settings?.isButton ? "Button" : "Link";
}

/** Things worth fixing before sending. "must" would break or embarrass the
 * email; "should" is deliverability and polish. Pure, so it can run on every edit. */
export function computeChecklist({
  email,
  subject,
  canWrite = true,
}: {
  email: Email;
  /** Omit when the host doesn't edit a subject in the editor. */
  subject?: string;
  /** Whether the editor has a text block to write in. */
  canWrite?: boolean;
}): ChecklistItem[] {
  const items: ChecklistItem[] = [];
  const subjectTarget = { type: "subject" } as const;

  if (subject !== undefined) {
    const trimmed = subject.trim();
    if (trimmed === "") {
      items.push({
        id: "subject-missing",
        level: "must",
        title: "Add a subject line",
        detail: "It's the first thing people see in their inbox.",
        target: subjectTarget,
        fixLabel: "Add",
      });
    } else {
      if (trimmed.length > 60) {
        items.push({
          id: "subject-long",
          level: "should",
          title: "Subject may be cut off",
          detail: `${trimmed.length} characters. Phones show about the first 40.`,
          target: subjectTarget,
          fixLabel: "Shorten",
        });
      }
      const letters = trimmed.replace(/[^A-Za-z]/g, "");
      if (letters.length >= 6 && letters === letters.toUpperCase()) {
        items.push({
          id: "subject-shouting",
          level: "should",
          title: "Avoid an all-caps subject",
          detail: "Shouting subjects are a common spam signal.",
          target: subjectTarget,
          fixLabel: "Edit",
        });
      }
      if (/!{2,}/.test(trimmed)) {
        items.push({
          id: "subject-exclaim",
          level: "should",
          title: "Use at most one exclamation mark",
          detail: "Repeated exclamation marks look like spam.",
          target: subjectTarget,
          fixLabel: "Edit",
        });
      }
    }
  }

  const firstWords = email.content
    .filter((block) => block.blockType === "text")
    .map((block) =>
      String(block.settings?.content ?? "")
        // An inbox shows what a contact gets: the fallback, or the field's name.
        .replace(
          /\{\{-?\s*([\w.]+)(?:\s*\|\s*default:\s*"([^"]*)")?\s*-?\}\}/g,
          (_tag, path: string, fallback?: string) =>
            fallback ?? `{${path.split(".").pop()}}`,
        )
        .replace(/[#>*_[\]()-]/g, ""),
    )
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  const preview = email.meta?.previewText?.trim() ?? "";
  if (preview === "") {
    items.push({
      id: "preview-missing",
      level: "should",
      title: "Add preview text",
      detail: firstWords
        ? `Without it, inboxes show the start of the email: “${firstWords.slice(0, 48)}…”`
        : "Without it, inboxes show the start of the email instead.",
      target: { type: "preview" },
      fixLabel: "Add",
    });
  } else if (preview.length > 110) {
    items.push({
      id: "preview-long",
      level: "should",
      title: "Shorten the preview text",
      detail: "Inboxes show about 40 to 110 characters.",
      target: { type: "preview" },
      fixLabel: "Shorten",
    });
  }

  const fallbackTargets = new Map<string, string>();
  for (const block of email.content) {
    if (!block.id) continue;
    const target = { type: "block", blockId: block.id } as const;
    const settings = block.settings ?? {};

    if (block.blockType === "link" && !isUsableUrl(settings.url)) {
      items.push({
        id: `url-${block.id}`,
        level: "must",
        title: `${label(block)} “${settings.text || label(block)}” has no link`,
        detail: "Clicking it would go nowhere.",
        target,
        fixLabel: "Add link",
      });
    }
    if (block.blockType === "image") {
      if (!settings.src) {
        items.push({
          id: `image-${block.id}`,
          level: "must",
          title: "An image block is empty",
          detail: "Choose an image or remove the block.",
          target,
          fixLabel: "Show",
        });
      } else if (!settings.alt?.trim() || settings.alt === "Image") {
        items.push({
          id: `alt-${block.id}`,
          level: "should",
          title: "Image has no alt text",
          detail: "Shown when images are blocked, and read by screen readers.",
          target,
          fixLabel: "Add",
        });
      }
    }
    if (block.blockType === "social") {
      const links: { network: string; url?: string }[] = settings.links ?? [];
      for (const link of links) {
        if (!/^https?:\/\/\S+\.\S+/.test(link.url?.trim() ?? "")) {
          const name = NETWORK_NAMES[link.network] ?? link.network;
          items.push({
            id: `social-${block.id}-${link.network}`,
            level: "must",
            title: `${name} link is missing`,
            detail: `The ${name} button in your social links has no address.`,
            target,
            fixLabel: "Add",
          });
        }
      }
      if (links.length === 0) {
        items.push({
          id: `social-${block.id}`,
          level: "should",
          title: "Add your social links",
          detail: "The social block has no links yet, so it won't appear in the email.",
          target,
          fixLabel: "Add",
        });
      }
    }
    if (block.blockType === "conditional" && !settings.tag) {
      items.push({
        id: `tag-${block.id}`,
        level: "must",
        title: "Pick a tag for the section",
        detail: "A section without a tag is left out of the email.",
        target,
        fixLabel: "Show",
      });
    }
    for (const text of readableText(block)) {
      for (const use of tagUses(text)) {
        if (
          !use.hasFallback &&
          mayBeBlank(use.path) &&
          !fallbackTargets.has(use.path)
        ) {
          fallbackTargets.set(use.path, block.id);
        }
      }
    }
  }

  for (const [path, blockId] of fallbackTargets) {
    items.push({
      id: `fallback-${path}`,
      level: "should",
      title: `“${path.split(".").pop()}” has no fallback`,
      detail: "Subscribers without one would see a blank, like “Hi ,”.",
      target: { type: "block", blockId },
      fixLabel: "Show",
      fallback: { path },
    });
  }

  const hasWords = email.content.some(
    (block) =>
      (block.blockType === "text" && String(block.settings?.content ?? "").trim()) ||
      block.blockType === "columns" ||
      block.blockType === "html",
  );
  if (canWrite && !hasWords) {
    items.push({
      id: "empty",
      level: "must",
      title: "Write something",
      detail: "The email has no text yet.",
      target: subjectTarget,
      fixLabel: "Write",
    });
  }

  return items.sort((a, b) => (a.level === b.level ? 0 : a.level === "must" ? -1 : 1));
}

/** The checklist button's words. */
export function checklistLabel(items: ChecklistItem[]): string {
  const must = items.filter((item) => item.level === "must").length;
  if (items.length === 0) return "Ready to send";
  return must ? `${must} to fix` : `${items.length} to check`;
}
