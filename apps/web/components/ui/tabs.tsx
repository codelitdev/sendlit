"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

type TabsContextValue = {
    value: string;
    setValue: (value: string) => void;
};

const TabsContext = React.createContext<TabsContextValue | null>(null);

function useTabs() {
    const context = React.useContext(TabsContext);
    if (!context) {
        throw new Error("Tabs components must be used within Tabs.");
    }
    return context;
}

function Tabs({
    className,
    defaultValue,
    value: controlledValue,
    onValueChange,
    ...props
}: React.ComponentProps<"div"> & {
    defaultValue: string;
    value?: string;
    onValueChange?: (value: string) => void;
}) {
    const [internalValue, setInternalValue] = React.useState(defaultValue);
    const value = controlledValue ?? internalValue;
    const setValue = React.useCallback(
        (nextValue: string) => {
            if (onValueChange) {
                onValueChange(nextValue);
            } else {
                setInternalValue(nextValue);
            }
        },
        [onValueChange],
    );

    return (
        <TabsContext.Provider value={{ value, setValue }}>
            <div
                data-slot="tabs"
                className={cn("flex flex-col gap-4", className)}
                {...props}
            />
        </TabsContext.Provider>
    );
}

function TabsList({ className, ...props }: React.ComponentProps<"div">) {
    return (
        <div
            data-slot="tabs-list"
            role="tablist"
            className={cn(
                "inline-flex h-9 w-fit items-center justify-center rounded-md bg-muted p-1 text-muted-foreground",
                className,
            )}
            {...props}
        />
    );
}

function TabsTrigger({
    className,
    value,
    children,
    ...props
}: React.ComponentProps<"button"> & { value: string }) {
    const tabs = useTabs();
    const active = tabs.value === value;

    return (
        <button
            type="button"
            data-slot="tabs-trigger"
            role="tab"
            aria-selected={active}
            data-state={active ? "active" : "inactive"}
            className={cn(
                "inline-flex h-7 items-center justify-center gap-1.5 whitespace-nowrap rounded-sm px-3 text-sm font-medium transition-all disabled:pointer-events-none disabled:opacity-50 data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] focus-visible:outline-none",
                className,
            )}
            onClick={() => tabs.setValue(value)}
            {...props}
        >
            {children}
        </button>
    );
}

function TabsContent({
    className,
    value,
    ...props
}: React.ComponentProps<"div"> & { value: string }) {
    const tabs = useTabs();
    if (tabs.value !== value) return null;

    return (
        <div
            data-slot="tabs-content"
            role="tabpanel"
            data-state="active"
            className={cn("outline-none", className)}
            {...props}
        />
    );
}

export { Tabs, TabsContent, TabsList, TabsTrigger };
