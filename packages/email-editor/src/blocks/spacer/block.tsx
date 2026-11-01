import { Section } from "@react-email/components";
import type { EmailBlock } from "@/types/email-editor";
import type { SpacerBlockSettings } from "./types";

export function SpacerBlock({
  block,
}: {
  block: EmailBlock & { settings: SpacerBlockSettings };
}) {
  const { height = "20px", backgroundColor = "transparent" } = block.settings;

  return (
    <Section>
      <div
        style={{
          height,
          lineHeight: height,
          fontSize: "1px",
          backgroundColor,
        }}
      >
        &nbsp;
      </div>
    </Section>
  );
}
