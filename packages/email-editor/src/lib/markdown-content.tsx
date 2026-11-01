import { Markdown } from "@react-email/components";
import type { EmailStyle } from "@/types/email-editor";

export interface MarkdownContentOptions {
  fontFamily?: string;
  fontSize?: string;
  lineHeight?: string;
  letterSpacing?: string;
  textTransform?: "uppercase" | "lowercase" | "capitalize" | "none";
  textDecoration?: "underline" | "none" | "line-through";
  alignment?: "left" | "center" | "right" | "justify";
}

/**
 * Renders email markdown with the email's typography. Shared by every block
 * that holds markdown (text, columns, conditional section) so they all look
 * the same in the editor, the preview and the sent email.
 */
export function MarkdownContent({
  content,
  style,
  options = {},
}: {
  content: string;
  style?: EmailStyle;
  options?: MarkdownContentOptions;
}) {
  const commonTextStyles = {
    fontFamily:
      options.fontFamily || style?.typography.text.fontFamily || "Arial, sans-serif",
    fontSize: options.fontSize || style?.typography.text.fontSize || "16px",
    lineHeight: options.lineHeight || style?.typography.text.lineHeight || "1.5",
    letterSpacing:
      options.letterSpacing || style?.typography.text.letterSpacing || "normal",
    textTransform:
      options.textTransform || style?.typography.text.textTransform || "none",
    textDecoration:
      options.textDecoration || style?.typography.text.textDecoration || "none",
  };

  const headerFontFamily =
    options.fontFamily || style?.typography.header.fontFamily || "Arial, sans-serif";
  const baseSize = Number.parseInt(options.fontSize || "16", 10);
  const heading = (multiplier: number, minimum: number) => ({
    fontWeight: "bold",
    fontSize: `${Math.max(baseSize * multiplier, minimum)}px`,
    fontFamily: headerFontFamily,
    margin: "16px 0 8px",
  });

  return (
    <Markdown
      markdownCustomStyles={{
        h1: heading(2, 32),
        h2: heading(1.5, 24),
        h3: heading(1.25, 20),
        h4: heading(1.125, 18),
        h5: heading(1.0625, 16),
        h6: heading(1.03125, 14),
        p: { ...commonTextStyles, margin: "0 0 16px" },
        ul: {
          ...commonTextStyles,
          margin: "0 0 16px",
          paddingLeft: "24px",
          listStyleType: "disc",
        },
        ol: {
          ...commonTextStyles,
          margin: "0 0 16px",
          paddingLeft: "24px",
          listStyleType: "decimal",
        },
        li: { ...commonTextStyles, margin: "4px 0" },
        link: {
          ...commonTextStyles,
          color: style?.colors.accent || "inherit",
        },
      }}
      markdownContainerStyles={{
        fontFamily: options.fontFamily || "Arial, sans-serif",
        textAlign: options.alignment || "left",
        fontSize: options.fontSize || "16px",
        lineHeight: options.lineHeight || "1.5",
      }}
    >
      {content}
    </Markdown>
  );
}
