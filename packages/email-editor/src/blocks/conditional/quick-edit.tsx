import type { BlockSettingsProps } from "@/types/email-editor";
import type { ConditionalBlockSettings } from "./types";

export function ConditionalQuickEdit({
  block,
  updateBlock,
}: BlockSettingsProps<ConditionalBlockSettings>) {
  const set = (key: string, value: unknown) =>
    updateBlock(block.id, { settings: { ...block.settings, [key]: value } });
  const has = block.settings.has !== false;

  return (
    <>
      <div className="row">
        <fieldset className="sle-seg" aria-label="Who sees it">
          <button
            type="button"
            className={has ? "on" : undefined}
            aria-pressed={has}
            onClick={() => set("has", true)}
          >
            Tagged
          </button>
          <button
            type="button"
            className={has ? undefined : "on"}
            aria-pressed={!has}
            onClick={() => set("has", false)}
          >
            Not tagged
          </button>
        </fieldset>
        <input
          className="sle-in"
          aria-label="Tag"
          placeholder="Tag"
          value={block.settings.tag ?? ""}
          onChange={(event) => set("tag", event.target.value)}
        />
      </div>
      <textarea
        className="sle-in"
        aria-label="Section text"
        placeholder="What these contacts see"
        value={block.settings.content ?? ""}
        onChange={(event) => set("content", event.target.value)}
      />
    </>
  );
}
