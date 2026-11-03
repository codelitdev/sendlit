import type { ComponentType } from "react";
import type { BlockRenderProps, BlockSettingsProps } from "./email-editor";

export type BlockPlacement = "any" | "first" | "last";

export interface BlockCapabilities {
  insertable: boolean;
  deletable: boolean;
  duplicable: boolean;
  movable: boolean;
  placement: BlockPlacement;
}

export interface BlockMetadata {
  name: string;
  displayName: string;
  description: string;
  icon: ComponentType<{ className?: string }>;
  docs: {
    settings: Record<string, string>;
  };
}

export interface BlockComponent<TSettings = any, TRenderContext = any> {
  block: ComponentType<BlockRenderProps<TSettings, TRenderContext>>;
  settings: ComponentType<BlockSettingsProps<TSettings>>;
  metadata: BlockMetadata;
  defaultSettings?: () => TSettings;
  /** The few fields worth editing in place while writing (a button's label and
   * link, an image's alt text). The full form stays in Style mode. */
  quickEdit?: ComponentType<BlockSettingsProps<TSettings>>;
  /** Lay the quick fields out in a row (default) or a column. */
  quickEditLayout?: "row" | "column";
  capabilities?: Partial<BlockCapabilities>;
}

export interface BlockRegistry<TRenderContext = any> {
  [key: string]: BlockComponent<any, TRenderContext>;
}
