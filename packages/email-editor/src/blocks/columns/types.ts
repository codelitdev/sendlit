import type { CommonBlockSettings } from "@/types/email-editor";

export type ColumnsRatio = "11" | "12" | "21";

export interface ColumnsBlockSettings extends CommonBlockSettings {
  left: string;
  right: string;
  ratio?: ColumnsRatio;
  /** Stack the columns on narrow screens. Default: true */
  stack?: boolean;
  alignment?: "left" | "center" | "right";
}
