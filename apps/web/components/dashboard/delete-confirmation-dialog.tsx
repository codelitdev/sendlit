"use client";

import { useRef, useState } from "react";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export function DeleteConfirmationDialog({
    open,
    onOpenChange,
    onConfirm,
    title = "Delete this item?",
    description = "This action cannot be undone.",
    confirmLabel = "Delete",
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onConfirm: () => Promise<void> | void;
    title?: string;
    description?: string;
    confirmLabel?: string;
}) {
    const cancelRef = useRef<HTMLButtonElement>(null);
    const [isDeleting, setIsDeleting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    return (
        <AlertDialog
            open={open}
            onOpenChange={(nextOpen) => {
                if (!nextOpen && !isDeleting) {
                    setError(null);
                    onOpenChange(false);
                }
            }}
        >
            <AlertDialogContent
                onOpenAutoFocus={(event) => {
                    event.preventDefault();
                    cancelRef.current?.focus();
                }}
            >
                <AlertDialogHeader>
                    <AlertDialogTitle>{title}</AlertDialogTitle>
                    <AlertDialogDescription>
                        {description}
                    </AlertDialogDescription>
                </AlertDialogHeader>
                {error && (
                    <p className="text-sm text-destructive" role="alert">
                        {error}
                    </p>
                )}
                <AlertDialogFooter>
                    <AlertDialogCancel ref={cancelRef} disabled={isDeleting}>
                        Cancel
                    </AlertDialogCancel>
                    <AlertDialogAction
                        variant="destructive"
                        disabled={isDeleting}
                        onClick={async (event) => {
                            event.preventDefault();
                            setIsDeleting(true);
                            setError(null);
                            try {
                                await onConfirm();
                                onOpenChange(false);
                            } catch {
                                setError(
                                    "Unable to delete this item. Please try again.",
                                );
                            } finally {
                                setIsDeleting(false);
                            }
                        }}
                    >
                        {isDeleting ? "Deleting…" : confirmLabel}
                    </AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
}
