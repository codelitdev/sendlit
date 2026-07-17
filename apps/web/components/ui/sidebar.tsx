"use client";

import * as React from "react";
import { PanelLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

type SidebarContextValue = {
    open: boolean;
    setOpen: React.Dispatch<React.SetStateAction<boolean>>;
    openMobile: boolean;
    setOpenMobile: React.Dispatch<React.SetStateAction<boolean>>;
    isMobile: boolean;
    toggleSidebar: () => void;
};

const SidebarContext = React.createContext<SidebarContextValue | null>(null);

function useIsMobile() {
    const [isMobile, setIsMobile] = React.useState(false);

    React.useEffect(() => {
        const media = window.matchMedia("(max-width: 767px)");
        const update = () => setIsMobile(media.matches);
        update();
        media.addEventListener("change", update);
        return () => media.removeEventListener("change", update);
    }, []);

    return isMobile;
}

function useSidebar() {
    const context = React.useContext(SidebarContext);
    if (!context) {
        throw new Error("useSidebar must be used within a SidebarProvider.");
    }
    return context;
}

function SidebarProvider({
    defaultOpen = true,
    open: controlledOpen,
    onOpenChange,
    className,
    style,
    children,
    ...props
}: React.ComponentProps<"div"> & {
    defaultOpen?: boolean;
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
}) {
    const [_open, _setOpen] = React.useState(defaultOpen);
    const [openMobile, setOpenMobile] = React.useState(false);
    const isMobile = useIsMobile();
    const open = controlledOpen ?? _open;
    const setOpen = React.useCallback(
        (value: React.SetStateAction<boolean>) => {
            const nextOpen = typeof value === "function" ? value(open) : value;
            if (onOpenChange) {
                onOpenChange(nextOpen);
            } else {
                _setOpen(nextOpen);
            }
        },
        [onOpenChange, open],
    );
    const toggleSidebar = React.useCallback(() => {
        if (isMobile) {
            setOpenMobile((value) => !value);
            return;
        }
        setOpen((value) => !value);
    }, [isMobile, setOpen]);

    React.useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            if (
                event.key !== "b" ||
                (!event.metaKey && !event.ctrlKey) ||
                event.altKey
            ) {
                return;
            }

            const target = event.target as HTMLElement | null;
            if (
                target?.closest(
                    'input, textarea, select, [contenteditable="true"]',
                )
            ) {
                return;
            }

            event.preventDefault();
            toggleSidebar();
        };
        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [toggleSidebar]);

    const contextValue = React.useMemo<SidebarContextValue>(
        () => ({
            open,
            setOpen,
            openMobile,
            setOpenMobile,
            isMobile,
            toggleSidebar,
        }),
        [open, setOpen, openMobile, isMobile, toggleSidebar],
    );

    return (
        <SidebarContext.Provider value={contextValue}>
            <div
                data-slot="sidebar-wrapper"
                data-sidebar-state={open ? "expanded" : "collapsed"}
                style={
                    {
                        "--sidebar-width": "18rem",
                        "--sidebar-width-icon": "3.5rem",
                        ...style,
                    } as React.CSSProperties
                }
                className={cn(
                    "group/sidebar-wrapper flex min-h-svh w-full has-[[data-variant=inset]]:bg-sidebar",
                    className,
                )}
                {...props}
            >
                {children}
            </div>
        </SidebarContext.Provider>
    );
}

function Sidebar({
    side = "left",
    variant = "sidebar",
    collapsible = "offcanvas",
    className,
    children,
    ...props
}: React.ComponentProps<"div"> & {
    side?: "left" | "right";
    variant?: "sidebar" | "floating" | "inset";
    collapsible?: "offcanvas" | "icon" | "none";
}) {
    const { open, openMobile, setOpenMobile, isMobile } = useSidebar();

    if (isMobile) {
        return (
            <Sheet open={openMobile} onOpenChange={setOpenMobile}>
                <SheetContent
                    side={side}
                    className={cn(
                        "w-[--sidebar-width] max-w-[85vw] gap-0 bg-sidebar p-0 text-sidebar-foreground",
                        className,
                    )}
                    {...props}
                >
                    <SheetTitle className="sr-only">Navigation</SheetTitle>
                    <div
                        data-sidebar="sidebar"
                        data-slot="sidebar-inner"
                        className="flex h-full w-full flex-col bg-sidebar pr-8"
                    >
                        {children}
                    </div>
                </SheetContent>
            </Sheet>
        );
    }

    return (
        <div
            className="group peer hidden text-sidebar-foreground md:block"
            data-state={open ? "expanded" : "collapsed"}
            data-collapsible={open ? "" : collapsible}
            data-variant={variant}
            data-side={side}
            data-slot="sidebar"
        >
            <div
                data-slot="sidebar-gap"
                className={cn(
                    "relative w-[--sidebar-width] bg-transparent transition-[width] duration-200 ease-linear",
                    "group-data-[collapsible=icon]:w-[--sidebar-width-icon]",
                    "group-data-[collapsible=offcanvas]:w-0",
                )}
            />
            <div
                data-slot="sidebar-container"
                className={cn(
                    "fixed inset-y-0 z-10 hidden h-svh w-[--sidebar-width] transition-[left,right,width] duration-200 ease-linear md:flex",
                    side === "left"
                        ? "left-0 group-data-[collapsible=offcanvas]:left-[calc(var(--sidebar-width)*-1)]"
                        : "right-0 group-data-[collapsible=offcanvas]:right-[calc(var(--sidebar-width)*-1)]",
                    "group-data-[collapsible=icon]:w-[--sidebar-width-icon]",
                    className,
                )}
                {...props}
            >
                <div
                    data-sidebar="sidebar"
                    data-slot="sidebar-inner"
                    className="flex h-full w-full flex-col bg-sidebar"
                >
                    {children}
                </div>
            </div>
        </div>
    );
}

function SidebarInset({ className, ...props }: React.ComponentProps<"main">) {
    return (
        <main
            data-slot="sidebar-inset"
            className={cn(
                "relative flex min-h-svh flex-1 flex-col overflow-hidden bg-background",
                className,
            )}
            {...props}
        />
    );
}

function SidebarTrigger({
    className,
    onClick,
    ...props
}: React.ComponentProps<typeof Button>) {
    const { toggleSidebar } = useSidebar();

    return (
        <Button
            data-slot="sidebar-trigger"
            variant="ghost"
            size="icon"
            className={cn("size-7", className)}
            onClick={(event) => {
                onClick?.(event);
                toggleSidebar();
            }}
            aria-label="Toggle navigation"
            {...props}
        >
            <PanelLeft className="size-4" />
            <span className="sr-only">Toggle Sidebar</span>
        </Button>
    );
}

function SidebarRail({ className, ...props }: React.ComponentProps<"button">) {
    const { toggleSidebar } = useSidebar();

    return (
        <button
            data-slot="sidebar-rail"
            aria-label="Toggle Sidebar"
            tabIndex={-1}
            onClick={toggleSidebar}
            title="Toggle Sidebar"
            className={cn(
                "absolute inset-y-0 z-20 hidden w-4 -translate-x-1/2 transition-all ease-linear after:absolute after:inset-y-0 after:left-1/2 after:w-[2px] hover:after:bg-sidebar-border group-data-[side=left]:-right-4 group-data-[side=right]:left-0 sm:flex",
                className,
            )}
            {...props}
        />
    );
}

function SidebarHeader({ className, ...props }: React.ComponentProps<"div">) {
    return (
        <div
            data-slot="sidebar-header"
            className={cn("flex flex-col gap-2 p-2", className)}
            {...props}
        />
    );
}

function SidebarFooter({ className, ...props }: React.ComponentProps<"div">) {
    return (
        <div
            data-slot="sidebar-footer"
            className={cn("mt-auto flex flex-col gap-2 p-2", className)}
            {...props}
        />
    );
}

function SidebarContent({ className, ...props }: React.ComponentProps<"div">) {
    return (
        <div
            data-slot="sidebar-content"
            className={cn(
                "flex min-h-0 flex-1 flex-col gap-2 overflow-auto group-data-[collapsible=icon]:overflow-hidden",
                className,
            )}
            {...props}
        />
    );
}

function SidebarGroup({ className, ...props }: React.ComponentProps<"div">) {
    return (
        <div
            data-slot="sidebar-group"
            className={cn(
                "relative flex w-full min-w-0 flex-col p-2",
                "group-data-[collapsible=icon]:p-0",
                className,
            )}
            {...props}
        />
    );
}

function SidebarGroupLabel({
    className,
    ...props
}: React.ComponentProps<"div">) {
    return (
        <div
            data-slot="sidebar-group-label"
            className={cn(
                "flex h-8 shrink-0 items-center rounded-md px-2 text-xs font-medium text-sidebar-foreground/70 group-data-[collapsible=icon]:hidden",
                className,
            )}
            {...props}
        />
    );
}

function SidebarMenu({ className, ...props }: React.ComponentProps<"ul">) {
    return (
        <ul
            data-slot="sidebar-menu"
            className={cn("flex w-full min-w-0 flex-col gap-1", className)}
            {...props}
        />
    );
}

function SidebarMenuItem({ className, ...props }: React.ComponentProps<"li">) {
    return (
        <li
            data-slot="sidebar-menu-item"
            className={cn(
                "group/menu-item relative group-data-[collapsible=icon]:flex group-data-[collapsible=icon]:justify-center",
                className,
            )}
            {...props}
        />
    );
}

function SidebarMenuButton({
    asChild = false,
    isActive = false,
    className,
    ...props
}: React.ComponentProps<"button"> & {
    asChild?: boolean;
    isActive?: boolean;
}) {
    const Comp = asChild ? SlotClone : "button";

    return (
        <Comp
            data-slot="sidebar-menu-button"
            data-active={isActive}
            className={cn(
                "flex h-8 w-full items-center gap-2 overflow-hidden rounded-md px-2 text-left text-sm outline-none transition-[width,height,padding] hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring active:bg-sidebar-accent active:text-sidebar-accent-foreground disabled:pointer-events-none disabled:opacity-50 data-[active=true]:bg-sidebar-accent data-[active=true]:font-medium data-[active=true]:text-sidebar-accent-foreground [&>span:last-child]:truncate [&>svg]:size-4 [&>svg]:shrink-0",
                "group-data-[collapsible=icon]:size-8 group-data-[collapsible=icon]:w-8 group-data-[collapsible=icon]:p-2 group-data-[collapsible=icon]:[&>span]:hidden",
                className,
            )}
            {...props}
        />
    );
}

function SlotClone({
    children,
    className,
    ...props
}: React.ComponentProps<"button">) {
    if (!React.isValidElement(children)) return null;
    return React.cloneElement(children, {
        ...props,
        className: cn(
            (children.props as { className?: string }).className,
            className,
        ),
    } as React.HTMLAttributes<HTMLElement>);
}

export {
    Sidebar,
    SidebarContent,
    SidebarFooter,
    SidebarGroup,
    SidebarGroupLabel,
    SidebarHeader,
    SidebarInset,
    SidebarMenu,
    SidebarMenuButton,
    SidebarMenuItem,
    SidebarProvider,
    SidebarRail,
    SidebarTrigger,
    useSidebar,
};
