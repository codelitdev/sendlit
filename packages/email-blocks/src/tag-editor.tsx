"use client";

import { useEffect, useMemo, useState, type KeyboardEvent } from "react";
import { Check, ChevronDown, PlusCircle, X } from "lucide-react";
import { Badge } from "./components/ui/badge";
import { Button, buttonVariants } from "./components/ui/button";
import {
    Command,
    CommandEmpty,
    CommandGroup,
    CommandInput,
    CommandItem,
    CommandList,
} from "./components/ui/command";
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "./components/ui/popover";
import { cn } from "./lib/utils";

export interface TagEditorProps {
    tags: string[];
    /** All known tags a host can offer to pick from (e.g. every tag used across contacts). Tags already in `tags` are always included even if omitted here. */
    options?: string[];
    onAdd: (tag: string) => void;
    onRemove: (tag: string) => void;
    placeholder?: string;
    searchPlaceholder?: string;
    createLabel?: (value: string) => string;
    emptyLabel?: string;
    headingLabel?: string;
    /** Accessible name for the trigger, read instead of its chip/button contents. */
    "aria-label"?: string;
    className?: string;
}

/**
 * Combobox for a contact's tags: selected tags render as chips inside the
 * trigger, the dropdown lists existing tags (checked when selected), and
 * typing a value with no match offers to create it.
 */
export function TagEditor({
    tags,
    options = [],
    onAdd,
    onRemove,
    placeholder = "Select or create...",
    searchPlaceholder = "Search...",
    createLabel = (value) => `Create "${value}"`,
    emptyLabel = "No results found",
    headingLabel = "Tags",
    "aria-label": ariaLabel = "Tags",
    className,
}: TagEditorProps) {
    const [open, setOpen] = useState(false);
    const [searchValue, setSearchValue] = useState("");
    const [announcement, setAnnouncement] = useState("");

    useEffect(() => {
        if (!open) setSearchValue("");
    }, [open]);

    function announce(message: string) {
        setAnnouncement(message);
    }

    const allOptions = useMemo(
        () => Array.from(new Set([...options, ...tags])),
        [options, tags],
    );
    const selected = useMemo(() => new Set(tags), [tags]);
    const normalizedSearch = searchValue.trim().toLowerCase();

    const filteredOptions = useMemo(() => {
        if (!normalizedSearch) return allOptions;
        return allOptions.filter((option) =>
            option.toLowerCase().includes(normalizedSearch),
        );
    }, [allOptions, normalizedSearch]);

    const existingValuesLower = useMemo(
        () => new Set(allOptions.map((option) => option.toLowerCase())),
        [allOptions],
    );
    const canCreateNewOption =
        normalizedSearch.length > 0 &&
        !existingValuesLower.has(normalizedSearch);

    function toggleOption(value: string) {
        if (selected.has(value)) {
            onRemove(value);
            announce(`${value} removed`);
        } else {
            onAdd(value);
            announce(`${value} added`);
        }
    }

    function createOption() {
        const trimmed = searchValue.trim();
        if (!trimmed) return;
        onAdd(trimmed);
        announce(`${trimmed} added`);
        setSearchValue("");
    }

    function removeTag(tag: string) {
        onRemove(tag);
        announce(`${tag} removed`);
    }

    function handleInputKeyDown(event: KeyboardEvent<HTMLInputElement>) {
        if (event.key === "Enter" && canCreateNewOption) {
            event.preventDefault();
            createOption();
        }
    }

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <div
                    role="combobox"
                    aria-expanded={open}
                    aria-haspopup="listbox"
                    aria-label={ariaLabel}
                    tabIndex={0}
                    onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            event.currentTarget.click();
                        }
                    }}
                    className={cn(
                        buttonVariants({ variant: "outline" }),
                        "w-full cursor-pointer justify-between gap-2 min-h-[42px] h-auto flex-wrap",
                        className,
                    )}
                >
                    <div className="flex flex-1 flex-wrap items-center gap-1 text-left">
                        {tags.length === 0 ? (
                            <span className="text-muted-foreground">
                                {placeholder}
                            </span>
                        ) : (
                            tags.map((tag) => (
                                <Badge
                                    key={tag}
                                    variant="secondary"
                                    className="flex items-center gap-1 text-xs"
                                >
                                    {tag}
                                    <button
                                        type="button"
                                        className="rounded-sm p-0.5 transition hover:bg-muted"
                                        onClick={(event) => {
                                            event.stopPropagation();
                                            removeTag(tag);
                                        }}
                                        aria-label={`Remove ${tag}`}
                                    >
                                        <X className="h-3 w-3" />
                                    </button>
                                </Badge>
                            ))
                        )}
                    </div>
                    <ChevronDown
                        className={cn(
                            "h-4 w-4 shrink-0 opacity-50 transition-transform",
                            open && "rotate-180",
                        )}
                    />
                </div>
            </PopoverTrigger>
            <PopoverContent className="w-[320px] p-0">
                <Command shouldFilter={false}>
                    <CommandInput
                        placeholder={searchPlaceholder}
                        value={searchValue}
                        onValueChange={setSearchValue}
                        onKeyDown={handleInputKeyDown}
                    />
                    <CommandList>
                        <CommandEmpty>
                            <div className="flex flex-col items-center gap-2 py-6 text-sm text-muted-foreground">
                                <span>{emptyLabel}</span>
                                {canCreateNewOption && (
                                    <Button
                                        type="button"
                                        size="sm"
                                        variant="secondary"
                                        className="gap-2"
                                        onClick={createOption}
                                    >
                                        <PlusCircle className="h-4 w-4" />
                                        {createLabel(searchValue.trim())}
                                    </Button>
                                )}
                            </div>
                        </CommandEmpty>
                        <CommandGroup heading={headingLabel}>
                            {filteredOptions.map((option) => {
                                const isSelected = selected.has(option);
                                return (
                                    <CommandItem
                                        key={option}
                                        value={option}
                                        aria-label={
                                            isSelected
                                                ? `${option}, added`
                                                : option
                                        }
                                        onSelect={(currentValue) =>
                                            toggleOption(currentValue)
                                        }
                                    >
                                        <div
                                            className="mr-2 flex h-4 w-4 items-center justify-center"
                                            aria-hidden="true"
                                        >
                                            <Check
                                                className={cn(
                                                    "h-4 w-4",
                                                    isSelected
                                                        ? "opacity-100"
                                                        : "opacity-0",
                                                )}
                                            />
                                        </div>
                                        <span className="flex-1 text-sm">
                                            {option}
                                        </span>
                                    </CommandItem>
                                );
                            })}
                        </CommandGroup>
                        {canCreateNewOption && filteredOptions.length > 0 && (
                            <div className="border-t border-border p-2">
                                <Button
                                    type="button"
                                    variant="ghost"
                                    className="w-full justify-start gap-2 px-2 text-sm"
                                    onClick={createOption}
                                >
                                    <PlusCircle className="h-4 w-4" />
                                    {createLabel(searchValue.trim())}
                                </Button>
                            </div>
                        )}
                    </CommandList>
                </Command>
            </PopoverContent>
            <span className="sr-only" role="status" aria-live="polite">
                {announcement}
            </span>
        </Popover>
    );
}
