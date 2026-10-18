import defaultMdxComponents from "fumadocs-ui/mdx";
import type { MDXComponents } from "mdx/types";
import { EmailBlockDemo } from "@/components/email-block-demo";

export function getMDXComponents(components?: MDXComponents): MDXComponents {
  return {
    ...defaultMdxComponents,
    EmailBlockDemo,
    ...components,
  };
}
