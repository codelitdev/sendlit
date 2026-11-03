import { SettingsColorPicker } from "@/components/settings/settings-color-picker";
import { SettingsSection } from "@/components/settings/settings-section";
import { SettingsSelect } from "@/components/settings/settings-select";
import { SettingsSlider } from "@/components/settings/settings-slider";
import { SettingsSwitch } from "@/components/settings/settings-switch";
import { SettingsTextarea } from "@/components/settings/settings-textarea";
import type { BlockSettingsProps } from "@/types/email-editor";
import type { ColumnsBlockSettings } from "./types";

export function ColumnsSettings({
  block,
  style,
  updateBlock,
}: BlockSettingsProps<ColumnsBlockSettings>) {
  const set = (key: string, value: unknown) =>
    updateBlock(block.id, { settings: { ...block.settings, [key]: value } });
  const px = (value: string | undefined, fallback: number) =>
    Number.parseInt(value || "", 10) || fallback;

  return (
    <div className="space-y-4">
      <SettingsTextarea
        label="Left column"
        value={block.settings.left}
        onChange={(value) => set("left", value)}
        rows={5}
      />
      <SettingsTextarea
        label="Right column"
        value={block.settings.right}
        onChange={(value) => set("right", value)}
        rows={5}
      />
      <SettingsSelect
        label="Widths"
        value={block.settings.ratio || "11"}
        onChange={(value) => set("ratio", value)}
        options={[
          { value: "11", label: "Equal" },
          { value: "12", label: "Narrow, wide" },
          { value: "21", label: "Wide, narrow" },
        ]}
        defaultValue="11"
      />
      <SettingsSwitch
        label="Stack on small screens"
        checked={block.settings.stack ?? true}
        onCheckedChange={(value) => set("stack", value)}
      />
      <SettingsSection title="Block Settings">
        <SettingsColorPicker
          label="Background Color"
          value={block.settings.backgroundColor || "transparent"}
          onChange={(value) => set("backgroundColor", value)}
          defaultValue="transparent"
        />
        <SettingsSlider
          label="Padding Top"
          value={px(
            block.settings.paddingTop || style?.structure.section.padding?.y,
            16,
          )}
          onChange={(value) => set("paddingTop", `${value}px`)}
          min={0}
          max={100}
          defaultValue={px(style?.structure.section.padding?.y, 16)}
        />
        <SettingsSlider
          label="Padding Bottom"
          value={px(
            block.settings.paddingBottom || style?.structure.section.padding?.y,
            16,
          )}
          onChange={(value) => set("paddingBottom", `${value}px`)}
          min={0}
          max={100}
          defaultValue={px(style?.structure.section.padding?.y, 16)}
        />
      </SettingsSection>
    </div>
  );
}
