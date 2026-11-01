import { SettingsColorPicker } from "@/components/settings/settings-color-picker";
import { SettingsInput } from "@/components/settings/settings-input";
import { SettingsSelect } from "@/components/settings/settings-select";
import { SettingsTextarea } from "@/components/settings/settings-textarea";
import type { BlockSettingsProps } from "@/types/email-editor";
import { type ConditionalBlockSettings, isValidConditionTag } from "./types";

export function ConditionalSettings({
  block,
  updateBlock,
}: BlockSettingsProps<ConditionalBlockSettings>) {
  const set = (key: string, value: unknown) =>
    updateBlock(block.id, { settings: { ...block.settings, [key]: value } });

  return (
    <div className="space-y-4">
      <SettingsSelect
        label="Show this section to"
        value={block.settings.has === false ? "without" : "with"}
        onChange={(value) => set("has", value === "with")}
        options={[
          { value: "with", label: "Contacts with the tag" },
          { value: "without", label: "Contacts without the tag" },
        ]}
      />
      <SettingsInput
        label="Tag"
        value={block.settings.tag}
        placeholder="customer"
        onChange={(value) => set("tag", value)}
      />
      {block.settings.tag && !isValidConditionTag(block.settings.tag) && (
        <p className="text-xs text-destructive">
          Use letters, numbers, spaces, dots, dashes or underscores (40 at most). Until
          then this section is left out of the email.
        </p>
      )}
      <SettingsTextarea
        label="Content"
        value={block.settings.content}
        onChange={(value) => set("content", value)}
        rows={6}
      />
      <SettingsColorPicker
        label="Background Color"
        value={block.settings.backgroundColor || "transparent"}
        onChange={(value) => set("backgroundColor", value)}
        defaultValue="transparent"
      />
    </div>
  );
}
