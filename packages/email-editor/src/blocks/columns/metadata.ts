import { Columns2 } from "lucide-react";
import type { BlockMetadata } from "@/types/block-registry";

export const metadata: BlockMetadata = {
  name: "columns",
  displayName: "Columns",
  description: "Two text columns side by side",
  icon: Columns2,
  docs: {
    settings: {
      left: "The markdown content of the left column.",
      right: "The markdown content of the right column.",
      ratio:
        "[Optional] The column widths, left to right. Range: 11 (equal), 12 (narrow then wide), 21 (wide then narrow). Default: 11",
      stack:
        "[Optional] Stack the columns on narrow screens. Range: true, false. Default: true",
      backgroundColor:
        "[Optional] The background color of the block. Format: #000000. Default: transparent",
      paddingTop: "[Optional] The top padding. Format: 0px. Range: 0-100",
      paddingBottom: "[Optional] The bottom padding. Format: 0px. Range: 0-100",
    },
  },
};
