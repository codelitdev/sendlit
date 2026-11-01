import type { BlockComponent } from "@/types/block-registry";
import { SocialBlock as block } from "./block";
import { metadata } from "./metadata";
import { SocialSettings as settings } from "./settings";
import { SocialQuickEdit as quickEdit } from "./quick-edit";
import type { SocialBlockSettings } from "./types";

export const SocialBlock: BlockComponent<SocialBlockSettings> = {
  block,
  settings,
  metadata,
  quickEdit,
  quickEditLayout: "column",
  defaultSettings: () => ({
    alignment: "center",
    links: [{ network: "website", url: "" }],
  }),
};
