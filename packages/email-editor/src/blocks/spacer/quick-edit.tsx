import type { BlockSettingsProps } from "@/types/email-editor";
import type { SpacerBlockSettings } from "./types";

const SIZES = [
  ["Small", "8px"],
  ["Medium", "20px"],
  ["Large", "40px"],
] as const;

export function SpacerQuickEdit({
  block,
  updateBlock,
}: BlockSettingsProps<SpacerBlockSettings>) {
  const height = block.settings.height ?? "20px";

  return (
    <fieldset className="sle-seg" aria-label="Spacer height">
      {SIZES.map(([label, value]) => (
        <button
          key={value}
          type="button"
          className={height === value ? "on" : undefined}
          aria-pressed={height === value}
          onClick={() =>
            updateBlock(block.id, {
              settings: { ...block.settings, height: value },
            })
          }
        >
          {label}
        </button>
      ))}
    </fieldset>
  );
}
