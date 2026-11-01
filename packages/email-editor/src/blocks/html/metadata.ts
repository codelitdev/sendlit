import { Code } from "lucide-react";
import type { BlockMetadata } from "@/types/block-registry";

export const metadata: BlockMetadata = {
  name: "html",
  displayName: "HTML",
  description: "Paste your own code",
  icon: Code,
  docs: {
    settings: {
      code: "Raw HTML sent as-is inside the email. Use inline styles and table layouts, since most email clients ignore scripts and external CSS.",
    },
  },
};
