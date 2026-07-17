"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { BlockWrapper } from "./block-wrapper";
import { AddBlockButton } from "./add-block-button";
import { BlockSettingsPanel } from "./block-settings-panel";
import { EditorLayout } from "./layout/editor-layout";
import type { EmailBlock, Email, EmailStyle } from "../types/email-editor";
import type { BlockRegistry } from "../types/block-registry";
import { defaultEmail } from "../lib/default-email";
import "../index.css";

// Simple ID generator
function generateId() {
    return Math.random().toString(36).substr(2, 9);
}

// Helper function to deep merge objects
function deepMerge(target: any, source: any) {
    const output = { ...target };

    if (isObject(target) && isObject(source)) {
        Object.keys(source).forEach((key) => {
            if (isObject(source[key])) {
                if (!(key in target)) {
                    Object.assign(output, { [key]: source[key] });
                } else {
                    output[key] = deepMerge(target[key], source[key]);
                }
            } else {
                Object.assign(output, { [key]: source[key] });
            }
        });
    }

    return output;
}

function isObject(item: any) {
    return item && typeof item === "object" && !Array.isArray(item);
}

function getEmailWithBlockIds(email: Email): Email {
    return {
        style: email.style,
        meta: email.meta,
        content: email.content.map((block) => ({
            ...block,
            id: generateId(),
            settings: block.settings || {},
        })),
    };
}

function stripBlockIds(email: Email): Email {
    return {
        ...email,
        content: email.content.map((block) => ({ ...block, id: undefined })),
    };
}

function getDefaultSettingsForBlockType(
    blockType: string,
): Record<string, any> {
    const commonSettings = {};

    switch (blockType) {
        case "text":
            return {
                ...commonSettings,
                content: "New text block",
            };
        case "separator":
            return {
                ...commonSettings,
                color: "#e2e8f0",
                thickness: "1px",
                style: "solid",
                marginY: "16px",
            };
        case "image":
            return {
                ...commonSettings,
                src: "",
                alt: "Image",
                alignment: "left",
                width: "auto",
                height: "auto",
                maxWidth: "100%",
                borderRadius: "0px",
                padding: "16px",
            };
        case "link":
            return {
                ...commonSettings,
                text: "Link Text",
                url: "#",
                alignment: "left",
                textColor: "#0284c7",
                fontSize: "16px",
                textDecoration: "underline",
                isButton: false,
            };
        default:
            return {} as Record<string, any>;
    }
}

interface EmailEditorProps {
    initialEmail?: Email;
    onChange?: (email: Email) => void;
    blockRegistry: BlockRegistry;
}

export function EmailEditor({
    initialEmail,
    onChange,
    blockRegistry,
}: EmailEditorProps) {
    const [email, setEmail] = useState<Email>(
        getEmailWithBlockIds(initialEmail || defaultEmail),
    );
    const [movingBlockId, setMovingBlockId] = useState<string | null>(null);
    const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);
    const [showSettings] = useState(true);

    // Tracks the last value this component itself emitted via onChange (with
    // block ids stripped, matching the shape of `initialEmail`). This lets us
    // distinguish a genuine external reset (e.g. a different record loaded by
    // the parent) from the parent simply echoing our own change back down as
    // a new `initialEmail` reference, which would otherwise regenerate all
    // block ids and invalidate `selectedBlockId`.
    const lastEmittedRef = useRef<Email | null>(null);
    const lastInitialEmailRef = useRef(initialEmail);
    const emailRef = useRef(email);

    // Keep the parent informed in the same event that changes editor state.
    // Deferring this to an effect leaves a window where an immediate Save can
    // observe the previous document.
    const commitEmail = useCallback(
        (nextEmail: Email) => {
            emailRef.current = nextEmail;
            setEmail(nextEmail);

            const emitted = stripBlockIds(nextEmail);
            lastEmittedRef.current = emitted;
            onChange?.(emitted);
        },
        [onChange],
    );

    // Update email when initialEmail prop changes
    useEffect(() => {
        if (!initialEmail || initialEmail === lastInitialEmailRef.current) {
            return;
        }
        lastInitialEmailRef.current = initialEmail;

        const isEchoOfOwnChange =
            lastEmittedRef.current !== null &&
            JSON.stringify(lastEmittedRef.current) ===
                JSON.stringify(initialEmail);
        if (isEchoOfOwnChange) {
            return;
        }
        const nextEmail = getEmailWithBlockIds(initialEmail);
        emailRef.current = nextEmail;
        setEmail(nextEmail);
    }, [initialEmail]);

    const updateEmail = useCallback(
        (newEmail: Email) => {
            commitEmail(newEmail);
        },
        [commitEmail],
    );

    const updateEmailStyle = useCallback(
        (styleUpdate: Partial<EmailStyle>) => {
            const newEmail = {
                ...emailRef.current,
                style: deepMerge(emailRef.current.style, styleUpdate),
            };
            commitEmail(newEmail);
        },
        [commitEmail],
    );

    const addBlock = useCallback(
        (blockType: string, index: number) => {
            const newBlock: EmailBlock = {
                id: generateId(),
                blockType,
                settings: getDefaultSettingsForBlockType(blockType),
            };
            const newEmail = {
                ...emailRef.current,
                content: [
                    ...emailRef.current.content.slice(0, index),
                    newBlock,
                    ...emailRef.current.content.slice(index),
                ],
            };

            commitEmail(newEmail);
            setSelectedBlockId(newBlock.id!);
        },
        [commitEmail],
    );

    const updateBlock = useCallback(
        (id: string, content: Partial<EmailBlock>) => {
            const newEmail = {
                ...emailRef.current,
                content: emailRef.current.content.map((block) =>
                    block.id === id ? { ...block, ...content } : block,
                ),
            };
            commitEmail(newEmail);
        },
        [commitEmail],
    );

    // const updateBlockStyle = useCallback(
    //     (id: string, style: Partial<Style>) => {
    //         const newEmail = {
    //             ...email,
    //             content: email.content.map((block) => {
    //                 if (block.id === id) {
    //                     return {
    //                         ...block,
    //                         style: {
    //                             ...(block.style || {}),
    //                             ...style,
    //                         },
    //                     };
    //                 }
    //                 return block;
    //             }),
    //         };

    //         setEmail(newEmail);

    //         if (onChange) {
    //             onChange(stripBlockIds(newEmail));
    //         }
    //     },
    //     [email, onChange],
    // );

    const deleteBlock = useCallback(
        (id: string) => {
            // Don't allow deleting if there's only one block left
            if (emailRef.current.content.length <= 1) {
                return;
            }

            const newEmail = {
                ...emailRef.current,
                content: emailRef.current.content.filter(
                    (block) => block.id !== id,
                ),
            };

            commitEmail(newEmail);

            // If the deleted block was selected, clear selection
            setSelectedBlockId((prevSelectedId) => {
                if (prevSelectedId === id) {
                    return null;
                }
                return prevSelectedId;
            });
        },
        [commitEmail],
    );

    const moveBlock = useCallback(
        (id: string, direction: "up" | "down") => {
            const index = emailRef.current.content.findIndex(
                (block) => block.id === id,
            );
            if (
                (direction === "up" && index === 0) ||
                (direction === "down" &&
                    index === emailRef.current.content.length - 1)
            ) {
                return;
            }

            const newContent = [...emailRef.current.content];
            const [movedBlock] = newContent.splice(index, 1);
            newContent.splice(
                direction === "up" ? index - 1 : index + 1,
                0,
                movedBlock,
            );

            commitEmail({
                ...emailRef.current,
                content: newContent,
            });

            // Set the moving block ID to trigger animation
            setMovingBlockId(id);

            // Clear the moving block ID after animation completes
            setTimeout(() => {
                setMovingBlockId(null);
            }, 350);
        },
        [commitEmail],
    );

    const duplicateBlock = useCallback(
        (id: string) => {
            const blockToDuplicate = emailRef.current.content.find(
                (block) => block.id === id,
            );
            if (!blockToDuplicate) return;

            const index = emailRef.current.content.findIndex(
                (block) => block.id === id,
            );
            const duplicatedBlock = {
                ...blockToDuplicate,
                id: generateId(),
            };

            const newContent = [...emailRef.current.content];
            newContent.splice(index + 1, 0, duplicatedBlock);

            const newEmail = {
                ...emailRef.current,
                content: newContent,
            };

            commitEmail(newEmail);

            // Set the selection immediately after creating the duplicated block
            setSelectedBlockId(duplicatedBlock.id!);
        },
        [commitEmail],
    );

    // Separate first, middle, and last blocks
    const [first, ...remaining] = email.content;
    const last = remaining.pop();
    const middleBlocks = remaining;

    // Email editor content - mirroring the HTML email structure
    const editorContent = (
        <div className="email-html">
            {/* Body equivalent - Apply body styles here */}
            <div
                className="email-body"
                style={{
                    backgroundColor: email.style.colors.background,
                    color: email.style.colors.foreground,
                    paddingTop: email.style.structure.page.marginY,
                    paddingBottom: email.style.structure.page.marginY,
                    fontFamily: email.style.typography.text.fontFamily,
                }}
            >
                {/* Container equivalent - Apply container styles here */}
                <div
                    className="email-container mx-auto"
                    style={{
                        width: "100%",
                        margin: `0px auto`,
                        backgroundColor: email.style.structure.page.background,
                        color:
                            email.style.structure.page.foreground ||
                            email.style.colors.foreground,
                        maxWidth: email.style.structure.page.width,
                        borderWidth: email.style.structure.page.borderWidth,
                        borderStyle: email.style.structure.page.borderStyle,
                        borderColor: email.style.colors.border,
                        borderRadius: "0px",
                        overflow: "hidden",
                    }}
                >
                    {email.content.length === 0 && (
                        <div className="p-4 text-center">
                            <p className="mb-4 text-muted-foreground">
                                Your email is empty.
                            </p>
                            <AddBlockButton
                                position="below"
                                index={0}
                                addBlock={addBlock}
                                blockRegistry={blockRegistry}
                            />
                        </div>
                    )}

                    <div>
                        {/* First Block - Fixed */}
                        {first && (
                            <BlockWrapper
                                key={first.id}
                                block={first as Required<EmailBlock>}
                                index={0}
                                isFirst={true}
                                isLast={false}
                                isFixed={true}
                                style={email.style}
                                blockRegistry={blockRegistry}
                                selectedBlockId={selectedBlockId}
                                setSelectedBlockId={setSelectedBlockId}
                                deleteBlock={deleteBlock}
                                moveBlock={moveBlock}
                                duplicateBlock={duplicateBlock}
                                movingBlockId={movingBlockId}
                                addBlock={addBlock}
                                totalBlocks={email.content.length}
                            />
                        )}

                        {/* Middle Blocks - Movable */}
                        {middleBlocks.map(
                            (block: EmailBlock, index: number) => (
                                <BlockWrapper
                                    key={block.id}
                                    block={block as Required<EmailBlock>}
                                    index={index + 1}
                                    isFirst={false}
                                    isLast={false}
                                    isFixed={false}
                                    style={email.style}
                                    blockRegistry={blockRegistry}
                                    selectedBlockId={selectedBlockId}
                                    setSelectedBlockId={setSelectedBlockId}
                                    deleteBlock={deleteBlock}
                                    moveBlock={moveBlock}
                                    duplicateBlock={duplicateBlock}
                                    movingBlockId={movingBlockId}
                                    addBlock={addBlock}
                                    totalBlocks={email.content.length}
                                />
                            ),
                        )}

                        {/* Last Block - Fixed */}
                        {last && (
                            <BlockWrapper
                                key={last.id}
                                block={last as Required<EmailBlock>}
                                index={email.content.length - 1}
                                isFirst={false}
                                isLast={true}
                                isFixed={true}
                                style={email.style}
                                blockRegistry={blockRegistry}
                                selectedBlockId={selectedBlockId}
                                setSelectedBlockId={setSelectedBlockId}
                                deleteBlock={deleteBlock}
                                moveBlock={moveBlock}
                                duplicateBlock={duplicateBlock}
                                movingBlockId={movingBlockId}
                                addBlock={addBlock}
                                totalBlocks={email.content.length}
                            />
                        )}
                    </div>
                </div>
            </div>
        </div>
    );

    // Settings panel
    const settingsPanel = (
        <BlockSettingsPanel
            blockId={selectedBlockId}
            email={email}
            setSelectedBlockId={setSelectedBlockId}
            blockRegistry={blockRegistry}
            updateEmail={updateEmail}
            updateEmailStyle={updateEmailStyle}
            updateBlock={updateBlock}
        />
    );

    return (
        <EditorLayout
            editor={editorContent}
            settings={settingsPanel}
            showSettings={showSettings}
        />
    );
}
