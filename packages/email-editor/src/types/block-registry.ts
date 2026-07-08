import type { ComponentType } from "react";
import { BlockRenderProps, BlockSettingsProps } from "./email-editor";

export interface BlockMetadata {
    name: string;
    displayName: string;
    description: string;
    icon: ComponentType<{ className?: string }>;
    docs: {
        settings: Record<string, string>;
    };
}

export interface BlockComponent<TSettings = any> {
    block: ComponentType<BlockRenderProps<TSettings>>;
    settings: ComponentType<BlockSettingsProps<TSettings>>;
    metadata: BlockMetadata;
}

export interface BlockRegistry {
    [key: string]: BlockComponent<any>;
}
