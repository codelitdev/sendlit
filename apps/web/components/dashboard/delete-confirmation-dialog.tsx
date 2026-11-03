"use client";

import { type ReactNode, useRef, useState } from "react";
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
  confirmDisabled = false,
  confirmVariant = "destructive",
  pendingLabel = "Deleting…",
  errorMessage,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => Promise<void> | void;
  title?: string;
  description?: string;
  confirmLabel?: string;
  /** Holds the confirm button, e.g. while the details below load. */
  confirmDisabled?: boolean;
  /** `primary` for reversible actions such as archiving. */
  confirmVariant?: "destructive" | "primary";
  /** Shown on the confirm button while `onConfirm` runs. */
  pendingLabel?: string;
  /** Explains a failed delete; defaults to a generic retry message. */
  errorMessage?: (error: unknown) => ReactNode;
  /** Details shown between the description and the buttons. */
  children?: ReactNode;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState<ReactNode>(null);

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
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        {children}
        {error && (
          <div className="text-sm text-destructive" role="alert">
            {error}
          </div>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel ref={cancelRef} disabled={isDeleting}>
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction
            variant={confirmVariant}
            disabled={isDeleting || confirmDisabled}
            onClick={async (event) => {
              event.preventDefault();
              setIsDeleting(true);
              setError(null);
              try {
                await onConfirm();
                onOpenChange(false);
              } catch (failure) {
                setError(
                  errorMessage?.(failure) ??
                    "Unable to delete this item. Please try again.",
                );
              } finally {
                setIsDeleting(false);
              }
            }}
          >
            {isDeleting ? pendingLabel : confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
