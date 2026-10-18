import type { BlockComponent } from "@/types/block-registry";
import { TextBlock as block } from "./block";
import { metadata } from "./metadata";
import { TextSettings as settings } from "./settings";
import type { TextBlockSettings } from "./types";

export const TextBlock: BlockComponent<TextBlockSettings> = {
  block,
  settings,
  metadata,
  defaultSettings: () => ({
    content: "New text block",
  }),
};
