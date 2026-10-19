import type { BlockComponent } from "@/types/block-registry";
import { LinkBlock as block } from "./block";
import { metadata } from "./metadata";
import { LinkSettings as settings } from "./settings";
import type { LinkBlockSettings } from "./types";

export const LinkBlock: BlockComponent<LinkBlockSettings> = {
  block,
  settings,
  metadata,
  defaultSettings: () => ({
    text: "Link Text",
    url: "#",
    alignment: "left",
    textColor: "#0284c7",
    fontSize: "16px",
    textDecoration: "underline",
    isButton: false,
  }),
};
