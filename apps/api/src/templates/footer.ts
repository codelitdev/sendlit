import { createFooterBlock } from "@sendlit/email-blocks/footer";

export const SENDLIT_FOOTER_BLOCK = createFooterBlock({
    labels: {
        displayName: "Footer",
        description: "Required mailing address and unsubscribe footer",
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
