import type { BlockComponent } from "@/types/block-registry";
import { ColumnsBlock as block } from "./block";
import { metadata } from "./metadata";
import { ColumnsQuickEdit as quickEdit } from "./quick-edit";
import { ColumnsSettings as settings } from "./settings";
import type { ColumnsBlockSettings } from "./types";

export const ColumnsBlock: BlockComponent<ColumnsBlockSettings> = {
  block,
  settings,
  metadata,
  quickEdit,
  quickEditLayout: "column",
  defaultSettings: () => ({
    left: "**Left column**\n\nA short note.",
    right: "**Right column**\n\nAnother note.",
    ratio: "11",
    stack: true,
  }),
};
