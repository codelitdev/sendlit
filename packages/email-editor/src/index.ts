export { EmailEditor } from "./email-editor";
export type {
    BlockCapabilities,
    BlockComponent,
    BlockPlacement,
    BlockRegistry,
} from "./types/block-registry";
export type {
    BlockRenderProps,
    BlockSettingsProps,
    Email,
    EmailBlock,
    EmailMeta,
    EmailStyle,
} from "./types/email-editor";
export type {
    ImageBlockConfig,
    Uploader,
    UploaderProps,
    UploadedImage,
} from "./blocks/image/types";
export { renderEmailToHtml } from "./lib/email-renderer";
export { defaultEmail } from "./lib/default-email";
