import { SquareDashed } from "lucide-react";
import type { BlockMetadata } from "@/types/block-registry";

export const metadata: BlockMetadata = {
  name: "conditional",
  displayName: "Section",
  description: "Content only some contacts see, based on a tag",
  icon: SquareDashed,
  docs: {
    settings: {
      tag: "The contact tag to check. Letters, numbers, spaces, dots, dashes and underscores, up to 40 characters.",
      has: "[Optional] true shows the section to contacts with the tag, false to contacts without it. Default: true",
      content: "The markdown content of the section.",
      backgroundColor:
        "[Optional] The background color of the block. Format: #000000. Default: transparent",
    },
  },
};
