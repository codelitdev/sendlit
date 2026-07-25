import { describe, expect, it } from "vitest";
import {
    defaultEmail,
    renderEmailToHtml,
    type Email,
} from "@sendlit/email-editor";
import { createFooterBlock, createFooterEmailBlock } from ".";

const footer = createFooterBlock({
    labels: {
        displayName: "Footer",
        description: "Managed email footer",
        unsubscribe: "Unsubscribe",
        alignment: "Alignment",
        alignmentLeft: "Left",
        alignmentCenter: "Center",
        alignmentRight: "Right",
        foregroundColor: "Text color",
        backgroundColor: "Background color",
        fontSize: "Font size",
        paddingTop: "Top padding",
        paddingBottom: "Bottom padding",
        paddingX: "Horizontal padding",
    },
});

function emailWithFooter(): Email {
    return {
        ...defaultEmail,
        content: [
            { blockType: "text", settings: { content: "Hello" } },
            createFooterEmailBlock(),
        ],
    };
}

describe("SendLit footer block", () => {
    it("renders server-owned address and unsubscribe values", async () => {
        const email = emailWithFooter();
        const html = await renderEmailToHtml({
            email,
            blocks: [footer],
            renderContext: {
                footer: {
                    mailingAddress: "123 Main Street",
                    unsubscribeUrl: "https://example.com/unsubscribe/token",
                },
            },
        });

        expect(html).toContain("123 Main Street");
        expect(html).toContain("https://example.com/unsubscribe/token");
        expect(html).toContain("Unsubscribe");
        expect(JSON.stringify(email)).not.toContain("123 Main Street");
        expect(JSON.stringify(email)).not.toContain("unsubscribe/token");
    });

    it("fails rendering when the managed context is absent", async () => {
        const html = await renderEmailToHtml({
            email: emailWithFooter(),
            blocks: [footer],
        });

        expect(html).toContain("footer_render_context_required");
    });

    it("is a locked final-placement add-on", () => {
        expect(footer.capabilities).toEqual({
            insertable: false,
            deletable: false,
            duplicable: false,
            movable: false,
            placement: "last",
        });
        expect(createFooterEmailBlock()).toEqual({
            blockType: "footer",
            settings: expect.objectContaining({
                alignment: "center",
                fontSize: "12px",
            }),
        });
    });
});
