import type { BlockComponent } from "@/types/block-registry";
import { ConditionalBlock as block } from "./block";
import { metadata } from "./metadata";
import { ConditionalQuickEdit as quickEdit } from "./quick-edit";
import { ConditionalSettings as settings } from "./settings";
import type { ConditionalBlockSettings } from "./types";

export { isValidConditionTag } from "./types";

export const ConditionalBlock: BlockComponent<ConditionalBlockSettings> = {
  block,
  settings,
  metadata,
  quickEdit,
  quickEditLayout: "column",
  defaultSettings: () => ({
    tag: "customer",
    has: true,
    content: "Thanks for being a customer. Here is **20% off** your next order.",
  }),
};
