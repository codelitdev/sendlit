import { describe, expect, it } from "vitest";
import type { BlockComponent, BlockRegistry } from "../types/block-registry";
import type { EmailBlock } from "../types/email-editor";
import {
    canDeleteBlock,
    canDuplicateBlock,
    canInsertAfter,
    canMoveBlock,
    getDefaultBlockSettings,
    getInsertableBlocks,
    resolveInsertionIndex,
} from "./block-policy";

function createBlock(
    name: string,
    options: Partial<BlockComponent> = {},
): BlockComponent {
    return {
        block: () => null,
        settings: () => null,
        metadata: {
            name,
            displayName: name,
            description: `${name} block`,
            icon: () => null,
            docs: { settings: {} },
        },
        ...options,
    };
}

function createRegistry(...blocks: BlockComponent[]): BlockRegistry {
    return Object.fromEntries(
        blocks.map((block) => [block.metadata.name, block]),
    );
}

function emailBlock(id: string, blockType: string): EmailBlock {
    return { id, blockType, settings: {} };
}

describe("block policy", () => {
    it("uses block-provided default settings without sharing object instances", () => {
        const registry = createRegistry(
            createBlock("custom", {
                defaultSettings: () => ({ label: "New" }),
            }),
        );

        const first = getDefaultBlockSettings("custom", registry);
        const second = getDefaultBlockSettings("custom", registry);

        expect(first).toEqual({ label: "New" });
        expect(second).toEqual({ label: "New" });
        expect(first).not.toBe(second);
        expect(getDefaultBlockSettings("unknown", registry)).toEqual({});
    });

    it("omits non-insertable blocks from the picker policy", () => {
        const registry = createRegistry(
            createBlock("text"),
            createBlock("managed", {
                capabilities: { insertable: false },
            }),
        );

        expect(
            getInsertableBlocks(registry).map((block) => block.metadata.name),
        ).toEqual(["text"]);
        expect(resolveInsertionIndex("managed", 0, [], registry)).toBeNull();
    });

    it("enforces delete, duplicate, and move capabilities", () => {
        const registry = createRegistry(
            createBlock("locked", {
                capabilities: {
                    deletable: false,
                    duplicable: false,
                    movable: false,
                },
            }),
            createBlock("text"),
        );
        const content = [emailBlock("a", "locked"), emailBlock("b", "text")];

        expect(canDeleteBlock(content[0], registry)).toBe(false);
        expect(canDuplicateBlock(content[0], registry)).toBe(false);
        expect(canMoveBlock(content, "a", "down", registry)).toBe(false);
        expect(canDeleteBlock(content[1], registry)).toBe(true);
    });

    it("keeps last-placement blocks final while ordinary final blocks stay editable", () => {
        const registry = createRegistry(
            createBlock("text"),
            createBlock("footer", {
                capabilities: {
                    insertable: false,
                    deletable: false,
                    duplicable: false,
                    movable: false,
                    placement: "last",
                },
            }),
        );
        const content = [
            emailBlock("a", "text"),
            emailBlock("b", "text"),
            emailBlock("f", "footer"),
        ];

        expect(canMoveBlock(content, "b", "down", registry)).toBe(false);
        expect(resolveInsertionIndex("text", 3, content, registry)).toBe(2);
        expect(canInsertAfter(content[2], registry)).toBe(false);

        const footerFree = [emailBlock("a", "text"), emailBlock("b", "text")];
        expect(canDeleteBlock(footerFree[1], registry)).toBe(true);
        expect(canMoveBlock(footerFree, "b", "up", registry)).toBe(true);
        expect(canInsertAfter(footerFree[1], registry)).toBe(true);
    });
});
