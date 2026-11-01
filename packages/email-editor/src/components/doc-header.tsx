import { ChevronDown, ChevronUp, Smartphone } from "lucide-react";

const SUBJECT_LIMIT = 60;

function Initials({ name }: { name: string }) {
  const letters = name
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  return <span className="av">{letters || "?"}</span>;
}

/** The inbox row a subscriber sees: sender, subject and preview text. */
export function InboxRow({
  senderName,
  subject,
  previewText,
  width,
}: {
  senderName: string;
  subject: string;
  previewText: string;
  width?: string;
}) {
  return (
    <section className="sle-inbox" style={{ width }} aria-label="Inbox preview">
      <Initials name={senderName} />
      <b>{senderName}</b>
      <time>10:42 AM</time>
      <span className="ln">
        <b>{subject || "(no subject)"}</b> <span>— </span>
        {previewText ? <span>{previewText}</span> : <em>No preview text yet</em>}
      </span>
    </section>
  );
}

/** Subject line and preview text, written above the email like a document title. */
export function DocHeader({
  paddingX,
  onFieldFocus,
  subject,
  onSubjectChange,
  previewText,
  onPreviewTextChange,
  senderName,
  inboxOpen,
  onToggleInbox,
  onEnter,
}: {
  /** Matches the email's own side padding so text lines up with the blocks. */
  paddingX?: string;
  /** Writing in the subject or preview text clears the email's selection. */
  onFieldFocus?: () => void;
  /** Omitted when the host edits the subject elsewhere. */
  subject?: string;
  onSubjectChange?: (subject: string) => void;
  previewText: string;
  onPreviewTextChange: (text: string) => void;
  senderName: string;
  inboxOpen: boolean;
  onToggleInbox: () => void;
  /** Enter in the last field moves the caret into the email body. */
  onEnter: () => void;
}) {
  const editable = subject !== undefined && onSubjectChange;
  return (
    <div
      className="sle-doc-h"
      style={paddingX ? { paddingLeft: paddingX, paddingRight: paddingX } : undefined}
    >
      {editable && (
        <div className="fld">
          <span className="tg">Subject</span>
          <textarea
            className="sle-subj"
            rows={1}
            aria-label="Subject line"
            placeholder="Subject line"
            data-sle-field="subject"
            onFocus={onFieldFocus}
            value={subject}
            onChange={(event) =>
              onSubjectChange(event.target.value.replace(/\n/g, " "))
            }
            onKeyDown={(event) => {
              const textarea = event.currentTarget;
              const atEnd = textarea.selectionStart === textarea.value.length;
              if (event.key === "Enter" || (event.key === "ArrowDown" && atEnd)) {
                event.preventDefault();
                document
                  .querySelector<HTMLInputElement>("[data-sle-field=preview]")
                  ?.focus();
              }
            }}
          />
        </div>
      )}
      <div className="fld">
        <span className="tg">Preview text</span>
        <input
          className="sle-prev"
          aria-label="Preview text"
          placeholder="Preview text: the line shown after the subject in the inbox"
          data-sle-field="preview"
          onFocus={onFieldFocus}
          value={previewText}
          onChange={(event) => onPreviewTextChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === "ArrowDown") {
              event.preventDefault();
              onEnter();
            } else if (event.key === "ArrowUp") {
              const subject = document.querySelector<HTMLTextAreaElement>(
                "[data-sle-field=subject]",
              );
              if (!subject) return;
              event.preventDefault();
              subject.focus();
              subject.setSelectionRange(subject.value.length, subject.value.length);
            }
          }}
        />
      </div>
      <div className="sle-meta">
        {editable && (
          <span className={subject.trim().length > SUBJECT_LIMIT ? "warn" : undefined}>
            {subject.trim().length}/{SUBJECT_LIMIT} characters
          </span>
        )}
        <button
          type="button"
          className="lnk"
          onClick={onToggleInbox}
          aria-expanded={inboxOpen}
        >
          <Smartphone className="size-3.5" />
          Preview in inbox
          {inboxOpen ? (
            <ChevronUp className="size-3.5" />
          ) : (
            <ChevronDown className="size-3.5" />
          )}
        </button>
      </div>
      {inboxOpen && (
        <div className="sle-ibx">
          <div className="pv phone">
            <span className="cap">Phone</span>
            <div className="card ph">
              <Initials name={senderName} />
              <div>
                <div className="l1">
                  <b>{senderName}</b>
                  <time>10:42 AM</time>
                </div>
                <div className="sj">{subject || "(no subject)"}</div>
                <div className="pt">{previewText || "No preview text yet"}</div>
              </div>
            </div>
          </div>
          <div className="pv">
            <span className="cap">Desktop</span>
            <div className="card dk">
              <span className="fr">{senderName}</span>
              <span className="ln">
                <b>{subject || "(no subject)"}</b>{" "}
                <span>— {previewText || "No preview text yet"}</span>
              </span>
              <time>10:42 AM</time>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
