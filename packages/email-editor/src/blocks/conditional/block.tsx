import { Section } from "@react-email/components";
import { MarkdownContent } from "@/lib/markdown-content";
import type { EmailBlock, EmailStyle } from "@/types/email-editor";
import { type ConditionalBlockSettings, isValidConditionTag } from "./types";

export function liquidCondition({ tag, has = true }: ConditionalBlockSettings) {
  const keyword = has ? "if" : "unless";
  return `{% ${keyword} subscriber.tags contains "${tag}" %}`;
}

export function ConditionalBlock({
  block,
  style,
  showConditionals,
}: {
  block: EmailBlock & { settings: ConditionalBlockSettings };
  style?: EmailStyle;
  showConditionals?: boolean;
}) {
  const settings = block.settings;
  const {
    content = "",
    backgroundColor = "transparent",
    paddingTop = style?.structure.section.padding?.y,
    paddingBottom = style?.structure.section.padding?.y,
  } = settings;

  const body = (
    <div
      style={{
        backgroundColor,
        color: style?.colors.foreground,
        padding: `${paddingTop} ${style?.structure.section.padding?.x} ${paddingBottom} ${style?.structure.section.padding?.x}`,
      }}
    >
      <MarkdownContent content={content} style={style} />
    </div>
  );

  if (showConditionals) {
    return (
      <Section>
        <div
          style={{
            margin: "0 8px",
            border: "1.5px dashed #a3a3a3",
            borderRadius: "8px",
          }}
        >
          <div
            style={{
              padding: "6px 14px 0",
              fontSize: "12px",
              fontWeight: 600,
              color: "#737373",
            }}
          >
            {settings.has === false ? "Contacts without" : "Contacts tagged"}{" "}
            {settings.tag ? `"${settings.tag}"` : "…"}
          </div>
          {body}
        </div>
      </Section>
    );
  }

  // Never send a section whose condition can't be trusted: with a bad tag the
  // content is dropped instead of reaching everyone.
  if (!isValidConditionTag(settings.tag)) return null;

  return (
    <>
      {liquidCondition(settings)}
      <Section>{body}</Section>
      {"{% end" + (settings.has === false ? "unless" : "if") + " %}"}
    </>
  );
}
