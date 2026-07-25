import { SeparatorBlock as block } from "./block";
import { SeparatorSettings as settings } from "./settings";
import { metadata } from "./metadata";
import type { BlockComponent } from "@/types/block-registry";
import type { SeparatorBlockSettings } from "./types";

export const SeparatorBlock: BlockComponent<SeparatorBlockSettings> = {
    block,
    settings,
    metadata,
    defaultSettings: () => ({
        color: "#e2e8f0",
        thickness: "1px",
        style: "solid",
    }),
};
