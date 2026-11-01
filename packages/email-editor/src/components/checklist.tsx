import { AlertTriangle, CheckCircle2, ListChecks, XCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { ChecklistItem } from "../lib/checklist";

/** "Before you send": what to fix, one click to jump to it. */
export function Checklist({
  items,
  label,
  onJump,
  onApplyFallback,
}: {
  items: ChecklistItem[];
  label: string;
  onJump: (target: ChecklistItem["target"]) => void;
  /** Adds a fallback to every use of a merge tag. */
  onApplyFallback: (path: string, value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const ref = useRef<HTMLDivElement>(null);
  const must = items.filter((item) => item.level === "must").length;
  const state = must > 0 ? "bad" : items.length > 0 ? "warn" : "ok";

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const Icon =
    state === "bad" ? XCircle : state === "warn" ? AlertTriangle : CheckCircle2;

  return (
    <div className="sle-chkwrap" ref={ref}>
      <button
        type="button"
        className={`sle-chkbtn ${state}`}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <Icon className="size-3.5" />
        {label}
      </button>
      {open && (
        <div className="sle-chk" role="dialog" aria-label="Before you send">
          <div className="hd">
            <b>Before you send</b>
            <span>
              {state === "ok"
                ? "Nothing needs fixing."
                : "Fix the red ones first; the amber ones help you reach the inbox."}
            </span>
          </div>
          {items.length === 0 ? (
            <p className="ok">
              <ListChecks className="size-4" /> Subject, preview text, links and images
              look good.
            </p>
          ) : (
            <ul>
              {items.map((item) => {
                const fallback = item.fallback;
                const draft = fallback ? (drafts[fallback.path] ?? "") : "";
                const apply = () => {
                  if (!fallback || !draft.trim()) return;
                  onApplyFallback(fallback.path, draft);
                  setDrafts((current) => ({ ...current, [fallback.path]: "" }));
                };
                return (
                  <li key={item.id} className={item.level}>
                    {item.level === "must" ? (
                      <XCircle className="ic size-4" />
                    ) : (
                      <AlertTriangle className="ic size-4" />
                    )}
                    <span className="tx">
                      <b>{item.title}</b>
                      <span>{item.detail}</span>
                      {fallback && (
                        <span className="fbrow">
                          <input
                            className="sle-in"
                            aria-label={`Fallback for ${fallback.path}`}
                            placeholder="e.g. there"
                            value={draft}
                            onChange={(event) =>
                              setDrafts((current) => ({
                                ...current,
                                [fallback.path]: event.target.value,
                              }))
                            }
                            onKeyDown={(event) => {
                              if (event.key === "Enter") apply();
                            }}
                          />
                          <button
                            type="button"
                            className="sle-btn o"
                            disabled={!draft.trim()}
                            onClick={apply}
                          >
                            Add fallback
                          </button>
                        </span>
                      )}
                    </span>
                    <button
                      type="button"
                      className="sle-btn t"
                      onClick={() => {
                        setOpen(false);
                        onJump(item.target);
                      }}
                    >
                      {item.fixLabel}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
