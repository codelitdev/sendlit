import { Section } from "@react-email/components";
import type { EmailBlock } from "@/types/email-editor";
import type { HtmlBlockSettings } from "./types";

export function HtmlBlock({
  block,
  selectedBlockId,
}: {
  block: EmailBlock & { settings: HtmlBlockSettings };
  selectedBlockId?: string | null;
}) {
  const { code = "" } = block.settings;

  // The editor never runs a teammate's markup inside the dashboard; it shows
  // the code instead. Sent emails and the hosted web version carry the HTML.
  if (selectedBlockId !== undefined) {
    return (
      <Section>
        <pre
          style={{
            margin: 0,
            padding: "10px 12px",
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            maxHeight: "140px",
            overflow: "hidden",
            fontFamily: "ui-monospace, Menlo, monospace",
            fontSize: "12px",
            border: "1px dashed #a3a3a3",
            borderRadius: "6px",
            background: "#f5f5f5",
            color: "#404040",
          }}
        >
          {code || "<!-- Your HTML here -->"}
        </pre>
      </Section>
    );
  }

  return (
    <Section>
      <div
        style={{ backgroundColor: block.settings.backgroundColor }}
        // biome-ignore lint/security/noDangerouslySetInnerHtml: this block exists to send the team's own HTML; the editor shows the code instead of running it
        dangerouslySetInnerHTML={{ __html: code }}
      />
    </Section>
  );
}
