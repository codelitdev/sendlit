import { LockKeyhole } from "lucide-react";
import type { BlockComponent, EmailBlock } from "@sendlit/email-editor";
import { FooterBlock } from "./block";
import { FooterSettingsPanel } from "./settings";
import type {
    FooterBlockConfig,
    FooterSettings,
    SendLitEmailRenderContext,
} from "./types";

export const DEFAULT_FOOTER_SETTINGS: FooterSettings = {
    alignment: "center",
    fontFamily: "Arial, sans-serif",
    fontSize: "12px",
    foregroundColor: "#64748b",
    backgroundColor: "transparent",
    paddingTop: "16px",
    paddingBottom: "16px",
    paddingX: "24px",
};

export function createFooterEmailBlock(
    settings: Partial<FooterSettings> = {},
): EmailBlock<FooterSettings> {
    return {
        blockType: "footer",
        settings: { ...DEFAULT_FOOTER_SETTINGS, ...settings },
    };
}

export function createFooterBlock({
    labels,
}: FooterBlockConfig): BlockComponent<
    FooterSettings,
    SendLitEmailRenderContext
> {
    return {
        metadata: {
            name: "footer",
            displayName: labels.displayName,
            description: labels.description,
            icon: LockKeyhole,
            docs: {
                settings: {
                    alignment: "Footer content alignment.",
                    fontFamily: "Footer font family.",
                    fontSize: "Footer font size in pixels.",
                    foregroundColor: "Footer text and link color.",
                    backgroundColor: "Footer background color.",
                    paddingTop: "Footer top padding in pixels.",
                    paddingBottom: "Footer bottom padding in pixels.",
                    paddingX: "Footer horizontal padding in pixels.",
                },
            },
        },
        block: (props) => (
            <FooterBlock {...props} unsubscribeLabel={labels.unsubscribe} />
        ),
        settings: (props) => <FooterSettingsPanel {...props} labels={labels} />,
        defaultSettings: () => ({ ...DEFAULT_FOOTER_SETTINGS }),
        capabilities: {
            insertable: false,
            deletable: false,
            duplicable: false,
            movable: false,
            placement: "last",
        },
    };
}

export type {
    FooterBlockConfig,
    FooterLabels,
    FooterSettings,
    SendLitEmailRenderContext,
} from "./types";
