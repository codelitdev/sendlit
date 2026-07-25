export interface FooterSettings {
    alignment?: "left" | "center" | "right";
    fontFamily?: string;
    fontSize?: `${number}px`;
    foregroundColor?: `#${string}`;
    backgroundColor?: `#${string}` | "transparent";
    paddingTop?: `${number}px`;
    paddingBottom?: `${number}px`;
    paddingX?: `${number}px`;
}

export interface SendLitEmailRenderContext {
    footer?: {
        mailingAddress: string;
        unsubscribeUrl: string;
    };
}

export interface FooterLabels {
    displayName: string;
    description: string;
    unsubscribe: string;
    alignment: string;
    alignmentLeft: string;
    alignmentCenter: string;
    alignmentRight: string;
    foregroundColor: string;
    backgroundColor: string;
    fontSize: string;
    paddingTop: string;
    paddingBottom: string;
    paddingX: string;
}

export interface FooterBlockConfig {
    labels: FooterLabels;
}
