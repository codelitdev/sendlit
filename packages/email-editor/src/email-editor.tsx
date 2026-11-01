import {
  Columns,
  Conditional,
  HtmlSnippet,
  Image,
  Link,
  Separator,
  Social,
  Spacer,
  Text,
} from "@/blocks";
import type { BlockComponent, BlockRegistry } from "@/types/block-registry";
import type { Email } from "@/types/email-editor";
import type { EditorTheme, EditorVariable } from "@/types/editor-ui";
import { EmailEditor as EmailEditorComponent } from "./components/email-editor";

interface EmailEditorProps<TRenderContext = any> {
  email: Email;
  onChange: (email: Email) => void;
  blocks?: BlockComponent<any, TRenderContext>[];
  renderContext?: TRenderContext;
  /** The subject line, edited above the email. Omit to leave it to the host. */
  subject?: string;
  onSubjectChange?: (subject: string) => void;
  /** Merge tags offered while writing. */
  variables?: EditorVariable[];
  /** Shown as the sender in inbox previews. */
  senderName?: string;
  theme?: EditorTheme;
  defaultMode?: "write" | "style";
}

const DEFAULT_BLOCKS = [
  Text,
  Link,
  Image,
  Separator,
  Spacer,
  Columns,
  Social,
  HtmlSnippet,
  Conditional,
];

function generateBlockRegistry<TRenderContext>(
  blocks?: BlockComponent<any, TRenderContext>[],
): BlockRegistry<TRenderContext> {
  const blockRegistry: BlockRegistry<TRenderContext> = {};
  for (const block of blocks || DEFAULT_BLOCKS) {
    blockRegistry[block.metadata.name] = block;
  }
  return blockRegistry;
}

export function EmailEditor<TRenderContext = any>({
  email,
  onChange,
  blocks,
  renderContext,
  ...rest
}: EmailEditorProps<TRenderContext>) {
  const blockRegistry = generateBlockRegistry(blocks);

  return (
    <EmailEditorComponent
      initialEmail={email}
      onChange={onChange}
      blockRegistry={blockRegistry}
      renderContext={renderContext}
      {...rest}
    />
  );
}
