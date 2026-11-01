import type { ComponentType } from "react";

/** A merge tag the host offers, e.g. `{{ subscriber.name }}`. */
export interface EditorVariable {
  tag: string;
  description: string;
  /** Shown in place of the tag when "Sample data" is on. */
  sample?: string;
}

export type EditorTheme = "sendlit" | "neutral" | "dark";

/** One entry of the insert menu: a kind of text, or a block. */
export interface BlockChoice {
  id: string;
  name: string;
  description: string;
  keywords: string;
  icon: ComponentType<{ className?: string }>;
  /** Markdown the text block starts with, for the text kinds. */
  text?: string;
  /** The block to insert, for the rest. */
  blockType?: string;
  settings?: Record<string, unknown>;
}
