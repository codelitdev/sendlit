import type { CommonBlockSettings } from "@/types/email-editor";

export const SOCIAL_NETWORKS = [
  { value: "website", label: "Website" },
  { value: "instagram", label: "Instagram" },
  { value: "linkedin", label: "LinkedIn" },
  { value: "youtube", label: "YouTube" },
  { value: "x", label: "X" },
  { value: "facebook", label: "Facebook" },
  { value: "tiktok", label: "TikTok" },
] as const;

export interface SocialLink {
  network: (typeof SOCIAL_NETWORKS)[number]["value"];
  url: string;
}

export interface SocialBlockSettings extends CommonBlockSettings {
  links: SocialLink[];
  alignment?: "left" | "center" | "right";
}
