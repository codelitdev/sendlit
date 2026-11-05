import type { BlockComponent } from "@/types/block-registry";
import { SpacerBlock as block } from "./block";
import { metadata } from "./metadata";
import { SpacerQuickEdit as quickEdit } from "./quick-edit";
import { SpacerSettings as settings } from "./settings";
import type { SpacerBlockSettings } from "./types";

export const SpacerBlock: BlockComponent<SpacerBlockSettings> = {
  block,
  settings,
  metadata,
  quickEdit,
  defaultSettings: () => ({ height: "20px" }),
};
