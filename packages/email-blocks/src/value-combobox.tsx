"use client";

import { Check, ChevronDown, PlusCircle } from "lucide-react";
import { useState } from "react";
import { buttonVariants } from "./components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "./components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "./components/ui/popover";
import { cn } from "./lib/utils";

export interface ValueComboboxProps {
  value: string;
  options: string[];
  onChange: (value: string) => void;
  /** Called instead of `onChange` for a typed value that isn't an option.
   * Defaults to `onChange`. */
  onCreate?: (value: string) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyLabel?: string;
  createLabel?: (value: string) => string;
  /** Shown above the options while they load or fail to load. */
  status?: React.ReactNode;
  "aria-label"?: string;
  className?: string;
  monospace?: boolean;
}

/** A single-value combobox that lists known values and accepts a typed one. */
export function ValueCombobox({
  value,
  options,
  onChange,
  onCreate,
  placeholder = "Select…",
  searchPlaceholder = "Search…",
  emptyLabel = "No matches.",
  createLabel = (v) => `Use "${v}"`,
  status,
  "aria-label": ariaLabel,
  className,
  monospace,
}: ValueComboboxProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const typed = search.trim();
  const filtered = options.filter((option) =>
    option.toLowerCase().includes(typed.toLowerCase()),
  );
  const canCreate = typed !== "" && !options.includes(typed);

  function pick(next: string, created = false) {
    if (created && onCreate) onCreate(next);
    else onChange(next);
    setSearch("");
    setOpen(false);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          role="combobox"
          aria-expanded={open}
          aria-label={ariaLabel}
          className={cn(
            buttonVariants({ variant: "outline" }),
            "w-full justify-between font-normal",
            className,
          )}
        >
          <span
            className={cn(
              "truncate",
              monospace && value && "font-mono",
              !value && "text-muted-foreground",
            )}
          >
            {value || placeholder}
          </span>
          <ChevronDown className="size-4 shrink-0 opacity-50" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] min-w-64 p-0">
        <Command shouldFilter={false}>
          <CommandInput
            placeholder={searchPlaceholder}
            value={search}
            onValueChange={setSearch}
            onKeyDown={(event) => {
              if (event.key === "Enter" && canCreate) {
                event.preventDefault();
                pick(typed, true);
              }
            }}
          />
          <CommandList>
            {status}
            {!canCreate && <CommandEmpty>{emptyLabel}</CommandEmpty>}
            {canCreate && (
              <CommandGroup>
                <CommandItem
                  value={`create:${typed}`}
                  onSelect={() => pick(typed, true)}
                >
                  <PlusCircle className="size-4" />
                  {createLabel(typed)}
                </CommandItem>
              </CommandGroup>
            )}
            {filtered.length > 0 && (
              <CommandGroup>
                {filtered.map((option) => (
                  <CommandItem
                    key={option}
                    value={option}
                    onSelect={() => pick(option)}
                  >
                    <Check
                      className={cn(
                        "size-4",
                        option === value ? "opacity-100" : "opacity-0",
                      )}
                    />
                    <span className={cn(monospace && "font-mono")}>{option}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
