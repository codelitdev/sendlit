"use client";

import { useRef, useState } from "react";
import { ChevronDown, ChevronUp, Mail, Plus, Trash2 } from "lucide-react";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "./components/ui/alert-dialog";
import { Button, buttonVariants } from "./components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "./components/ui/dialog";
import { TemplateChooser } from "./template-chooser";
import { cn } from "./lib/utils";
import type { EmailTemplate, SequenceEmail } from "./types";
import type { SystemTemplateSummary } from "./template-chooser";

export interface SequenceEmailListProps {
    emails: SequenceEmail[];
    emailsOrder: string[];
    selectedEmailId?: string;
    onSelect: (emailId: string) => void;
    /** When provided, each row renders as a real `<a href>` (built from this
     * function) instead of a plain clickable `<div>` — enabling native link
     * behaviors like ctrl/cmd-click to open in a new tab. `onSelect` still
     * fires on a plain click. */
    getEmailHref?: (email: SequenceEmail) => string;
    /** Called with the chosen template's id once the user picks one from the "Add email" template chooser. */
    onAdd: (templateId: string) => void;
    onDelete: (emailId: string) => void;
    /** Called with the full reordered list of email ids when the user moves a
     * step up/down. Omit to hide the reordering controls (e.g. for broadcasts,
     * which only ever have one email). */
    onReorder?: (emailsOrder: string[]) => void;
    systemTemplates: SystemTemplateSummary[];
    templates: EmailTemplate[];
    templatesLoading?: boolean;
    addButtonLabel?: string;
    dialogTitle?: string;
    dialogDescription?: string;
    /** aria-label for each row's delete (trash) button. */
    deleteButtonLabel?: string;
    deleteDialogTitle?: string;
    /** Called with the email pending deletion to build the confirmation copy. */
    deleteDialogDescription?: (email: SequenceEmail | undefined) => string;
    deleteCancelLabel?: string;
    deleteConfirmLabel?: string;
    moveUpLabel?: string;
    moveDownLabel?: string;
    untitledEmailLabel?: string;
    publishedLabel?: string;
    draftLabel?: string;
    emptyMessage?: string;
    formatDelay?: (ms: number) => string;
    className?: string;
}

function defaultFormatDelay(ms: number): string {
    if (ms <= 0) return "Immediately";
    const days = ms / 86400000;
    return `${days % 1 === 0 ? days : days.toFixed(1)} day${days === 1 ? "" : "s"} later`;
}

function defaultDeleteDialogDescription(email: SequenceEmail | undefined) {
    const subject = email?.subject?.trim();
    return subject
        ? `This will permanently delete "${subject}". This action cannot be undone.`
        : "This will permanently delete this email. This action cannot be undone.";
}

function swap(order: string[], index: number, direction: -1 | 1): string[] {
    const next = [...order];
    const target = index + direction;
    [next[index], next[target]] = [next[target], next[index]];
    return next;
}

/** Lists the steps of a sequence in order, letting you pick one to edit,
 * reorder (move up/down) and delete. "Add email" opens a template chooser;
 * picking a template calls `onAdd(templateId)`. Deleting asks for
 * confirmation via an alert dialog before calling `onDelete(emailId)`. */
export function SequenceEmailList({
    emails,
    emailsOrder,
    selectedEmailId,
    onSelect,
    getEmailHref,
    onAdd,
    onDelete,
    onReorder,
    systemTemplates,
    templates,
    templatesLoading,
    addButtonLabel = "Add email",
    dialogTitle = "Choose a template",
    dialogDescription = "Pick a starting point for the new email.",
    deleteButtonLabel = "Delete email",
    deleteDialogTitle = "Delete email?",
    deleteDialogDescription = defaultDeleteDialogDescription,
    deleteCancelLabel = "Cancel",
    deleteConfirmLabel = "Delete",
    moveUpLabel = "Move up",
    moveDownLabel = "Move down",
    untitledEmailLabel = "Untitled email",
    publishedLabel = "Published",
    draftLabel = "Draft",
    emptyMessage = "No emails yet.",
    formatDelay = defaultFormatDelay,
    className,
}: SequenceEmailListProps) {
    const [addOpen, setAddOpen] = useState(false);
    const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
    const cancelRef = useRef<HTMLButtonElement>(null);
    const ordered = emailsOrder
        .map((id) => emails.find((e) => e.emailId === id))
        .filter((e): e is SequenceEmail => Boolean(e));
    const emailPendingDelete = emails.find(
        (email) => email.emailId === pendingDeleteId,
    );

    return (
        <div className={cn("space-y-2", className)}>
            {ordered.map((email, index) => {
                const href = getEmailHref?.(email);
                const Row = href ? "a" : "div";
                return (
                    <Row
                        key={email.emailId}
                        {...(href ? { href } : {})}
                        onClick={() => onSelect(email.emailId)}
                        className={cn(
                            "flex cursor-pointer items-center gap-3 rounded-lg border p-3 text-sm no-underline transition-colors hover:bg-accent",
                            selectedEmailId === email.emailId &&
                                "border-primary bg-accent",
                        )}
                    >
                        <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium">
                            {index + 1}
                        </div>
                        <div className="min-w-0 flex-1">
                            <p className="truncate font-medium">
                                {email.subject || untitledEmailLabel}
                            </p>
                            <p className="truncate text-xs text-muted-foreground">
                                {formatDelay(email.delayInMillis)}
                                {" · "}
                                {email.published ? publishedLabel : draftLabel}
                            </p>
                        </div>
                        {onReorder && ordered.length > 1 && (
                            <div className="flex flex-col">
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    className="size-6"
                                    disabled={index === 0}
                                    onClick={(e) => {
                                        e.preventDefault();
                                        e.stopPropagation();
                                        onReorder(swap(emailsOrder, index, -1));
                                    }}
                                    aria-label={moveUpLabel}
                                >
                                    <ChevronUp className="size-3.5" />
                                </Button>
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    className="size-6"
                                    disabled={index === ordered.length - 1}
                                    onClick={(e) => {
                                        e.preventDefault();
                                        e.stopPropagation();
                                        onReorder(swap(emailsOrder, index, 1));
                                    }}
                                    aria-label={moveDownLabel}
                                >
                                    <ChevronDown className="size-3.5" />
                                </Button>
                            </div>
                        )}
                        {ordered.length > 1 && (
                            <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                onClick={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    setPendingDeleteId(email.emailId);
                                }}
                                aria-label={deleteButtonLabel}
                            >
                                <Trash2 className="size-4" />
                            </Button>
                        )}
                    </Row>
                );
            })}

            {ordered.length === 0 && (
                <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                    <Mail className="size-5" />
                    {emptyMessage}
                </div>
            )}

            <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setAddOpen(true)}
            >
                <Plus className="size-4" />
                {addButtonLabel}
            </Button>

            <Dialog open={addOpen} onOpenChange={setAddOpen}>
                <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-4xl">
                    <DialogHeader>
                        <DialogTitle>{dialogTitle}</DialogTitle>
                        <DialogDescription>
                            {dialogDescription}
                        </DialogDescription>
                    </DialogHeader>
                    <TemplateChooser
                        systemTemplates={systemTemplates}
                        templates={templates}
                        loading={templatesLoading}
                        onSelect={({ templateId }) => {
                            onAdd(templateId);
                            setAddOpen(false);
                        }}
                    />
                </DialogContent>
            </Dialog>

            <AlertDialog
                open={pendingDeleteId !== null}
                onOpenChange={(open) => {
                    if (!open) setPendingDeleteId(null);
                }}
            >
                <AlertDialogContent
                    onOpenAutoFocus={(event) => {
                        event.preventDefault();
                        cancelRef.current?.focus();
                    }}
                >
                    <AlertDialogHeader>
                        <div className="flex items-center gap-3">
                            <AlertDialogTitle>
                                {deleteDialogTitle}
                            </AlertDialogTitle>
                        </div>
                        <AlertDialogDescription>
                            {deleteDialogDescription(emailPendingDelete)}
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel
                            ref={cancelRef}
                            onClick={() => setPendingDeleteId(null)}
                        >
                            {deleteCancelLabel}
                        </AlertDialogCancel>
                        <AlertDialogAction
                            className={buttonVariants({
                                variant: "destructive",
                            })}
                            onClick={() => {
                                if (pendingDeleteId) onDelete(pendingDeleteId);
                                setPendingDeleteId(null);
                            }}
                        >
                            {deleteConfirmLabel}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
}
