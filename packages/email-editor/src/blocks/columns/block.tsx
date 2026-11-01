import { Column, Row, Section } from "@react-email/components";
import { MarkdownContent } from "@/lib/markdown-content";
import type { EmailBlock, EmailStyle } from "@/types/email-editor";
import type { ColumnsBlockSettings, ColumnsRatio } from "./types";

const WIDTHS: Record<ColumnsRatio, [string, string]> = {
  "11": ["50%", "50%"],
  "12": ["33%", "67%"],
  "21": ["67%", "33%"],
};

const STACK_CSS =
  "@media only screen and (max-width:480px){.sl-col{display:block!important;width:100%!important;padding-left:0!important;padding-right:0!important}}";

export function ColumnsBlock({
  block,
  style,
}: {
  block: EmailBlock & { settings: ColumnsBlockSettings };
  style?: EmailStyle;
}) {
  const {
    left = "",
    right = "",
    ratio = "11",
    stack = true,
    alignment = "left",
    backgroundColor = "transparent",
    foregroundColor = style?.colors.foreground,
    paddingTop = style?.structure.section.padding?.y,
    paddingBottom = style?.structure.section.padding?.y,
  } = block.settings as ColumnsBlockSettings & { foregroundColor?: string };
  const [leftWidth, rightWidth] = WIDTHS[ratio] ?? WIDTHS["11"];
  const gap = "12px";

  return (
    <Section>
      {stack && <style>{STACK_CSS}</style>}
      <div
        style={{
          backgroundColor,
          color: foregroundColor,
          padding: `${paddingTop} ${style?.structure.section.padding?.x} ${paddingBottom} ${style?.structure.section.padding?.x}`,
        }}
      >
        <Row>
          <Column
            className="sl-col"
            style={{ width: leftWidth, verticalAlign: "top", paddingRight: gap }}
          >
            <MarkdownContent content={left} style={style} options={{ alignment }} />
          </Column>
          <Column
            className="sl-col"
            style={{ width: rightWidth, verticalAlign: "top", paddingLeft: gap }}
          >
            <MarkdownContent content={right} style={style} options={{ alignment }} />
          </Column>
        </Row>
      </div>
    </Section>
  );
}
