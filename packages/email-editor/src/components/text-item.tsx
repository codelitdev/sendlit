import {
  Bold,
  Braces,
  Heading2,
  Italic,
  Link as LinkIcon,
  List,
  TextQuote,
} from "lucide-react";
import {
  type ClipboardEvent,
  type CSSProperties,
  type KeyboardEvent,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { filterChoices } from "../lib/block-choices";
import { placedSegments } from "../lib/inline-markdown";
import {
  insertVariable,
  linkSelection,
  type TextEdit,
  variableTrigger,
  wrapSelection,
} from "../lib/markdown-edit";
import { type MenuPlacement, placeMenu } from "../lib/menu-placement";
import { type ItemKind, itemMarkdown, parseItem, SHORTCUTS } from "../lib/text-items";
import type { BlockChoice, EditorVariable } from "../types/editor-ui";
import type { EmailStyle } from "../types/email-editor";
import { BlockMenu, VariableMenu } from "./block-menu";

type Menu = { kind: "slash"; query: string } | { kind: "variable" } | null;

const SLASH = /^\/([a-z0-9 ]{0,14})$/i;

const KIND_NAMES: Record<ItemKind, string> = {
  p: "Paragraph",
  h1: "Heading 1",
  h2: "Heading 2",
  h3: "Heading 3",
  li: "Bullet",
  ol: "Numbered item",
  quote: "Quote",
};

/** The words of an item without its markdown, for its accessible name. */
export function plainText(markdown: string): string {
  return markdown
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\{\{\s*([\w.]+)[^}]*\}\}/g, "$1")
    .replace(/[*_`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function snippet(text: string) {
  const plain = plainText(text);
  if (!plain) return "empty";
  return plain.length > 60 ? `${plain.slice(0, 60)}…` : plain;
}

/** How an item looks, following the email's typography and the markdown
 * renderer's spacing, so writing looks like the email that is sent. */
export function itemStyle(
  kind: ItemKind,
  settings: Record<string, any>,
  style: EmailStyle | undefined,
  { listEnd }: { listEnd: boolean },
): CSSProperties {
  const size =
    Number.parseInt(settings.fontSize || style?.typography.text.fontSize || "16", 10) ||
    16;
  const heading = kind === "h1" || kind === "h2" || kind === "h3";
  const fontSize =
    kind === "h1"
      ? Math.max(size * 2, 32)
      : kind === "h2"
        ? Math.max(size * 1.5, 24)
        : kind === "h3"
          ? Math.max(size * 1.25, 20)
          : size;
  const margin = heading
    ? "16px 0 8px"
    : kind === "li" || kind === "ol"
      ? `4px 0 ${listEnd ? 20 : 4}px`
      : kind === "quote"
        ? "1.5em 10px"
        : "0 0 16px";
  return {
    fontFamily:
      settings.fontFamily ||
      (heading
        ? style?.typography.header.fontFamily
        : style?.typography.text.fontFamily),
    fontSize,
    fontWeight: heading ? 700 : undefined,
    lineHeight: heading
      ? 1.25
      : settings.lineHeight || style?.typography.text.lineHeight || 1.5,
    margin,
  };
}

export interface TextItemProps {
  content: string;
  settings: Record<string, any>;
  style: EmailStyle;
  active: boolean;
  /** Where the caret goes when this item becomes active. */
  caret: number | "end";
  /** The number shown on a numbered-list item. */
  number?: number;
  /** The last item of a list gets the list's bottom margin. */
  listEnd: boolean;
  variables: EditorVariable[];
  choices: BlockChoice[];
  /** `caret` is where the click landed in the markdown, when known. */
  onActivate: (caret?: number) => void;
  onChange: (content: string) => void;
  /** Enter: this item keeps `before`, a new item below gets `after`. */
  onSplit: (before: string, after: string) => void;
  /** Backspace at the start of a paragraph: join the previous item. */
  onMergeBack: () => void;
  onNavigate: (direction: "prev" | "next") => void;
  /** Alt+Shift+arrows: move this item up or down. */
  onMove: (direction: "up" | "down") => void;
  /** A block picked from the `/` menu replaces this item. */
  onInsertChoice: (choice: BlockChoice) => void;
  /** Several paragraphs pasted at once, around the caret. */
  onPasteParagraphs: (parts: string[], before: string, after: string) => void;
  onUndo: () => void;
  onRedo: () => void;
  onExit: () => void;
}

/** One paragraph, heading, list item or quote: shown formatted, edited in
 * place as plain text with markdown marks for bold, italics and links. */
export function TextItem(props: TextItemProps) {
  const { content, settings, style, active, number, listEnd, variables, choices } =
    props;
  const { kind, prefix, body } = parseItem(content);
  const ref = useRef<HTMLTextAreaElement>(null);
  const pendingSelection = useRef<{ start: number; end: number } | null>(null);
  const [selection, setSelection] = useState({ start: 0, end: 0 });
  const [menu, setMenu] = useState<Menu>(null);
  const [menuIndex, setMenuIndex] = useState(0);
  const [placement, setPlacement] = useState<MenuPlacement>();
  const toolbarRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  const slashChoices = menu?.kind === "slash" ? filterChoices(choices, menu.query) : [];
  const listLength = menu?.kind === "variable" ? variables.length : slashChoices.length;

  // Focus when activated, caret where the writer expects it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: on activation only
  useLayoutEffect(() => {
    if (!active) {
      setMenu(null);
      return;
    }
    const el = ref.current;
    if (!el) return;
    el.focus();
    const at =
      props.caret === "end" ? el.value.length : Math.min(props.caret, el.value.length);
    el.setSelectionRange(at, at);
    setSelection({ start: at, end: at });
  }, [active, props.caret]);

  // Grow with the text, and restore a selection set by an edit.
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-run whenever the text changes
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
    const pending = pendingSelection.current;
    if (pending) {
      pendingSelection.current = null;
      el.setSelectionRange(pending.start, pending.end);
      setSelection(pending);
    }
  }, [content, active]);

  // Grow or shrink when the canvas changes width, as text rewraps.
  useEffect(() => {
    const el = ref.current;
    if (!active || !el?.parentElement || typeof ResizeObserver === "undefined") return;
    let width = el.clientWidth;
    const observer = new ResizeObserver(() => {
      if (el.clientWidth === width) return;
      width = el.clientWidth;
      el.style.height = "auto";
      el.style.height = `${el.scrollHeight}px`;
    });
    observer.observe(el.parentElement);
    return () => observer.disconnect();
  }, [active]);

  const setBody = (edit: TextEdit, nextPrefix = prefix) => {
    pendingSelection.current = { start: edit.start, end: edit.end };
    props.onChange(itemMarkdown(nextPrefix, edit.text));
  };

  const current = () => {
    const el = ref.current;
    return {
      text: el?.value ?? body,
      start: el?.selectionStart ?? 0,
      end: el?.selectionEnd ?? 0,
    };
  };

  /** Switches between a paragraph and a heading, list or quote. */
  const toggleKind = (target: string) => {
    const s = current();
    const same = target === "" ? kind === "p" : prefix === target;
    setBody(s, same ? "" : target);
  };

  function onTextChange(value: string, caretAt: number) {
    // A markdown shortcut typed at the start converts the item.
    if (kind === "p" || kind === "li" || kind === "ol") {
      const hit = SHORTCUTS.find(
        ([typed]) => value.startsWith(typed) && !body.startsWith(typed),
      );
      if (hit && (kind === "p" || hit[1] !== prefix)) {
        const rest = value.slice(hit[0].length);
        const at = Math.max(0, caretAt - hit[0].length);
        pendingSelection.current = { start: at, end: at };
        props.onChange(itemMarkdown(hit[1], rest));
        setMenu(null);
        return;
      }
    }
    const slash = value.match(SLASH);
    if (slash && (value === "/" || menu?.kind === "slash")) {
      setPlacement(placeMenu(ref.current));
      setMenu({ kind: "slash", query: slash[1] });
      setMenuIndex(0);
    } else if (variableTrigger(value, caretAt) && variables.length > 0) {
      setPlacement(placeMenu(ref.current));
      setMenu({ kind: "variable" });
      setMenuIndex(0);
    } else if (menu) {
      setMenu(null);
    }
    pendingSelection.current = { start: caretAt, end: caretAt };
    props.onChange(itemMarkdown(prefix, value));
  }

  function pickChoice(choice: BlockChoice) {
    setMenu(null);
    if (choice.text !== undefined) {
      pendingSelection.current = { start: 0, end: 0 };
      props.onChange(choice.text);
      return;
    }
    props.onInsertChoice(choice);
  }

  function pickVariable(variable: EditorVariable) {
    const s = current();
    setMenu(null);
    setBody(
      insertVariable(s.text, s.start, s.end, variable.tag.replace(/[{}]/g, "").trim()),
    );
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    const mod = event.metaKey || event.ctrlKey;
    const key = event.key;
    const { text, start, end } = current();

    if (menu && listLength > 0) {
      const columns = menu.kind === "slash" ? 4 : 1;
      const move = (delta: number) => {
        event.preventDefault();
        setMenuIndex((index) => (index + delta + listLength) % listLength);
      };
      if (key === "ArrowDown") return move(columns);
      if (key === "ArrowUp") return move(-columns);
      if (key === "ArrowRight" && columns > 1) return move(1);
      if (key === "ArrowLeft" && columns > 1) return move(-1);
      if (key === "Enter" || key === "Tab") {
        event.preventDefault();
        if (menu.kind === "slash") pickChoice(slashChoices[menuIndex]);
        else pickVariable(variables[menuIndex]);
        return;
      }
    }
    if (key === "Escape") {
      event.preventDefault();
      if (menu) setMenu(null);
      else props.onExit();
      return;
    }
    if (event.altKey && event.shiftKey && (key === "ArrowUp" || key === "ArrowDown")) {
      event.preventDefault();
      props.onMove(key === "ArrowUp" ? "up" : "down");
      return;
    }
    // Alt+F10 reaches the format toolbar, as in other editors.
    if (event.altKey && key === "F10") {
      event.preventDefault();
      toolbarRef.current?.querySelector<HTMLElement>("button")?.focus();
      return;
    }
    if (mod && key.toLowerCase() === "z") {
      event.preventDefault();
      if (event.shiftKey) props.onRedo();
      else props.onUndo();
      return;
    }
    if (mod && key.toLowerCase() === "y") {
      event.preventDefault();
      props.onRedo();
      return;
    }
    if (mod && ["b", "i", "k"].includes(key.toLowerCase())) {
      event.preventDefault();
      const k = key.toLowerCase();
      setBody(
        k === "b"
          ? wrapSelection(text, start, end, "**")
          : k === "i"
            ? wrapSelection(text, start, end, "*")
            : linkSelection(text, start, end),
      );
      return;
    }
    if (key === "Enter" && !event.shiftKey && !menu) {
      event.preventDefault();
      // Enter on an empty list item or quote ends the list or quote.
      if ((kind === "li" || kind === "ol" || kind === "quote") && !text.trim()) {
        pendingSelection.current = { start: 0, end: 0 };
        props.onChange("");
        return;
      }
      const nextPrefix =
        kind === "ol"
          ? `${(Number.parseInt(prefix, 10) || 1) + 1}. `
          : kind === "li"
            ? prefix
            : "";
      props.onSplit(
        itemMarkdown(prefix, text.slice(0, start)),
        itemMarkdown(nextPrefix, text.slice(end)),
      );
      return;
    }
    if (key === "Backspace" && start === 0 && end === 0) {
      // A heading, list item or quote first goes back to being a paragraph.
      if (kind !== "p") {
        event.preventDefault();
        pendingSelection.current = { start: 0, end: 0 };
        props.onChange(text);
        return;
      }
      event.preventDefault();
      props.onMergeBack();
      return;
    }
    if ((key === "ArrowUp" || key === "ArrowLeft") && start === 0 && end === 0) {
      event.preventDefault();
      props.onNavigate("prev");
      return;
    }
    if (
      (key === "ArrowDown" || key === "ArrowRight") &&
      start === text.length &&
      end === text.length
    ) {
      event.preventDefault();
      props.onNavigate("next");
    }
  }

  function onPaste(event: ClipboardEvent<HTMLTextAreaElement>) {
    const clip = event.clipboardData.getData("text/plain");
    const parts = clip
      .replace(/\r/g, "")
      .split(/\n+/)
      .filter((part) => part.trim());
    if (parts.length < 2) return;
    event.preventDefault();
    const { text, start, end } = current();
    props.onPasteParagraphs(
      parts,
      itemMarkdown(prefix, text.slice(0, start)),
      text.slice(end),
    );
  }

  const listClass = kind === "li" || kind === "ol" ? " list" : "";
  const elementStyle: CSSProperties = {
    ...itemStyle(kind, settings, style, { listEnd }),
    textAlign: settings.alignment,
  };
  const hasSelection = active && selection.end > selection.start;

  return (
    <div
      className={`sle-item k-${kind}${listClass}`}
      data-n={kind === "ol" ? `${number ?? 1}.` : undefined}
      style={elementStyle}
    >
      {hasSelection && (
        <div
          ref={toolbarRef}
          className="sle-fmt"
          role="toolbar"
          aria-label="Format"
          onMouseDown={(event) => event.preventDefault()}
          // Every button acts on the text, so focus goes back to it.
          onClick={() => ref.current?.focus()}
          onKeyDown={(event) => {
            const buttons = Array.from(
              toolbarRef.current?.querySelectorAll<HTMLElement>("button") ?? [],
            );
            const at = buttons.indexOf(document.activeElement as HTMLElement);
            const step =
              event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
            if (step) {
              event.preventDefault();
              buttons[(at + step + buttons.length) % buttons.length]?.focus();
            } else if (event.key === "Escape") {
              event.preventDefault();
              ref.current?.focus();
            }
          }}
        >
          <button
            type="button"
            aria-label="Bold"
            title="Bold  ⌘B"
            onClick={() => {
              const s = current();
              setBody(wrapSelection(s.text, s.start, s.end, "**"));
            }}
          >
            <Bold className="size-3.5" />
          </button>
          <button
            type="button"
            aria-label="Italic"
            title="Italic  ⌘I"
            onClick={() => {
              const s = current();
              setBody(wrapSelection(s.text, s.start, s.end, "*"));
            }}
          >
            <Italic className="size-3.5" />
          </button>
          <button
            type="button"
            aria-label="Link"
            title="Link  ⌘K"
            onClick={() => {
              const s = current();
              setBody(linkSelection(s.text, s.start, s.end));
            }}
          >
            <LinkIcon className="size-3.5" />
          </button>
          <span className="sp" />
          <button
            type="button"
            aria-label="Heading"
            title="Heading"
            onClick={() => toggleKind("## ")}
          >
            <Heading2 className="size-3.5" />
          </button>
          <button
            type="button"
            aria-label="Bulleted list"
            title="Bulleted list"
            onClick={() => toggleKind("- ")}
          >
            <List className="size-3.5" />
          </button>
          <button
            type="button"
            aria-label="Quote"
            title="Quote"
            onClick={() => toggleKind("> ")}
          >
            <TextQuote className="size-3.5" />
          </button>
          {variables.length > 0 && (
            <>
              <span className="sp" />
              <button
                type="button"
                aria-label="Insert merge tag"
                title="Insert merge tag"
                onClick={() => {
                  setPlacement(placeMenu(ref.current));
                  setMenu({ kind: "variable" });
                  setMenuIndex(0);
                }}
              >
                <Braces className="size-3.5" />
              </button>
            </>
          )}
        </div>
      )}
      {active ? (
        <textarea
          ref={ref}
          className="sle-ed"
          aria-label={KIND_NAMES[kind]}
          aria-keyshortcuts="Alt+F10 Alt+Shift+ArrowUp Alt+Shift+ArrowDown"
          aria-autocomplete="list"
          aria-controls={menu ? menuId : undefined}
          aria-activedescendant={
            menu && listLength > 0 ? `${menuId}-${menuIndex}` : undefined
          }
          placeholder={
            kind === "p"
              ? "Write something, or type / for blocks"
              : kind === "li" || kind === "ol"
                ? "List item"
                : kind === "quote"
                  ? "Quote"
                  : "Heading"
          }
          rows={1}
          value={body}
          onChange={(event) =>
            onTextChange(event.target.value, event.target.selectionStart)
          }
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          onSelect={(event) =>
            setSelection({
              start: event.currentTarget.selectionStart,
              end: event.currentTarget.selectionEnd,
            })
          }
          onBlur={() => setMenu(null)}
          spellCheck
        />
      ) : (
        <>
          {/* biome-ignore lint/a11y/useKeyWithClickEvents lint/a11y/noStaticElementInteractions: the button below is the keyboard way in */}
          <span
            className="sle-inline-hit"
            onClick={(event) => {
              event.stopPropagation();
              props.onActivate(
                caretFromPoint(event.clientX, event.clientY, body.length),
              );
            }}
          >
            <InlineText text={body} accent={style.colors.accent} />
          </span>
          <button
            type="button"
            className="sle-hit"
            aria-label={`${KIND_NAMES[kind]}: ${snippet(body)}`}
            onClick={(event) => {
              event.stopPropagation();
              props.onActivate();
            }}
          />
        </>
      )}
      {active && menu?.kind === "slash" && (
        <BlockMenu
          id={menuId}
          choices={slashChoices}
          index={menuIndex}
          onHover={setMenuIndex}
          onPick={pickChoice}
          placement={placement}
        />
      )}
      {active && menu?.kind === "variable" && (
        <VariableMenu
          id={menuId}
          variables={variables}
          index={menuIndex}
          onHover={setMenuIndex}
          onPick={pickVariable}
          placement={placement}
        />
      )}
    </div>
  );
}

/** The markdown offset under a click on formatted text, so the caret lands
 * where the writer clicked rather than at the end. */
function caretFromPoint(x: number, y: number, length: number): number | undefined {
  const doc = document as Document & {
    caretPositionFromPoint?: (
      x: number,
      y: number,
    ) => { offsetNode: Node; offset: number } | null;
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
  };
  let node: Node | null = null;
  let offset = 0;
  const position = doc.caretPositionFromPoint?.(x, y);
  if (position) {
    node = position.offsetNode;
    offset = position.offset;
  } else {
    const range = doc.caretRangeFromPoint?.(x, y);
    if (range) {
      node = range.startContainer;
      offset = range.startOffset;
    }
  }
  const element = (
    node?.nodeType === Node.TEXT_NODE ? node.parentElement : (node as Element | null)
  )?.closest<HTMLElement>("[data-from]");
  if (!element) return undefined;
  if (element.dataset.kind === "tag") return Number(element.dataset.end);
  return Math.min(length, Number(element.dataset.from) + offset);
}

/** Bold, italics, links and merge-tag chips, as a reader would see them. */
function InlineText({ text, accent }: { text: string; accent?: string }) {
  if (!text) return <span className="sle-empty-item">{" "}</span>;
  return (
    <span className="sle-inline">
      {placedSegments(text).map((segment) => {
        const key = `${segment.from}-${segment.type}`;
        const place = {
          "data-from": segment.from,
          "data-end": segment.end,
          "data-kind": segment.type,
        };
        switch (segment.type) {
          case "bold":
            return (
              <strong key={key} {...place}>
                {segment.text}
              </strong>
            );
          case "italic":
            return (
              <em key={key} {...place}>
                {segment.text}
              </em>
            );
          case "link":
            return (
              <span key={key} {...place} className="m-link" style={{ color: accent }}>
                {segment.text}
              </span>
            );
          case "tag":
            return (
              <span key={key} {...place} className="m-var">
                {segment.path}
                {segment.fallback !== undefined && <i>· {segment.fallback}</i>}
              </span>
            );
          default:
            return (
              <span key={key} {...place}>
                {segment.text}
              </span>
            );
        }
      })}
    </span>
  );
}
