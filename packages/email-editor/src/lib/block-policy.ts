import type {
    BlockCapabilities,
    BlockComponent,
    BlockRegistry,
} from "../types/block-registry";
import type { EmailBlock } from "../types/email-editor";

export const DEFAULT_BLOCK_CAPABILITIES: BlockCapabilities = {
    insertable: true,
    deletable: true,
    duplicable: true,
    movable: true,
    placement: "any",
};

export function getBlockCapabilities(
    blockType: string,
    blockRegistry: BlockRegistry,
): BlockCapabilities {
    return {
        ...DEFAULT_BLOCK_CAPABILITIES,
        ...blockRegistry[blockType]?.capabilities,
    };
}

export function getDefaultBlockSettings(
    blockType: string,
    blockRegistry: BlockRegistry,
): Record<string, any> {
    return blockRegistry[blockType]?.defaultSettings?.() ?? {};
}

export function getInsertableBlocks(
    blockRegistry: BlockRegistry,
): BlockComponent[] {
    return Object.values(blockRegistry).filter(
        (block) =>
            getBlockCapabilities(block.metadata.name, blockRegistry).insertable,
    );
}

function hasValidPlacement(
    content: EmailBlock[],
    blockRegistry: BlockRegistry,
): boolean {
    return content.every((block, index) => {
        const placement = getBlockCapabilities(
            block.blockType,
            blockRegistry,
        ).placement;
        if (placement === "first") return index === 0;
        if (placement === "last") return index === content.length - 1;
        return true;
    });
}

export function resolveInsertionIndex(
    blockType: string,
    requestedIndex: number,
    content: EmailBlock[],
    blockRegistry: BlockRegistry,
): number | null {
    const capabilities = getBlockCapabilities(blockType, blockRegistry);
    if (!capabilities.insertable) return null;

    if (capabilities.placement === "first") {
        return content.some(
            (block) =>
                getBlockCapabilities(block.blockType, blockRegistry)
                    .placement === "first",
        )
            ? null
            : 0;
    }
    if (capabilities.placement === "last") {
        return content.some(
            (block) =>
                getBlockCapabilities(block.blockType, blockRegistry)
                    .placement === "last",
        )
            ? null
            : content.length;
    }

    const firstIndex = content.findIndex(
        (block) =>
            getBlockCapabilities(block.blockType, blockRegistry).placement ===
            "first",
    );
    const lastIndex = content.findIndex(
        (block) =>
            getBlockCapabilities(block.blockType, blockRegistry).placement ===
            "last",
    );
    const lowerBound = firstIndex === -1 ? 0 : firstIndex + 1;
    const upperBound = lastIndex === -1 ? content.length : lastIndex;
    return Math.max(lowerBound, Math.min(requestedIndex, upperBound));
}

export function canDeleteBlock(
    block: EmailBlock,
    blockRegistry: BlockRegistry,
): boolean {
    return getBlockCapabilities(block.blockType, blockRegistry).deletable;
}

export function canDuplicateBlock(
    block: EmailBlock,
    blockRegistry: BlockRegistry,
): boolean {
    const capabilities = getBlockCapabilities(block.blockType, blockRegistry);
    return capabilities.duplicable && capabilities.placement === "any";
}

export function canMoveBlock(
    content: EmailBlock[],
    blockId: string,
    direction: "up" | "down",
    blockRegistry: BlockRegistry,
): boolean {
    const index = content.findIndex((block) => block.id === blockId);
    if (index === -1) return false;

    const block = content[index];
    if (!getBlockCapabilities(block.blockType, blockRegistry).movable) {
        return false;
    }

    const targetIndex = direction === "up" ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= content.length) return false;

    const next = [...content];
    [next[index], next[targetIndex]] = [next[targetIndex], next[index]];
    return hasValidPlacement(next, blockRegistry);
}

export function canInsertAfter(
    block: EmailBlock,
    blockRegistry: BlockRegistry,
): boolean {
    return (
        getBlockCapabilities(block.blockType, blockRegistry).placement !==
        "last"
    );
}
