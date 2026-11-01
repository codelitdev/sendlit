import { SettingsTextarea } from "@/components/settings/settings-textarea";
import type { BlockSettingsProps } from "@/types/email-editor";
import type { HtmlBlockSettings } from "./types";

export function HtmlSettings({
  block,
  updateBlock,
}: BlockSettingsProps<HtmlBlockSettings>) {
  return (
    <div className="space-y-4">
      <SettingsTextarea
        label="HTML"
        value={block.settings.code}
        onChange={(value) =>
          updateBlock(block.id, { settings: { ...block.settings, code: value } })
        }
        rows={12}
        style={{ fontFamily: "ui-monospace, Menlo, monospace", fontSize: "12px" }}
      />
      <p className="text-xs text-muted-foreground">
        Sent exactly as written. Most email clients ignore scripts and external CSS, so
        stick to inline styles and tables.
      </p>
    </div>
  );
}
