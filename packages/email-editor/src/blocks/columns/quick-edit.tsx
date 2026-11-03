import type { BlockSettingsProps } from "@/types/email-editor";
import type { ColumnsBlockSettings } from "./types";

export function ColumnsQuickEdit({
  block,
  updateBlock,
}: BlockSettingsProps<ColumnsBlockSettings>) {
  const set = (key: "left" | "right", value: string) =>
    updateBlock(block.id, { settings: { ...block.settings, [key]: value } });

  return (
    <div className="row">
      {(["left", "right"] as const).map((side) => (
        <textarea
          key={side}
          className="sle-in"
          aria-label={side === "left" ? "Left column" : "Right column"}
          value={block.settings[side] ?? ""}
          onChange={(event) => set(side, event.target.value)}
        />
      ))}
    </div>
  );
}
