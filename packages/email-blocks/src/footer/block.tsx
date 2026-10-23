import type { BlockRenderProps } from "@sendlit/email-editor";
import { Fragment } from "react";
import type { FooterSettings, SendLitEmailRenderContext } from "./types";

export function FooterBlock({
  block,
  renderContext,
  unsubscribeLabel,
  viewInBrowserLabel,
}: BlockRenderProps<FooterSettings, SendLitEmailRenderContext> & {
  unsubscribeLabel: string;
  viewInBrowserLabel?: string;
}) {
  const footer = renderContext?.footer;
  if (!footer?.mailingAddress || !footer.unsubscribeUrl) {
    throw new Error("footer_render_context_required");
  }

  const {
    alignment = "center",
    fontFamily = "Arial, sans-serif",
    fontSize = "12px",
    foregroundColor = "#64748b",
    backgroundColor = "transparent",
    paddingTop = "16px",
    paddingBottom = "16px",
    paddingX = "24px",
  } = block.settings;

  const linkStyle = { color: foregroundColor, textDecoration: "underline" };

  // HTML email renderers collapse raw newlines in text nodes. Emit <br>
  // so multi-line physical addresses stay multi-line in the delivered mail.
  const addressLines = footer.mailingAddress.split(/\r?\n/);

  return (
    <div
      style={{
        boxSizing: "border-box",
        width: "100%",
        textAlign: alignment,
        fontFamily,
        fontSize,
        color: foregroundColor,
        backgroundColor,
        padding: `${paddingTop} ${paddingX} ${paddingBottom}`,
      }}
    >
      <div>
        {addressLines.map((line, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: address lines are static rendered text derived from a string, never reordered
          <Fragment key={index}>
            {index > 0 ? <br /> : null}
            {line}
          </Fragment>
        ))}
      </div>
      <div style={{ marginTop: "8px" }}>
        {footer.viewInBrowserUrl && viewInBrowserLabel ? (
          <>
            <a href={footer.viewInBrowserUrl} style={linkStyle}>
              {viewInBrowserLabel}
            </a>
            {" · "}
          </>
        ) : null}
        <a href={footer.unsubscribeUrl} style={linkStyle}>
          {unsubscribeLabel}
        </a>
      </div>
      {footer.brandingText ? (
        <div style={{ marginTop: "8px" }}>{footer.brandingText}</div>
      ) : null}
    </div>
  );
}
