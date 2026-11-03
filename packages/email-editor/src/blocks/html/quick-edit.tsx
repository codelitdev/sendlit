import type { BlockSettingsProps } from "@/types/email-editor";
import type { HtmlBlockSettings } from "./types";

export function HtmlQuickEdit({
  block,
  updateBlock,
}: BlockSettingsProps<HtmlBlockSettings>) {
  return (
    <textarea
      className="sle-in"
      aria-label="HTML"
      spellCheck={false}
      value={block.settings.code ?? ""}
      onChange={(event) =>
        updateBlock(block.id, {
          settings: { ...block.settings, code: event.target.value },
        })
      }
    />
  );
}
