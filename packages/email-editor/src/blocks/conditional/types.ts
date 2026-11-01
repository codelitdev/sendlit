import type { CommonBlockSettings } from "@/types/email-editor";

export interface ConditionalBlockSettings extends CommonBlockSettings {
  /** The contact tag the section depends on. */
  tag: string;
  /** Show to contacts that have the tag (default) or to those that don't. */
  has?: boolean;
  content: string;
}

/** Tags go into a Liquid expression, so only plain words are accepted. */
export const CONDITION_TAG_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 _.-]{0,39}$/;

export function isValidConditionTag(tag: unknown): tag is string {
  return typeof tag === "string" && CONDITION_TAG_PATTERN.test(tag);
}
