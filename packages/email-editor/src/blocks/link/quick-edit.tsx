import type { BlockSettingsProps } from "@/types/email-editor";
import type { LinkBlockSettings } from "./types";

export function LinkQuickEdit({
  block,
  updateBlock,
}: BlockSettingsProps<LinkBlockSettings>) {
  const set = (key: string, value: string) =>
    updateBlock(block.id, { settings: { ...block.settings, [key]: value } });
  const label = block.settings.isButton ? "Button" : "Link";

  return (
    <>
      <input
        className="sle-in"
        aria-label={`${label} text`}
        placeholder="Label"
        value={block.settings.text ?? ""}
        onChange={(event) => set("text", event.target.value)}
      />
      <input
        className="sle-in mono u"
        aria-label={`${label} link`}
        placeholder="https://"
        value={block.settings.url ?? ""}
        onChange={(event) => set("url", event.target.value)}
      />
    </>
  );
}
