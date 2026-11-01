"use client";

import { ChevronRight, Copy, PenLine, SlidersHorizontal, Trash2 } from "lucide-react";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { TextBlock as StandardTextRenderer } from "../blocks/text/block";
import { getBlockChoices } from "../lib/block-choices";
import {
  canDeleteBlock,
  canDuplicateBlock,
  canInsertAfter,
  canMoveBlock,
  getBlockCapabilities,
  getDefaultBlockSettings,
  reorderBlocks,
  resolveInsertionIndex,
} from "../lib/block-policy";
import { type ChecklistItem, checklistLabel, computeChecklist } from "../lib/checklist";
import { defaultEmail } from "../lib/default-email";
import { History } from "../lib/history";
import { setFallback } from "../lib/inline-markdown";
import { countWords } from "../lib/markdown-edit";
import { type MenuPlacement, placeMenu } from "../lib/menu-placement";
import { normalizeEmail } from "../lib/normalize-email";
import { darkStyle } from "../lib/palettes";
import {
  explodeTextBlocks,
  itemMarkdown,
  mergeTextItems,
  parseItem,
  type Row,
  splitMarkdown,
  toRows,
} from "../lib/text-items";
import type { BlockRegistry } from "../types/block-registry";
import type { Email, EmailBlock, EmailStyle } from "../types/email-editor";
import type { BlockChoice, EditorTheme, EditorVariable } from "../types/editor-ui";
import { BlockMenu } from "./block-menu";
import { BlockRow, ItemRow, type RowEvents } from "./block-row";
import { Checklist } from "./checklist";
import { ControlsBar } from "./controls-bar";
import { DocHeader, InboxRow } from "./doc-header";
import { Inspector } from "./inspector";
import { TextItem } from "./text-item";
import "../index.css";
import "../editor.css";

function generateId() {
  return Math.random().toString(36).slice(2, 11);
}

function deepMerge(target: any, source: any) {
  const output = { ...target };
  if (isObject(target) && isObject(source)) {
    for (const key of Object.keys(source)) {
      if (isObject(source[key]) && key in target) {
        output[key] = deepMerge(target[key], source[key]);
      } else {
        output[key] = source[key];
      }
    }
  }
  return output;
}

function isObject(item: any) {
  return item && typeof item === "object" && !Array.isArray(item);
}

/** Paragraph-by-paragraph writing applies to SendLit's own text block, whose
 * content is markdown. A host that leaves it out, or registers its own block
 * under the `text` name, gets ordinary blocks it selects and edits in Style. */
export function usesTextItems(blockRegistry: BlockRegistry): boolean {
  return blockRegistry.text?.block === StandardTextRenderer;
}

const TAG = /\{\{\s*([\w.]+)(?:\s*\|\s*default:\s*"([^"]*)")?\s*\}\}/g;

/** Replaces merge tags with their sample values, for the "Sample data" preview. */
function withSamples(block: EmailBlock, samples: Map<string, string>): EmailBlock {
  const fill = (text: string) =>
    text.replace(TAG, (whole, path: string) => samples.get(path) ?? whole);
  const settings = { ...block.settings };
  for (const key of ["content", "left", "right", "text"]) {
    if (typeof settings[key] === "string") settings[key] = fill(settings[key]);
  }
  return { ...block, settings };
}

function blockWords(block: EmailBlock) {
  const s = block.settings ?? {};
  return [s.content, s.left, s.right].reduce<number>(
    (sum, text) => sum + (typeof text === "string" ? countWords(text) : 0),
    0,
  );
}

const MOBILE_WIDTH = 375;

/** How a block is named in messages such as "Button deleted". */
function labelOf(block: EmailBlock, blockRegistry: BlockRegistry) {
  if (block.blockType === "text" && block.group) return "Text";
  if (block.blockType === "link" && block.settings?.isButton) return "Button";
  return blockRegistry[block.blockType]?.metadata.displayName ?? "Block";
}

const isItem = (block: EmailBlock | undefined): boolean =>
  block?.blockType === "text" && Boolean(block.group);

interface EmailEditorProps {
  initialEmail?: Email;
  onChange?: (email: Email) => void;
  blockRegistry: BlockRegistry;
  renderContext?: unknown;
  /** The subject line. Omit when the host edits it elsewhere. */
  subject?: string;
  onSubjectChange?: (subject: string) => void;
  /** Merge tags offered while writing and in the Tags tab. */
  variables?: EditorVariable[];
  /** Shown as the sender in inbox previews. */
  senderName?: string;
  theme?: EditorTheme;
  defaultMode?: "write" | "style";
}

export function EmailEditor({
  initialEmail,
  onChange,
  blockRegistry,
  renderContext,
  subject,
  onSubjectChange,
  variables = [],
  senderName = "Your sender name",
  theme = "sendlit",
  defaultMode = "write",
}: EmailEditorProps) {
  const itemsOn = usesTextItems(blockRegistry);
  const canWrite = Boolean(blockRegistry.text);

  const load = useCallback(
    (source: Email): Email => {
      const normalized = normalizeEmail(source);
      return {
        style: normalized.style,
        meta: normalized.meta,
        content: itemsOn
          ? explodeTextBlocks(normalized.content, generateId)
          : normalized.content.map((block) => ({
              ...block,
              id: generateId(),
              settings: block.settings || {},
            })),
      };
    },
    [itemsOn],
  );

  const [email, setEmail] = useState<Email>(() => load(initialEmail || defaultEmail));
  const [mode, setMode] = useState<"write" | "style">(defaultMode);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [activeCaret, setActiveCaret] = useState<number | "end">("end");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [insertAfterId, setInsertAfterId] = useState<string | null>(null);
  const [insertPlacement, setInsertPlacement] = useState<MenuPlacement>();
  // Room for the quick settings popover: the visible height of the canvas.
  const [popoverMax, setPopoverMax] = useState(480);
  const [inspectorTab, setInspectorTab] = useState<"email" | "block" | "variables">(
    "email",
  );
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");
  const [sample, setSample] = useState(false);
  const [darkInbox, setDarkInbox] = useState(false);
  const [inboxOpen, setInboxOpen] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropAt, setDropAt] = useState<{ id: string; edge: "before" | "after" } | null>(
    null,
  );
  const [toast, setToast] = useState<string | null>(null);
  const [, setHistoryVersion] = useState(0);

  // Tracks the last value this component itself emitted via onChange, in the
  // stored shape. This lets us tell a genuine external reset (another record
  // loaded by the parent) from the parent echoing our own change back down,
  // which would otherwise rebuild every item and lose the caret.
  const lastEmittedRef = useRef<Email | null>(null);
  const lastInitialEmailRef = useRef(initialEmail);
  const emailRef = useRef(email);
  const historyRef = useRef(new History<Email>());
  const rootRef = useRef<HTMLDivElement>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const choices = useMemo(() => getBlockChoices(blockRegistry), [blockRegistry]);

  const flash = useCallback((message: string) => {
    setToast(message);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2600);
  }, []);
  useEffect(() => () => clearTimeout(toastTimer.current), []);

  // Keep the parent informed in the same event that changes editor state.
  // Deferring this to an effect leaves a window where an immediate Save can
  // observe the previous document.
  const publish = useCallback(
    (nextEmail: Email) => {
      emailRef.current = nextEmail;
      setEmail(nextEmail);
      const emitted = mergeTextItems(nextEmail);
      lastEmittedRef.current = emitted;
      onChange?.(emitted);
    },
    [onChange],
  );

  const commitEmail = useCallback(
    (nextEmail: Email, historyKey: string | null = null) => {
      historyRef.current.record(emailRef.current, historyKey);
      setHistoryVersion((version) => version + 1);
      publish(nextEmail);
    },
    [publish],
  );

  const commitContent = useCallback(
    (content: EmailBlock[], historyKey: string | null = null) =>
      commitEmail({ ...emailRef.current, content }, historyKey),
    [commitEmail],
  );

  useEffect(() => {
    if (!initialEmail || initialEmail === lastInitialEmailRef.current) return;
    lastInitialEmailRef.current = initialEmail;
    const isEchoOfOwnChange =
      lastEmittedRef.current !== null &&
      JSON.stringify(lastEmittedRef.current) === JSON.stringify(initialEmail);
    if (isEchoOfOwnChange) return;

    const nextEmail = load(initialEmail);
    emailRef.current = nextEmail;
    historyRef.current.reset();
    setHistoryVersion((version) => version + 1);
    setEmail(nextEmail);
    setActiveId(null);
    setSelectedId(null);
  }, [initialEmail, load]);

  /** What a selection or an action in this mode stands for: in Style a text
   * block is one row; while writing every item is its own row. */
  const rowsOf = useCallback(
    (content: EmailBlock[], inMode: "write" | "style"): Row[] =>
      inMode === "style" && itemsOn
        ? toRows(content, { keepEmpty: true })
        : content.map((block, index) => ({
            id: block.id!,
            start: index,
            end: index + 1,
            block,
          })),
    [itemsOn],
  );

  // ---- email-wide edits ---------------------------------------------------

  const updateEmail = useCallback(
    // The inspector edits style and meta; the blocks stay ours.
    (next: Email) =>
      commitEmail({ ...emailRef.current, style: next.style, meta: next.meta }, "email"),
    [commitEmail],
  );

  const updateEmailStyle = useCallback(
    (styleUpdate: Partial<EmailStyle>) =>
      commitEmail(
        { ...emailRef.current, style: deepMerge(emailRef.current.style, styleUpdate) },
        "style",
      ),
    [commitEmail],
  );

  /** Settings from a block's form. For a whole text block, the settings apply
   * to all its items and new text is split into items again. */
  const updateBlock = useCallback(
    (id: string, partial: Partial<EmailBlock>) => {
      const content = emailRef.current.content;
      const row = rowsOf(content, mode).find((r) => r.id === id);
      if (row && mode === "style" && isItem(content[row.start])) {
        const items = content.slice(row.start, row.end);
        const { content: markdown, ...shared } = partial.settings ?? {};
        const group = items[0].group;
        const changedText =
          typeof markdown === "string" && markdown !== row.block.settings.content;
        const nextItems = changedText
          ? (splitMarkdown(markdown).length ? splitMarkdown(markdown) : [""]).map(
              (unit, index) => ({
                id: index === 0 ? items[0].id : generateId(),
                blockType: "text",
                group,
                settings: { ...items[0].settings, ...shared, content: unit },
              }),
            )
          : items.map((item) => ({
              ...item,
              settings: { ...item.settings, ...shared, content: item.settings.content },
            }));
        commitContent(
          [...content.slice(0, row.start), ...nextItems, ...content.slice(row.end)],
          `block:${id}`,
        );
        return;
      }
      commitContent(
        content.map((block) => (block.id === id ? { ...block, ...partial } : block)),
        `block:${id}`,
      );
    },
    [commitContent, mode, rowsOf],
  );

  // ---- selection ----------------------------------------------------------

  const activate = useCallback((id: string, caret: number | "end" = "end") => {
    setSelectedId(null);
    setInsertAfterId(null);
    setActiveCaret(caret);
    setActiveId(id);
  }, []);

  const select = useCallback(
    (id: string) => {
      setActiveId(null);
      setInsertAfterId(null);
      setSelectedId(id);
      if (mode === "style") {
        setInspectorTab("block");
      } else {
        const stage = rootRef.current?.querySelector(".sle-stage");
        if (stage) setPopoverMax(Math.max(180, stage.clientHeight - 32));
      }
    },
    [mode],
  );

  /** Puts the caret in an item, or selects any other block. */
  const focusBlock = useCallback(
    (id: string, caret: number | "end" = "end") => {
      const block = emailRef.current.content.find((candidate) => candidate.id === id);
      if (isItem(block)) activate(id, caret);
      else select(id);
    },
    [activate, select],
  );

  // ---- inserting ----------------------------------------------------------

  /** Adds any other block; `replaceId` swaps it in for an item. */
  const insertBlock = useCallback(
    (
      blockType: string,
      index: number,
      settings: Record<string, unknown> = {},
      replaceId?: string,
    ): string | null => {
      let content = emailRef.current.content;
      let at = index;
      if (replaceId) {
        const from = content.findIndex((block) => block.id === replaceId);
        if (from !== -1) {
          content = content.filter((block) => block.id !== replaceId);
          at = from;
        }
      }
      const insertionIndex = resolveInsertionIndex(
        blockType,
        at,
        content,
        blockRegistry,
      );
      if (insertionIndex === null) return null;
      const block: EmailBlock = {
        id: generateId(),
        blockType,
        settings: { ...getDefaultBlockSettings(blockType, blockRegistry), ...settings },
      };
      commitContent([
        ...content.slice(0, insertionIndex),
        block,
        ...content.slice(insertionIndex),
      ]);
      return block.id!;
    },
    [blockRegistry, commitContent],
  );

  /** Adds a text item. Next to another item it joins that text block, so
   * writing on stays one block rather than many. */
  const insertText = useCallback(
    (index: number, markdown: string): string | null => {
      if (!itemsOn) return insertBlock("text", index, { content: markdown });
      const content = emailRef.current.content;
      const at = resolveInsertionIndex("text", index, content, blockRegistry);
      if (at === null) return null;
      const previous = content[at - 1];
      const { content: _drop, ...settings } = isItem(previous)
        ? previous!.settings
        : {};
      const item: EmailBlock = {
        id: generateId(),
        blockType: "text",
        group: isItem(previous) ? previous!.group : generateId(),
        settings: { ...settings, content: markdown },
      };
      commitContent([...content.slice(0, at), item, ...content.slice(at)]);
      return item.id!;
    },
    [blockRegistry, commitContent, insertBlock, itemsOn],
  );

  /** Inserts what a menu offered at `index`, replacing `replaceId` if given. */
  const insertChoice = useCallback(
    (choice: BlockChoice, index: number, replaceId?: string) => {
      if (choice.text !== undefined && itemsOn) {
        const id = insertText(index, choice.text);
        if (id) activate(id, "end");
        return;
      }
      const type = choice.blockType ?? "text";
      const settings =
        choice.text !== undefined ? { content: choice.text } : choice.settings;
      const id = insertBlock(type, index, settings, replaceId);
      if (id) focusBlock(id);
    },
    [activate, focusBlock, insertBlock, insertText, itemsOn],
  );

  // ---- whole-row actions --------------------------------------------------

  const deleteBlock = useCallback(
    (id: string) => {
      const content = emailRef.current.content;
      const row = rowsOf(content, mode).find((r) => r.id === id);
      if (!row || !canDeleteBlock(row.block, blockRegistry)) return;
      commitContent([...content.slice(0, row.start), ...content.slice(row.end)]);
      setActiveId((current) => (current === id ? null : current));
      setSelectedId((current) => (current === id ? null : current));
      flash(`${labelOf(row.block, blockRegistry)} deleted. Undo brings it back.`);
    },
    [blockRegistry, commitContent, flash, mode, rowsOf],
  );

  const duplicateBlock = useCallback(
    (id: string) => {
      const content = emailRef.current.content;
      const row = rowsOf(content, mode).find((r) => r.id === id);
      if (!row || !canDuplicateBlock(row.block, blockRegistry)) return;
      const group = generateId();
      const copies = content.slice(row.start, row.end).map((block) => ({
        ...block,
        id: generateId(),
        // A copied text block in Style is its own block; a copied item while
        // writing stays part of the text it sits in.
        ...(block.group && mode === "style" ? { group } : {}),
      }));
      commitContent([
        ...content.slice(0, row.end),
        ...copies,
        ...content.slice(row.end),
      ]);
      if (mode === "style") select(copies[0].id!);
      else focusBlock(copies[0].id!);
    },
    [blockRegistry, commitContent, focusBlock, mode, rowsOf, select],
  );

  const canMoveRow = useCallback(
    (rows: Row[], id: string, direction: "up" | "down") =>
      canMoveBlock(
        rows.map((row) => ({ ...row.block, id: row.id })),
        id,
        direction,
        blockRegistry,
      ),
    [blockRegistry],
  );

  const moveBlock = useCallback(
    (id: string, direction: "up" | "down") => {
      const content = emailRef.current.content;
      const rows = rowsOf(content, mode);
      const index = rows.findIndex((row) => row.id === id);
      if (index === -1 || !canMoveRow(rows, id, direction)) return;
      const other = rows[direction === "up" ? index - 1 : index + 1];
      const row = rows[index];
      const [first, second] = direction === "up" ? [row, other] : [other, row];
      const lo = Math.min(row.start, other.start);
      const hi = Math.max(row.end, other.end);
      commitContent([
        ...content.slice(0, lo),
        ...content.slice(first.start, first.end),
        ...content.slice(second.start, second.end),
        ...content.slice(hi),
      ]);
    },
    [canMoveRow, commitContent, mode, rowsOf],
  );

  const dropBlock = useCallback(() => {
    if (dragId && dropAt) {
      const content = emailRef.current.content;
      const target = content.findIndex((block) => block.id === dropAt.id);
      const reordered =
        target === -1
          ? null
          : reorderBlocks(
              content,
              dragId,
              dropAt.edge === "before" ? target : target + 1,
              blockRegistry,
            );
      if (reordered) commitContent(reordered);
    }
    setDragId(null);
    setDropAt(null);
  }, [blockRegistry, commitContent, dragId, dropAt]);

  // ---- writing ------------------------------------------------------------

  const changeItem = useCallback(
    (id: string, markdown: string) => {
      const content = emailRef.current.content;
      commitContent(
        content.map((block) =>
          block.id === id
            ? { ...block, settings: { ...block.settings, content: markdown } }
            : block,
        ),
        `text:${id}`,
      );
    },
    [commitContent],
  );

  const splitItem = useCallback(
    (id: string, before: string, after: string) => {
      const content = emailRef.current.content;
      const index = content.findIndex((block) => block.id === id);
      const item = content[index];
      if (!item) return;
      const created: EmailBlock = {
        ...item,
        id: generateId(),
        settings: { ...item.settings, content: after },
      };
      commitContent([
        ...content.slice(0, index),
        { ...item, settings: { ...item.settings, content: before } },
        created,
        ...content.slice(index + 1),
      ]);
      activate(created.id!, 0);
    },
    [activate, commitContent],
  );

  /** Backspace at the start of a paragraph: it joins the text above, or, when
   * empty right after a button or image, goes away and selects that block. */
  const mergeBack = useCallback(
    (id: string) => {
      const content = emailRef.current.content;
      const index = content.findIndex((block) => block.id === id);
      const item = content[index];
      const previous = content[index - 1];
      if (!item || !previous) return;
      const { body } = parseItem(String(item.settings.content ?? ""));
      if (isItem(previous)) {
        const above = parseItem(String(previous.settings.content ?? ""));
        commitContent([
          ...content.slice(0, index - 1),
          {
            ...previous,
            settings: {
              ...previous.settings,
              content: itemMarkdown(above.prefix, above.body + body),
            },
          },
          ...content.slice(index + 1),
        ]);
        activate(previous.id!, above.body.length);
        return;
      }
      if (!body && canDeleteBlock(item, blockRegistry)) {
        commitContent([...content.slice(0, index), ...content.slice(index + 1)]);
        select(previous.id!);
      }
    },
    [activate, blockRegistry, commitContent, select],
  );

  const navigate = useCallback(
    (id: string, direction: "prev" | "next") => {
      const content = emailRef.current.content;
      const index = content.findIndex((block) => block.id === id);
      const step = direction === "prev" ? -1 : 1;
      for (let i = index + step; i >= 0 && i < content.length; i += step) {
        if (isItem(content[i])) {
          activate(content[i].id!, direction === "prev" ? "end" : 0);
          return;
        }
      }
    },
    [activate],
  );

  const pasteParagraphs = useCallback(
    (id: string, parts: string[], before: string, after: string) => {
      const content = emailRef.current.content;
      const index = content.findIndex((block) => block.id === id);
      const item = content[index];
      if (!item) return;
      const units = [before + parts[0], ...parts.slice(1)];
      const last = parseItem(units[units.length - 1]);
      units[units.length - 1] = itemMarkdown(last.prefix, last.body + after);
      const items = units.map((unit, i) => ({
        ...item,
        id: i === 0 ? item.id : generateId(),
        settings: { ...item.settings, content: unit },
      }));
      commitContent([
        ...content.slice(0, index),
        ...items,
        ...content.slice(index + 1),
      ]);
      activate(items[items.length - 1].id!, last.body.length);
      flash(`Pasted ${parts.length} paragraphs`);
    },
    [activate, commitContent, flash],
  );

  const applyFallback = useCallback(
    (path: string, value: string) => {
      commitContent(
        emailRef.current.content.map((block) => {
          const settings = { ...block.settings };
          let changed = false;
          for (const key of ["content", "left", "right", "text"]) {
            if (typeof settings[key] === "string") {
              const next = setFallback(settings[key], path, value);
              if (next !== settings[key]) {
                settings[key] = next;
                changed = true;
              }
            }
          }
          return changed ? { ...block, settings } : block;
        }),
      );
      flash(
        value.trim()
          ? `Fallback added to every ${path}`
          : `Fallback removed from ${path}`,
      );
    },
    [commitContent, flash],
  );

  // ---- history ------------------------------------------------------------

  const restore = useCallback(
    (snapshot: Email | undefined) => {
      setHistoryVersion((version) => version + 1);
      if (!snapshot) return;
      publish(snapshot);
      const ids = new Set(snapshot.content.map((block) => block.id));
      setActiveId((current) => (current && ids.has(current) ? current : null));
      setSelectedId((current) => (current && ids.has(current) ? current : null));
    },
    [publish],
  );
  const undo = useCallback(
    () => restore(historyRef.current.undo(emailRef.current)),
    [restore],
  );
  const redo = useCallback(
    () => restore(historyRef.current.redo(emailRef.current)),
    [restore],
  );

  // Escape closes the insert menu from anywhere.
  useEffect(() => {
    if (!insertAfterId) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setInsertAfterId(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [insertAfterId]);

  // Undo and redo work wherever focus is, unless a field of its own (the
  // subject, a settings input, the host's own inputs) should undo instead.
  // Deleting a block from its popover leaves focus on the page, not in here.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const mod = event.metaKey || event.ctrlKey;
      if (!mod || event.altKey) return;
      const key = event.key.toLowerCase();
      if (key !== "z" && key !== "y") return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable=true]")) return;
      const inEditor = target ? rootRef.current?.contains(target) : false;
      if (!inEditor && target !== document.body) return;
      event.preventDefault();
      if (key === "y" || event.shiftKey) redo();
      else undo();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [redo, undo]);

  // The quick settings popover opens under its block, which can be below the
  // fold in a short window. Bring all of it into view.
  // biome-ignore lint/correctness/useExhaustiveDependencies: only when the selection or mode changes
  useEffect(() => {
    if (mode !== "write" || !selectedId) return;
    const timer = setTimeout(() => {
      const popover = rootRef.current?.querySelector<HTMLElement>(".sle-pop");
      popover?.scrollIntoView({ block: "nearest", behavior: "smooth" });
      // Ready to type into the first field, so Escape and Tab work too.
      const field = popover?.querySelector<HTMLElement>(
        "input:not([type=checkbox]), textarea",
      );
      (field ?? popover)?.focus({ preventScroll: true });
    }, 60);
    return () => clearTimeout(timer);
  }, [selectedId, mode]);

  const checklist = useMemo(
    () => computeChecklist({ email, subject, canWrite }),
    [email, subject, canWrite],
  );

  function jump(target: ChecklistItem["target"]) {
    setMode("write");
    setInsertAfterId(null);
    setSelectedId(null);
    setActiveId(null);
    // Wait for the mode switch to render before moving focus.
    setTimeout(() => {
      if (target.type === "block") {
        focusBlock(target.blockId);
        rootRef.current
          ?.querySelector(`[data-block-id="${target.blockId}"]`)
          ?.scrollIntoView({ block: "center", behavior: "smooth" });
        return;
      }
      const field = rootRef.current?.querySelector<HTMLElement>(
        `[data-sle-field=${target.type}]`,
      );
      field?.scrollIntoView({ block: "center" });
      field?.focus();
    }, 30);
  }

  function switchMode(next: "write" | "style") {
    const rowId = selectedId ?? activeId;
    setMode(next);
    setActiveId(null);
    setInsertAfterId(null);
    if (next === "style") {
      // The selected item stands for its whole text block in Style.
      const row = rowId
        ? rowsOf(emailRef.current.content, "style").find((r) =>
            emailRef.current.content.slice(r.start, r.end).some((b) => b.id === rowId),
          )
        : undefined;
      setSelectedId(row?.id ?? null);
      setInspectorTab(row ? "block" : "email");
    } else {
      const block = emailRef.current.content.find((b) => b.id === rowId);
      setSelectedId(block && !isItem(block) ? block.id! : null);
    }
  }

  /** "Edit in Write" from the Style panel. */
  function editInWrite(id: string) {
    setMode("write");
    setSelectedId(null);
    setTimeout(() => focusBlock(id), 0);
  }

  function deselect() {
    setActiveId(null);
    setSelectedId(null);
    setInsertAfterId(null);
  }

  function writeAtEnd() {
    const content = emailRef.current.content;
    const end =
      resolveInsertionIndex("text", content.length, content, blockRegistry) ??
      content.length;
    const last = content[end - 1];
    // Keep writing in an empty last item instead of stacking blanks.
    if (isItem(last) && !parseItem(String(last.settings.content ?? "")).body.trim()) {
      activate(last.id!, "end");
      return;
    }
    const id = insertText(end, "");
    if (id) focusBlock(id, 0);
  }

  function openInsert(id: string) {
    setInsertPlacement(
      placeMenu(rootRef.current?.querySelector(`[data-block-id="${id}"]`)),
    );
    setInsertAfterId((current) => (current === id ? null : id));
  }

  // ---- what the canvas shows ----------------------------------------------

  const style = email.style;
  const inStyle = mode === "style";
  const shownStyle = inStyle && darkInbox ? darkStyle(style) : style;
  const samples = useMemo(
    () =>
      new Map(
        variables.flatMap((variable) =>
          variable.sample
            ? [[variable.tag.replace(/[{}]/g, "").trim(), variable.sample] as const]
            : [],
        ),
      ),
    [variables],
  );
  const rows = rowsOf(email.content, mode);
  const rowBlocks = rows.map(
    (row) => ({ ...row.block, id: row.id }) as Required<EmailBlock>,
  );
  const pageWidth = Number.parseInt(style.structure.page.width || "600", 10) || 600;
  const mailWidth = inStyle && device === "mobile" ? MOBILE_WIDTH : pageWidth;
  const words = email.content.reduce((sum, block) => sum + blockWords(block), 0);
  const previewText = email.meta.previewText ?? "";
  const section = style.structure.section.padding;

  // A pinned last block (the footer) stays below the place to keep writing.
  const lastRow = rows[rows.length - 1];
  const pinnedIndex =
    lastRow &&
    getBlockCapabilities(lastRow.block.blockType, blockRegistry).placement === "last"
      ? rows.length - 1
      : -1;
  const writeMore =
    mode === "write" && canWrite ? (
      <button type="button" className="sle-trail" onClick={writeAtEnd}>
        {activeId ? "" : "Keep writing, or press / for blocks"}
      </button>
    ) : null;

  const rowEvents: RowEvents = {
    onOpenInsert: openInsert,
    onGripClick: (id) => focusBlock(id),
    onMove: moveBlock,
    onDragStart: (id) => {
      setDragId(id);
      setActiveId(null);
      setInsertAfterId(null);
    },
    onDragOver: (id, edge) => {
      if (id !== dragId) setDropAt({ id, edge });
    },
    onDrop: dropBlock,
    onDragEnd: () => {
      setDragId(null);
      setDropAt(null);
    },
  };

  function floatingFor(row: Row) {
    if (insertAfterId === row.id) {
      return (
        <BlockMenu
          choices={choices}
          index={-1}
          placement={insertPlacement}
          header="Insert"
          onPick={(choice) => {
            setInsertAfterId(null);
            insertChoice(choice, row.end);
          }}
          variables={variables}
          onPickVariable={(variable) => {
            setInsertAfterId(null);
            const id = itemsOn
              ? insertText(row.end, `${variable.tag} `)
              : insertBlock("text", row.end, { content: `${variable.tag} ` });
            if (id) focusBlock(id);
          }}
        />
      );
    }
    const block = row.block;
    const component = blockRegistry[block.blockType];
    if (mode !== "write" || selectedId !== row.id || isItem(block) || !component)
      return null;
    const QuickEdit = component.quickEdit;
    const column = component.quickEditLayout === "column";
    return (
      // biome-ignore lint/a11y/useSemanticElements: a toolbar of mixed inputs and buttons has no native element
      <div
        className={`sle-pop${column ? " col" : ""}`}
        role="toolbar"
        tabIndex={-1}
        aria-label={`${component.metadata.displayName} settings`}
        style={{ maxHeight: popoverMax }}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === "Escape") {
            event.preventDefault();
            setSelectedId(null);
          }
        }}
      >
        {QuickEdit && (
          <>
            <QuickEdit
              block={{ ...block, id: row.id } as Required<EmailBlock>}
              style={style}
              updateBlock={updateBlock}
            />
            {!column && <span className="sp" />}
          </>
        )}
        <div className="acts">
          <button
            type="button"
            className="sle-btn t"
            style={{ height: 30, padding: "0 6px 0 10px" }}
            title="Colours, spacing and layout"
            onClick={() => switchMode("style")}
          >
            Style
            <ChevronRight className="size-3.5" />
          </button>
          {canDuplicateBlock(block, blockRegistry) && (
            <button
              type="button"
              className="sle-ib"
              aria-label="Duplicate"
              title="Duplicate"
              onClick={() => duplicateBlock(row.id)}
            >
              <Copy className="size-4" />
            </button>
          )}
          {canDeleteBlock(block, blockRegistry) && (
            <button
              type="button"
              className="sle-ib del"
              aria-label="Delete"
              title="Delete"
              onClick={() => deleteBlock(row.id)}
            >
              <Trash2 className="size-4" />
            </button>
          )}
        </div>
      </div>
    );
  }

  /** One paragraph, heading, list item or quote while writing. */
  function renderItem(row: Row, index: number) {
    const item = row.block;
    const content = email.content;
    const before = content[row.start - 1];
    const after = content[row.start + 1];
    const sameGroup = (other: EmailBlock | undefined) =>
      isItem(other) && other?.group === item.group;
    const runStart = !sameGroup(before);
    const runEnd = !sameGroup(after);
    const parsed = parseItem(String(item.settings.content ?? ""));
    const listKind = (block: EmailBlock | undefined) => {
      if (!sameGroup(block)) return null;
      const kind = parseItem(String(block?.settings.content ?? "")).kind;
      return kind === "li" || kind === "ol" ? kind : null;
    };
    // Numbered lists count up from their first item, as markdown does.
    let number = Number.parseInt(parsed.prefix, 10) || 1;
    if (parsed.kind === "ol") {
      let start = row.start;
      while (listKind(content[start - 1]) === "ol") start--;
      number =
        (Number.parseInt(
          parseItem(String(content[start].settings.content)).prefix,
          10,
        ) || 1) +
        (row.start - start);
    }
    const settings = item.settings;
    return (
      <ItemRow
        id={row.id}
        active={activeId === row.id}
        dragging={dragId === row.id}
        dropEdge={dropAt?.id === row.id ? dropAt.edge : null}
        canAddBelow={canInsertAfter(item, blockRegistry)}
        movable={getBlockCapabilities("text", blockRegistry).movable}
        events={rowEvents}
        floating={floatingFor(row)}
        style={{
          paddingTop: runStart ? settings.paddingTop || section?.y : 0,
          paddingBottom: runEnd ? settings.paddingBottom || section?.y : 0,
          paddingLeft: section?.x,
          paddingRight: section?.x,
          backgroundColor: settings.backgroundColor,
          color: settings.foregroundColor || shownStyle.colors.foreground,
        }}
      >
        <TextItem
          content={String(settings.content ?? "")}
          settings={settings}
          style={shownStyle}
          active={activeId === row.id}
          caret={activeCaret}
          number={number}
          listEnd={listKind(after) !== parsed.kind}
          label={`Text ${index + 1}`}
          variables={variables}
          choices={choices}
          onActivate={(caret) => activate(row.id, caret ?? "end")}
          onChange={(markdown) => changeItem(row.id, markdown)}
          onSplit={(a, b) => splitItem(row.id, a, b)}
          onMergeBack={() => mergeBack(row.id)}
          onNavigate={(direction) => navigate(row.id, direction)}
          onInsertChoice={(choice) => insertChoice(choice, row.start, row.id)}
          onPasteParagraphs={(parts, a, b) => pasteParagraphs(row.id, parts, a, b)}
          onUndo={undo}
          onRedo={redo}
          onExit={() => setActiveId(null)}
        />
      </ItemRow>
    );
  }

  function renderRow(row: Row, index: number) {
    if (mode === "write" && isItem(row.block)) return renderItem(row, index);
    const shown = (
      sample && inStyle ? withSamples(row.block, samples) : row.block
    ) as Required<EmailBlock>;
    const capabilities = getBlockCapabilities(row.block.blockType, blockRegistry);
    return (
      <BlockRow
        block={{ ...shown, id: row.id }}
        style={shownStyle}
        blockRegistry={blockRegistry}
        renderContext={renderContext}
        mode={mode}
        selected={selectedId === row.id}
        dragging={dragId === row.id}
        dropEdge={dropAt?.id === row.id ? dropAt.edge : null}
        capabilities={{
          canDelete: canDeleteBlock(row.block, blockRegistry),
          canDuplicate: canDuplicateBlock(row.block, blockRegistry),
          canMoveUp: canMoveRow(rows, row.id, "up"),
          canMoveDown: canMoveRow(rows, row.id, "down"),
          canAddBelow: canInsertAfter(row.block, blockRegistry),
          movable: capabilities.movable,
        }}
        floating={floatingFor(row)}
        events={rowEvents}
        onSelect={select}
        onDelete={deleteBlock}
        onDuplicate={duplicateBlock}
      />
    );
  }

  return (
    <div ref={rootRef} className={`sle t-${theme}`}>
      <div className={`sle-body ${mode}`}>
        <div className="sle-wrap">
          <div className="sle-mode">
            <Checklist
              items={checklist}
              label={checklistLabel(checklist)}
              onJump={jump}
              onApplyFallback={applyFallback}
            />
            <fieldset className="sle-seg" aria-label="Mode">
              <button
                type="button"
                className={mode === "write" ? "on" : undefined}
                aria-pressed={mode === "write"}
                onClick={() => switchMode("write")}
              >
                <PenLine className="size-3.5" />
                Write
              </button>
              <button
                type="button"
                className={mode === "style" ? "on" : undefined}
                aria-pressed={mode === "style"}
                onClick={() => switchMode("style")}
              >
                <SlidersHorizontal className="size-3.5" />
                Style
              </button>
            </fieldset>
          </div>

          {/* biome-ignore lint/a11y/noStaticElementInteractions: clicking the canvas background clears the selection */}
          <main className="sle-stage" aria-label="Email canvas" onClick={deselect}>
            {inStyle && (
              <>
                <ControlsBar
                  canUndo={historyRef.current.canUndo}
                  canRedo={historyRef.current.canRedo}
                  onUndo={undo}
                  onRedo={redo}
                  device={device}
                  onDevice={setDevice}
                  sample={sample}
                  onSample={setSample}
                  dark={darkInbox}
                  onDark={setDarkInbox}
                  words={words}
                />
                <InboxRow
                  senderName={senderName}
                  subject={subject ?? ""}
                  previewText={previewText}
                  width={`${mailWidth}px`}
                />
              </>
            )}
            <div
              className="sle-canvas"
              style={{ background: inStyle ? shownStyle.colors.background : undefined }}
            >
              {inStyle && (
                <button
                  type="button"
                  className="sle-canvas-hit"
                  aria-label="Email background and palette"
                  onClick={(event) => {
                    event.stopPropagation();
                    setSelectedId(null);
                    setInspectorTab("email");
                  }}
                />
              )}
              {inStyle && <span className="sle-canvas-tag">Email background</span>}
              {/* biome-ignore lint/a11y/noStaticElementInteractions: keeps clicks on the email from clearing the selection */}
              <div
                className={`sle-mail${activeId ? " typing" : ""}`}
                onClick={(event) => event.stopPropagation()}
                style={{
                  width: inStyle ? mailWidth : "100%",
                  maxWidth: inStyle ? undefined : mailWidth,
                  background: shownStyle.structure.page.background,
                  color:
                    shownStyle.structure.page.foreground ||
                    shownStyle.colors.foreground,
                  fontFamily: shownStyle.typography.text.fontFamily,
                  borderColor: shownStyle.colors.border,
                  borderWidth: inStyle ? shownStyle.structure.page.borderWidth : 0,
                  borderStyle: shownStyle.structure.page.borderStyle,
                  borderRadius: inStyle ? shownStyle.structure.page.borderRadius : 0,
                }}
              >
                {mode === "write" && (
                  <DocHeader
                    paddingX={section?.x}
                    subject={subject}
                    onSubjectChange={onSubjectChange}
                    onFieldFocus={deselect}
                    previewText={previewText}
                    onPreviewTextChange={(text) =>
                      commitEmail(
                        {
                          ...emailRef.current,
                          meta: { ...emailRef.current.meta, previewText: text },
                        },
                        "preview",
                      )
                    }
                    senderName={senderName}
                    inboxOpen={inboxOpen}
                    onToggleInbox={() => setInboxOpen((open) => !open)}
                    onEnter={() => {
                      const first = email.content.find(isItem);
                      if (first) activate(first.id!, 0);
                      else if (canWrite) writeAtEnd();
                    }}
                  />
                )}
                {rows.map((row, index) => (
                  <Fragment key={row.id}>
                    {index === pinnedIndex && writeMore}
                    {renderRow(row, index)}
                  </Fragment>
                ))}
                {pinnedIndex === -1 && writeMore}
              </div>
            </div>
            {mode === "write" && (
              <p className="sle-cap">Switch to Style to see it as readers will.</p>
            )}
          </main>
        </div>

        {inStyle && (
          <Inspector
            email={{ ...email, content: rowBlocks }}
            selectedId={selectedId}
            blockRegistry={blockRegistry}
            variables={variables}
            tab={inspectorTab}
            onTab={setInspectorTab}
            updateEmail={updateEmail}
            updateEmailStyle={updateEmailStyle}
            updateBlock={updateBlock}
            onEditInWrite={editInWrite}
            onCopied={(tag) => flash(`Copied ${tag}`)}
          />
        )}
      </div>
      {toast && (
        <div className="sle-toast" role="status">
          {toast}
        </div>
      )}
    </div>
  );
}
