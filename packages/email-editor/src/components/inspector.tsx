import { Check, Copy, PenLine, Search } from "lucide-react";
import { type KeyboardEvent, useId, useState } from "react";
import { activePalette, type Palette, PALETTES } from "../lib/palettes";
import type { BlockRegistry } from "../types/block-registry";
import type {
  Email,
  EmailBlock,
  EmailStyle,
  RuntimeEmailBlock,
} from "../types/email-editor";
import type { EditorVariable } from "../types/editor-ui";
import { EmailSettings } from "./email-settings";

type Tab = "email" | "block" | "variables";

/** The Style panel: the email's look, the selected block, and merge tags. */
export function Inspector({
  email,
  selectedId,
  blockRegistry,
  variables,
  tab,
  onTab,
  updateEmail,
  updateEmailStyle,
  onPalette,
  updateBlock,
  onEditInWrite,
  onCopied,
  onEscape,
}: {
  email: Email;
  selectedId: string | null;
  blockRegistry: BlockRegistry;
  variables: EditorVariable[];
  tab: Tab;
  onTab: (tab: Tab) => void;
  updateEmail: (email: Email) => void;
  updateEmailStyle: (style: Partial<EmailStyle>) => void;
  /** The palette for the whole email, its blocks included. */
  onPalette: (palette: Palette) => void;
  updateBlock: (id: string, content: Partial<EmailBlock>) => void;
  /** Back to writing, at the selected block. */
  onEditInWrite: (id: string) => void;
  onCopied: (tag: string) => void;
  /** Escape in the panel: back to the selected block on the canvas. */
  onEscape?: () => void;
}) {
  const block = selectedId
    ? (email.content.find((candidate) => candidate.id === selectedId) as
        | RuntimeEmailBlock
        | undefined)
    : undefined;
  const component = block ? blockRegistry[block.blockType] : undefined;
  const Settings = component?.settings;
  const tabs: [Tab, string][] = [
    ["email", "Email"],
    ["block", "Block"],
    ["variables", "Tags"],
  ];
  const ids = useId();

  // Arrow keys, Home and End move between the tabs, as in any tab list.
  function onTabKey(event: KeyboardEvent<HTMLDivElement>) {
    const at = tabs.findIndex(([id]) => id === tab);
    const next =
      event.key === "ArrowRight"
        ? (at + 1) % tabs.length
        : event.key === "ArrowLeft"
          ? (at - 1 + tabs.length) % tabs.length
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? tabs.length - 1
              : -1;
    if (next === -1) return;
    event.preventDefault();
    onTab(tabs[next][0]);
    event.currentTarget.querySelectorAll<HTMLElement>("[role=tab]")[next]?.focus();
  }

  return (
    <aside
      className="sle-panel"
      aria-label="Style"
      onKeyDown={(event) => {
        // Not keys from a dropdown that renders elsewhere and bubbles here.
        if (event.key !== "Escape" || event.defaultPrevented) return;
        if (!event.currentTarget.contains(event.target as Node)) return;
        event.preventDefault();
        onEscape?.();
      }}
    >
      <div className="sle-ph">
        <div
          className="sle-tabs"
          role="tablist"
          aria-label="Style panel"
          tabIndex={-1}
          onKeyDown={onTabKey}
        >
          {tabs.map(([id, label]) => (
            <button
              key={id}
              id={`${ids}-${id}`}
              type="button"
              role="tab"
              aria-selected={tab === id}
              aria-controls={`${ids}-panel`}
              tabIndex={tab === id ? 0 : -1}
              className={`sle-tab${tab === id ? " on" : ""}`}
              onClick={() => onTab(id)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <div
        className="sle-scroll"
        id={`${ids}-panel`}
        role="tabpanel"
        aria-labelledby={`${ids}-${tab}`}
      >
        {tab === "email" && (
          <>
            <div className="sle-sec">
              <h3>Palette</h3>
              <div className="sle-presets">
                {PALETTES.map((palette) => (
                  <button
                    key={palette.name}
                    type="button"
                    className={`sle-preset${activePalette(email) === palette.name ? " on" : ""}`}
                    aria-pressed={activePalette(email) === palette.name}
                    onClick={() => onPalette(palette)}
                  >
                    <span className="sw" style={{ background: palette.canvas }}>
                      <span
                        className="card"
                        style={{
                          background: palette.page,
                          borderColor: palette.border,
                        }}
                      >
                        <i className="a" style={{ background: palette.accent }} />
                        <i style={{ background: palette.text, opacity: 0.5 }} />
                      </span>
                    </span>
                    {palette.name}
                  </button>
                ))}
              </div>
            </div>
            <EmailSettings
              email={email}
              updateEmail={updateEmail}
              updateEmailStyle={updateEmailStyle}
            />
          </>
        )}
        {tab === "block" &&
          (block && component && Settings ? (
            <>
              <div className="sle-sel-h">
                <component.metadata.icon className="size-4" />
                <b>{component.metadata.displayName}</b>
                <button
                  type="button"
                  className="sle-btn t"
                  style={{ marginLeft: "auto", height: 28 }}
                  onClick={() => onEditInWrite(block.id)}
                >
                  <PenLine className="size-3.5" />
                  Edit in Write
                </button>
              </div>
              <Settings block={block} style={email.style} updateBlock={updateBlock} />
            </>
          ) : (
            <div className="sle-empty">
              <b>Nothing selected</b>
              Click a block in the email to change how it looks.
            </div>
          ))}
        {tab === "variables" && (
          <VariableList variables={variables} onCopied={onCopied} />
        )}
      </div>
    </aside>
  );
}

function VariableList({
  variables,
  onCopied,
}: {
  variables: EditorVariable[];
  onCopied: (tag: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [copied, setCopied] = useState<string | null>(null);
  const shown = variables.filter((variable) =>
    `${variable.tag} ${variable.description}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );

  async function copy(tag: string) {
    try {
      await navigator.clipboard.writeText(tag);
      setCopied(tag);
      onCopied(tag);
      setTimeout(
        () => setCopied((current) => (current === tag ? null : current)),
        1500,
      );
    } catch {
      // Clipboard access can be denied; the tag stays visible to copy by hand.
    }
  }

  return (
    <>
      <p className="sle-hint">
        Merge tags are replaced with each contact's details when the email is sent. Type{" "}
        <code>{"{{"}</code> while writing to insert one.
      </p>
      <label className="sle-search" style={{ marginTop: 12 }}>
        <Search className="size-3.5" />
        <input
          placeholder="Search tags"
          aria-label="Search tags"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>
      {shown.length === 0 ? (
        <p className="sle-hint" style={{ marginTop: 12 }}>
          {variables.length === 0 ? "This email has no merge tags." : "No tags match."}
        </p>
      ) : (
        <ul className="sle-vars">
          {shown.map((variable) => (
            <li key={variable.tag} className="sle-var">
              <code>{variable.tag}</code>
              <span>{variable.description}</span>
              <span className="acts">
                <button
                  type="button"
                  className="sle-ib"
                  aria-label={`Copy ${variable.tag}`}
                  onClick={() => copy(variable.tag)}
                >
                  {copied === variable.tag ? (
                    <Check className="size-3.5" />
                  ) : (
                    <Copy className="size-3.5" />
                  )}
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
