import type { BlockComponent, EmailBlock } from "@sendlit/email-editor";
import { LockKeyhole } from "lucide-react";
import { FooterBlock } from "./block";
import { FooterSettingsPanel } from "./settings";
import type {
  FooterBlockConfig,
  FooterLabels,
  FooterSettings,
  SendLitEmailRenderContext,
} from "./types";

/** English labels for the footer block and its settings panel. */
export const DEFAULT_FOOTER_LABELS: FooterLabels = {
  displayName: "Footer",
  description: "Required mailing address and unsubscribe footer",
  unsubscribe: "Unsubscribe",
  viewInBrowser: "View in browser",
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
};

/**
 * What a marketing email's managed footer shows in editors and previews,
 * where there's no real address or links yet. Pass the broadcast's or
 * sequence's `viewInBrowser` setting: off leaves the link out, as it is
 * from the emails that get sent.
 */
export function marketingPreviewContext({
  mailingAddress = "Your mailing address",
  viewInBrowser = true,
}: {
  mailingAddress?: string;
  viewInBrowser?: boolean;
} = {}): SendLitEmailRenderContext {
  return {
    footer: {
      mailingAddress,
      unsubscribeUrl: "#unsubscribe-preview",
      ...(viewInBrowser && { viewInBrowserUrl: "#view-in-browser-preview" }),
    },
  };
}

export const DEFAULT_FOOTER_SETTINGS: FooterSettings = {
  alignment: "center",
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
  labels = DEFAULT_FOOTER_LABELS,
}: FooterBlockConfig = {}): BlockComponent<FooterSettings, SendLitEmailRenderContext> {
  return {
    metadata: {
      name: "footer",
      displayName: labels.displayName,
      description: labels.description,
      icon: LockKeyhole,
      docs: {
        settings: {
          alignment: "Footer content alignment.",
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
      <FooterBlock
        {...props}
        unsubscribeLabel={labels.unsubscribe}
        viewInBrowserLabel={labels.viewInBrowser}
      />
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
