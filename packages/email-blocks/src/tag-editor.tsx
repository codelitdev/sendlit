"use client";

import { useState } from "react";
import { Plus, X } from "lucide-react";
import { Button } from "./components/ui/button";
import { Input } from "./components/ui/input";
import { cn } from "./lib/utils";

export interface TagEditorProps {
    tags: string[];
    onAdd: (tag: string) => void;
    onRemove: (tag: string) => void;
    className?: string;
}

/** Small tag chips + add-tag input, used on the contact detail view. */
export function TagEditor({ tags, onAdd, onRemove, className }: TagEditorProps) {
    const [draft, setDraft] = useState("");

    function submit() {
        const tag = draft.trim();
        if (!tag) return;
        onAdd(tag);
        setDraft("");
    }

    return (
        <div className={cn("space-y-2", className)}>
            <div className="flex flex-wrap gap-1.5">
                {tags.map((tag) => (
                    <span
                        key={tag}
                        className="inline-flex items-center gap-1 rounded-full bg-secondary px-2.5 py-0.5 text-xs font-medium text-secondary-foreground"
                    >
                        {tag}
                        <button
                            type="button"
                            onClick={() => onRemove(tag)}
                            className="rounded-full hover:bg-black/10"
                        >
                            <X className="size-3" />
                        </button>
                    </span>
                ))}
                {tags.length === 0 && (
                    <span className="text-xs text-muted-foreground">No tags</span>
                )}
            </div>
            <div className="flex gap-2">
                <Input
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                        if (e.key === "Enter") {
                            e.preventDefault();
                            submit();
                        }
                    }}
                    placeholder="Add a tag"
                    className="h-8"
                />
                <Button type="button" size="icon" className="size-8" onClick={submit}>
                    <Plus className="size-4" />
                </Button>
            </div>
        </div>
    );
}
