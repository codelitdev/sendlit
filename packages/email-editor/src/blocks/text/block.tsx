import { Section } from "@react-email/components";
import { MarkdownContent } from "@/lib/markdown-content";
import type { EmailBlock, EmailStyle } from "@/types/email-editor";
import type { TextBlockSettings } from "./types";

interface TextBlockProps {
  block: EmailBlock & { settings: TextBlockSettings };
  style?: EmailStyle;
  selectedBlockId?: string | null;
}

export function TextBlock({ block, style, selectedBlockId }: TextBlockProps) {
  const isSelected = selectedBlockId === block.id;

  // Get common block settings
  const {
    backgroundColor = "transparent",
    foregroundColor = style?.colors.foreground || "#000000",
    paddingTop = style?.structure.section.padding?.y,
    paddingBottom = style?.structure.section.padding?.y,
  } = block.settings;

  // Ensure there's always some content to make the block selectable
  const content = block.settings.content || (isSelected ? "" : "Text content");

  return (
    <Section>
      <div
        style={{
          backgroundColor,
          color: foregroundColor,
          padding: `${paddingTop} ${style?.structure.section.padding?.x} ${paddingBottom} ${style?.structure.section.padding?.x}`,
        }}
      >
        <MarkdownContent
          content={content}
          style={style}
          options={{
            fontSize: block.settings.fontSize,
            lineHeight: block.settings.lineHeight,
            letterSpacing: block.settings.letterSpacing,
            textTransform: block.settings.textTransform,
            textDecoration: block.settings.textDecoration,
            alignment: block.settings.alignment,
          }}
        />
      </div>
    </Section>
  );
}
