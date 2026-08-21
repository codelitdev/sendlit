import { Fragment } from "react";
import type { BlockRenderProps } from "@sendlit/email-editor";
import type { FooterSettings, SendLitEmailRenderContext } from "./types";

export function FooterBlock({
    block,
    renderContext,
    unsubscribeLabel,
}: BlockRenderProps<FooterSettings, SendLitEmailRenderContext> & {
    unsubscribeLabel: string;
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
                    <Fragment key={index}>
                        {index > 0 ? <br /> : null}
                        {line}
                    </Fragment>
                ))}
            </div>
            <div style={{ marginTop: "8px" }}>
                <a
                    href={footer.unsubscribeUrl}
                    style={{
                        color: foregroundColor,
                        textDecoration: "underline",
                    }}
                >
                    {unsubscribeLabel}
                </a>
            </div>
        </div>
    );
}
