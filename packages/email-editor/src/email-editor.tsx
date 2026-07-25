import { EmailEditor as EmailEditorComponent } from "./components/email-editor";
import type { Email } from "@/types/email-editor";
import type { BlockComponent, BlockRegistry } from "@/types/block-registry";
import { Text, Separator, Image, Link } from "@/blocks";

interface EmailEditorProps<TRenderContext = any> {
    email: Email;
    onChange: (email: Email) => void;
    blocks?: BlockComponent<any, TRenderContext>[];
    renderContext?: TRenderContext;
}

function generateBlockRegistry<TRenderContext>(
    blocks?: BlockComponent<any, TRenderContext>[],
): BlockRegistry<TRenderContext> {
    const blockRegistry: BlockRegistry<TRenderContext> = {};
    for (const block of blocks || [Text, Separator, Image, Link]) {
        blockRegistry[block.metadata.name] = block;
    }
    return blockRegistry;
}

export function EmailEditor<TRenderContext = any>({
    email,
    onChange,
    blocks,
    renderContext,
}: EmailEditorProps<TRenderContext>) {
    const blockRegistry = generateBlockRegistry(blocks);

    return (
        <EmailEditorComponent
            initialEmail={email}
            onChange={onChange}
            blockRegistry={blockRegistry}
            renderContext={renderContext}
        />
    );
}
