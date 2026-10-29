"use client";

import type { ContactDeletion } from "@sendlit/api-contract";
import { useEffect, useId, useState } from "react";
import { DeleteConfirmationDialog } from "@/components/dashboard/delete-confirmation-dialog";
import { Loading } from "@/components/dashboard/loading";
import { Input } from "@/components/ui/codelit/input";
import { Label } from "@/components/ui/codelit/label";
import {
  type ContactSelection,
  deleteContacts,
  previewContactDeletion,
} from "@/lib/api";
import { ApiError } from "@/lib/api-client";

/** Deleting more contacts than this asks for the count to be typed, as does
 * every "all matching" selection. */
export const TYPED_CONFIRMATION_THRESHOLD = 100;

function plural(count: number, word: string) {
  return `${count.toLocaleString()} ${word}${count === 1 ? "" : "s"}`;
}

/**
 * Confirms a bulk contact delete. It previews the live count first, asks
 * for that number to be typed when it is large, and sends it as
 * `expectedCount` so nothing is deleted if the selection changed meanwhile.
 */
export function DeleteContactsDialog({
  selection,
  onOpenChange,
  onDeleted,
}: {
  /** The contacts to delete; the dialog is open while this is set. */
  selection: ContactSelection | null;
  onOpenChange: (open: boolean) => void;
  onDeleted: (deletion: ContactDeletion) => void;
}) {
  const inputId = useId();
  const [preview, setPreview] = useState<{
    count: number;
    unsubscribed: number;
  } | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [typed, setTyped] = useState("");

  useEffect(() => {
    setPreview(null);
    setPreviewError(null);
    setTyped("");
    if (!selection) return;
    let cancelled = false;
    previewContactDeletion(selection)
      .then((result) => {
        if (!cancelled) setPreview(result);
      })
      .catch((error) => {
        if (!cancelled) {
          setPreviewError(
            error instanceof ApiError ? error.message : "Unable to count the contacts",
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [selection]);

  const count = preview?.count ?? 0;
  // "All matching" can reach contacts on pages nobody looked at.
  const needsTyping =
    (selection !== null && "match" in selection) || count > TYPED_CONFIRMATION_THRESHOLD;
  const title = preview ? `Delete ${plural(count, "contact")}?` : "Delete contacts?";

  return (
    <DeleteConfirmationDialog
      open={selection !== null}
      onOpenChange={onOpenChange}
      title={title}
      description="Their tags, custom fields, sequence progress and delivery history are deleted too, and no sequences are triggered. Suppressions are kept. This can’t be undone."
      confirmLabel={preview ? `Delete ${plural(count, "contact")}` : "Delete"}
      confirmDisabled={
        !preview || count === 0 || (needsTyping && typed.trim() !== String(count))
      }
      errorMessage={(error) => {
        if (error instanceof ApiError && error.message === "count_changed") {
          return "The matching contacts changed. Check the new count and confirm again.";
        }
        return error instanceof ApiError
          ? error.message
          : "Unable to delete these contacts. Please try again.";
      }}
      onConfirm={async () => {
        if (!selection || !preview) return;
        try {
          onDeleted(await deleteContacts(selection, preview.count));
        } catch (error) {
          // Show the new count so the next confirmation matches it.
          if (error instanceof ApiError && error.message === "count_changed") {
            setPreview(await previewContactDeletion(selection));
            setTyped("");
          }
          throw error;
        }
      }}
    >
      {previewError ? (
        <p className="text-sm text-destructive" role="alert">
          {previewError}
        </p>
      ) : !preview ? (
        <Loading className="py-6" />
      ) : (
        <div className="space-y-3 text-sm">
          {preview.unsubscribed > 0 && (
            <p className="text-muted-foreground">
              {preview.unsubscribed.toLocaleString()} of them{" "}
              {preview.unsubscribed === 1 ? "is" : "are"} unsubscribed. Their addresses
              are added to the suppression list so they’re never mailed again, even if
              re-imported.
            </p>
          )}
          {count > 1000 && (
            <p className="text-muted-foreground">
              This runs in the background. You can keep working while it finishes.
            </p>
          )}
          {needsTyping && (
            <div className="space-y-1.5">
              <Label htmlFor={inputId}>
                Type <span className="font-mono font-semibold">{count}</span> to confirm
              </Label>
              <Input
                id={inputId}
                autoComplete="off"
                inputMode="numeric"
                value={typed}
                onChange={(event) => setTyped(event.target.value)}
              />
            </div>
          )}
        </div>
      )}
    </DeleteConfirmationDialog>
  );
}
