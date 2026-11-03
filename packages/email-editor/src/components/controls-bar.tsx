import { Monitor, Redo2, Smartphone, Undo2 } from "lucide-react";

export function ControlsBar({
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  device,
  onDevice,
  sample,
  onSample,
  dark,
  onDark,
  words,
}: {
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  device: "desktop" | "mobile";
  onDevice: (device: "desktop" | "mobile") => void;
  sample: boolean;
  onSample: (on: boolean) => void;
  dark: boolean;
  onDark: (on: boolean) => void;
  words: number;
}) {
  return (
    <div
      className="sle-ctl"
      role="toolbar"
      aria-label="Editor controls"
      onClick={(event) => event.stopPropagation()}
    >
      <button
        type="button"
        className="sle-ib"
        aria-label="Undo"
        disabled={!canUndo}
        onClick={onUndo}
      >
        <Undo2 className="size-4" />
      </button>
      <button
        type="button"
        className="sle-ib"
        aria-label="Redo"
        disabled={!canRedo}
        onClick={onRedo}
      >
        <Redo2 className="size-4" />
      </button>
      <span className="sle-sep" />
      <fieldset className="sle-seg" aria-label="Preview width">
        <button
          type="button"
          className={device === "desktop" ? "on" : undefined}
          aria-label="Desktop"
          aria-pressed={device === "desktop"}
          onClick={() => onDevice("desktop")}
        >
          <Monitor className="size-3.5" />
        </button>
        <button
          type="button"
          className={device === "mobile" ? "on" : undefined}
          aria-label="Mobile"
          aria-pressed={device === "mobile"}
          onClick={() => onDevice("mobile")}
        >
          <Smartphone className="size-3.5" />
        </button>
      </fieldset>
      <label className={`sle-sw${sample ? " on" : ""}`}>
        <input
          type="checkbox"
          checked={sample}
          onChange={(event) => onSample(event.target.checked)}
        />
        <span className="tr" />
        Sample data
      </label>
      <label className={`sle-sw${dark ? " on" : ""}`}>
        <input
          type="checkbox"
          checked={dark}
          onChange={(event) => onDark(event.target.checked)}
        />
        <span className="tr" />
        Dark inbox
      </label>
      <span className="sle-sep" />
      <span className="wc">
        {words} {words === 1 ? "word" : "words"}
      </span>
    </div>
  );
}
