import type { BlockComponent } from "@/types/block-registry";
import { ImageBlock as block } from "./block";
import { metadata } from "./metadata";
import { ImageSettings as settings } from "./settings";
import type { ImageBlockConfig, ImageBlockSettings } from "./types";

type ConfigurableImageBlock = BlockComponent<ImageBlockSettings> & {
  configure: (config: ImageBlockConfig) => BlockComponent<ImageBlockSettings>;
};

const baseImageBlock: BlockComponent<ImageBlockSettings> = {
  block,
  settings,
  metadata,
  defaultSettings: () => ({
    src: "",
    alt: "Image",
    alignment: "left",
    width: "auto",
    height: "auto",
    maxWidth: "100%",
    borderRadius: "0px",
    padding: "16px",
  }),
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
