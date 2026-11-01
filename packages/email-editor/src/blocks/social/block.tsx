import { Link, Section } from "@react-email/components";
import type { EmailBlock, EmailStyle } from "@/types/email-editor";
import { SOCIAL_NETWORKS, type SocialBlockSettings } from "./types";

function isWebUrl(url: string) {
  return /^https?:\/\//i.test(url.trim());
}

export function SocialBlock({
  block,
  style,
  selectedBlockId,
}: {
  block: EmailBlock & { settings: SocialBlockSettings };
  style?: EmailStyle;
  selectedBlockId?: string | null;
}) {
  const {
    links = [],
    alignment = "center",
    backgroundColor = "transparent",
    paddingTop = style?.structure.section.padding?.y,
    paddingBottom = style?.structure.section.padding?.y,
  } = block.settings;
  const shown = links.filter((link) => isWebUrl(link.url));
  const inEditor = selectedBlockId !== undefined;

  // An empty block sends nothing; the editor keeps a hint so it stays findable.
  if (shown.length === 0 && !inEditor) return null;

  return (
    <Section>
      <div
        style={{
          backgroundColor,
          textAlign: alignment,
          padding: `${paddingTop} ${style?.structure.section.padding?.x} ${paddingBottom} ${style?.structure.section.padding?.x}`,
        }}
      >
        {shown.length === 0 ? (
          <span style={{ opacity: 0.5, fontSize: "14px" }}>
            Add your social links in the block settings
          </span>
        ) : (
          shown.map((link) => (
            <Link
              key={`${link.network}-${link.url}`}
              href={link.url.trim()}
              style={{
                display: "inline-block",
                margin: "0 4px 8px",
                padding: "6px 14px",
                border: `1px solid ${style?.colors.accent || "#0284c7"}`,
                borderRadius: "999px",
                color: style?.colors.accent || "#0284c7",
                fontFamily: style?.typography.link.fontFamily || "Arial, sans-serif",
                fontSize: "13px",
                fontWeight: 600,
                textDecoration: "none",
              }}
            >
              {SOCIAL_NETWORKS.find((n) => n.value === link.network)?.label ??
                link.network}
            </Link>
          ))
        )}
      </div>
    </Section>
  );
}
