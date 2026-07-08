import type { ComponentType, ReactNode } from "react";
import type { CommonBlockSettings } from "@/types/email-editor";

export interface ImageBlockSettings extends CommonBlockSettings {
    src: string;
    alt?: string;
    alignment?: "left" | "center" | "right";
    width?: string;
    height?: string;
    maxWidth?: string;
    borderRadius?: string;
    borderWidth?: string;
    borderStyle?: string;
    borderColor?: string;
    padding?: string;
}

export type UploadedImage = Partial<ImageBlockSettings> &
    Pick<ImageBlockSettings, "src">;

export interface UploaderProps {
    value: UploadedImage;
    onChange: (image: UploadedImage) => void;
    children: ReactNode;
}

export type Uploader = ComponentType<UploaderProps>;

export interface ImageBlockConfig {
    uploader?: Uploader;
}
