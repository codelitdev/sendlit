export interface EmailStyle {
    colors: {
        background: `#${string}`;
        foreground: `#${string}`;
        border: `#${string}`;
        accent: `#${string}`;
        accentForeground: `#${string}`;
    };
    typography: {
        header: {
            fontFamily?: string;
            letterSpacing?: string;
            textTransform?: "uppercase" | "lowercase" | "capitalize" | "none";
            textDecoration?: string;
        };
        text: {
            fontFamily?: string;
            fontSize?: `${number}px`;
            lineHeight?: string;
            letterSpacing?: string;
            textTransform?: "uppercase" | "lowercase" | "capitalize" | "none";
            textDecoration?: "underline" | "none" | "line-through";
        };
        link: {
            fontFamily?: string;
            fontSize?: `${number}px`;
            lineHeight?: string;
            letterSpacing?: string;
            textTransform?: "uppercase" | "lowercase" | "capitalize" | "none";
            textDecoration?: "underline" | "none" | "line-through";
        };
    };
    interactives: {
        button: {
            padding?: {
                x?: `${number}px`;
                y?: `${number}px`;
            };
            border?: {
                width?: `${number}px`;
                radius?: `${number}px`;
                style?: string;
            };
        };
        link: {
            padding?: {
                x?: `${number}px`;
                y?: `${number}px`;
            };
        };
    };
    structure: {
        page: {
            background?: `#${string}`;
            foreground?: `#${string}`;
            width?: `${number}px`;
            marginY?: `${number}px`;
            borderWidth?: `${number}px`;
            borderStyle?: string;
            borderRadius?: `${number}px`;
        };
        section: {
            padding?: {
                x?: `${number}px`;
                y?: `${number}px`;
            };
        };
    };
}

export interface CommonBlockSettings {
    backgroundColor?: `#${string}`;
    paddingTop?: `${number}px`;
    paddingBottom?: `${number}px`;
    paddingX?: `${number}px`;
}

export interface EmailBlock<TSettings = Record<string, any>> {
    id?: string;
    blockType: string;
    settings: TSettings;
}

export interface BlockRenderProps<TSettings = Record<string, any>> {
    block: EmailBlock<TSettings> & { settings: TSettings };
    style?: EmailStyle;
    selectedBlockId?: string | null;
}

export type RuntimeEmailBlock<TSettings = Record<string, any>> = Required<
    EmailBlock<TSettings>
> & { id: string; settings: TSettings };

export interface BlockSettingsProps<TSettings = Record<string, any>> {
    block: RuntimeEmailBlock<TSettings>;
    style?: EmailStyle;
    updateBlock: (id: string, content: Partial<EmailBlock>) => void;
}

export interface EmailMeta {
    previewText?: string;
    utm?: {
        source: string;
        medium: string;
        campaign: string;
    };
}

export interface Email<TSettings = Record<string, any>> {
    style: EmailStyle;
    meta: EmailMeta;
    content: EmailBlock<TSettings>[];
}
