import { Share2 } from "lucide-react";
import type { BlockMetadata } from "@/types/block-registry";

export const metadata: BlockMetadata = {
  name: "social",
  displayName: "Social links",
  description: "Your profiles, as buttons",
  icon: Share2,
  docs: {
    settings: {
      links:
        "The profiles to link to, as a list of { network, url }. Network range: website, instagram, linkedin, youtube, x, facebook, tiktok. url must start with https:// or http://",
      alignment:
        "[Optional] The alignment of the links. Range: left, center, right. Default: center",
      backgroundColor:
        "[Optional] The background color of the block. Format: #000000. Default: transparent",
    },
  },
};
