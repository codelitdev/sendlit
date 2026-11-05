import { MoveVertical } from "lucide-react";
import type { BlockMetadata } from "@/types/block-registry";

export const metadata: BlockMetadata = {
  name: "spacer",
  displayName: "Spacer",
  description: "Extra breathing room between sections",
  icon: MoveVertical,
  docs: {
    settings: {
      height: "The empty space to add. Format: 20px. Range: 4-200. Default: 20px",
      backgroundColor:
        "[Optional] The background color of the spacer. Format: #000000. Default: transparent",
    },
  },
};
