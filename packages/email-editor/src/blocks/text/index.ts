import { TextBlock as block } from "./block";
import { TextSettings as settings } from "./settings";
import { metadata } from "./metadata";
import type { BlockComponent } from "@/types/block-registry";
import type { TextBlockSettings } from "./types";

export const TextBlock: BlockComponent<TextBlockSettings> = {
    block,
    settings,
    metadata,
    defaultSettings: () => ({
        content: "New text block",
    }),
};
