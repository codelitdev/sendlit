import type { BlockComponent } from "@/types/block-registry";
import { HtmlBlock as block } from "./block";
import { metadata } from "./metadata";
import { HtmlQuickEdit as quickEdit } from "./quick-edit";
import { HtmlSettings as settings } from "./settings";
import type { HtmlBlockSettings } from "./types";

export const HtmlBlock: BlockComponent<HtmlBlockSettings> = {
  block,
  settings,
  metadata,
  quickEdit,
  quickEditLayout: "column",
  defaultSettings: () => ({
    code: '<p style="text-align:center">Your HTML here</p>',
  }),
};
