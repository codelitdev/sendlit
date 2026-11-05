import { SettingsColorPicker } from "@/components/settings/settings-color-picker";
import { SettingsSlider } from "@/components/settings/settings-slider";
import type { BlockSettingsProps } from "@/types/email-editor";
import type { SpacerBlockSettings } from "./types";

export function SpacerSettings({
  block,
  updateBlock,
}: BlockSettingsProps<SpacerBlockSettings>) {
  const height = Number.parseInt(block.settings.height || "20", 10) || 20;

  return (
    <div className="space-y-4">
      <SettingsSlider
        label="Height"
        value={height}
        onChange={(value) =>
          updateBlock(block.id, {
            settings: { ...block.settings, height: `${value}px` },
          })
        }
        min={4}
        max={200}
        defaultValue={20}
      />
      <SettingsColorPicker
        label="Background Color"
        value={block.settings.backgroundColor || "transparent"}
        onChange={(value) =>
          updateBlock(block.id, {
            settings: { ...block.settings, backgroundColor: value },
          })
        }
        defaultValue="transparent"
      />
    </div>
  );
}
