import { useState } from "react";
import { Plus } from "lucide-react";
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover";
import type { BlockRegistry } from "../types/block-registry";

interface AddBlockButtonProps {
    position: "above" | "below";
    index: number;
    addBlock: (blockType: string, index: number) => void;
    blockRegistry: BlockRegistry;
}

export function AddBlockButton({
    position,
    index,
    addBlock,
    blockRegistry,
}: AddBlockButtonProps) {
    const [isOpen, setIsOpen] = useState(false);

    const blockTypes = Object.values(blockRegistry).map((block) => ({
        type: block.metadata.name,
        icon: block.metadata.icon,
        label: block.metadata.displayName,
        description: block.metadata.description,
    }));

    const handleAddBlock = (blockType: string) => {
        addBlock(blockType, index);
        setIsOpen(false);
    };

    return (
        <Popover open={isOpen} onOpenChange={setIsOpen}>
            <PopoverTrigger asChild>
                <button className="bg-background border border-border rounded-full p-1 shadow-sm hover:border-primary/50 transition-colors">
                    <Plus className="h-3 w-3 text-muted-foreground" />
                </button>
            </PopoverTrigger>
            <PopoverContent
                className="w-80 p-3"
                side="bottom"
                align="start"
                sideOffset={8}
                avoidCollisions={true}
                collisionPadding={20}
            >
                <div className="grid grid-cols-2 gap-2">
                    {blockTypes.map((blockType) => (
                        <button
                            key={blockType.type}
                            onClick={() => handleAddBlock(blockType.type)}
                            className="flex flex-col items-center p-3 hover:bg-accent rounded transition-colors border border-transparent hover:border-primary/40"
                        >
                            <div className="text-primary mb-1">
                                {blockType.icon && (
                                    <blockType.icon className="w-5 h-5" />
                                )}
                            </div>
                            <span className="text-xs font-medium text-foreground">
                                {blockType.label}
                            </span>
                        </button>
                    ))}
                </div>
            </PopoverContent>
        </Popover>
    );
}
