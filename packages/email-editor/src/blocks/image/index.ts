import { ImageBlock as block } from "./block";
import { ImageSettings as settings } from "./settings";
import { metadata } from "./metadata";
import type { BlockComponent } from "@/types/block-registry";
import type { ImageBlockConfig, ImageBlockSettings } from "./types";

type ConfigurableImageBlock = BlockComponent<ImageBlockSettings> & {
    configure: (config: ImageBlockConfig) => BlockComponent<ImageBlockSettings>;
};

const baseImageBlock: BlockComponent<ImageBlockSettings> = {
    block,
    settings,
    metadata,
};

export const ImageBlock: ConfigurableImageBlock = {
    ...baseImageBlock,
    configure: ({ uploader }) => {
        const Settings = settings;

        return {
            ...baseImageBlock,
            settings: (props) => Settings({ ...props, uploader }),
        };
    },
};
