"use client";

import type { SequenceDeletionPreview } from "@sendlit/api-contract";
import { useEffect, useState } from "react";
import { DeleteConfirmationDialog } from "@/components/dashboard/delete-confirmation-dialog";
import { Loading } from "@/components/dashboard/loading";
import { deleteSequence, getSequenceDeletionPreview } from "@/lib/api";
import { ApiError } from "@/lib/api-client";

const ACTIVE_MESSAGE =
  "This sequence is active. Pause it before deleting it, so no contact is dropped mid-flow.";

function plural(count: number, one: string, many: string) {
  return `${count.toLocaleString()} ${count === 1 ? one : many}`;
}

/**
 * Confirms deleting a sequence. Shows how many contacts are enrolled and how
 * many emails it sent, because both go with it (ADR 0007), and refuses while
 * the sequence is active.
 */
export function DeleteSequenceDialog({
  sequence,
  onOpenChange,
  onDeleted,
}: {
  /** The sequence to delete; the dialog is open while this is set. */
  sequence: { sequenceId: string; title: string } | null;
  onOpenChange: (open: boolean) => void;
  onDeleted: () => Promise<void> | void;
}) {
  const sequenceId = sequence?.sequenceId;
  const [preview, setPreview] = useState<SequenceDeletionPreview | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    setPreview(null);
    setLoadError(null);
    if (!sequenceId) return;
    let cancelled = false;
    getSequenceDeletionPreview(sequenceId)
      .then((result) => {
        if (!cancelled) setPreview(result);
      })
      .catch((err) => {
        if (!cancelled) {
          setLoadError(
            err instanceof ApiError ? err.message : "Couldn't load this sequence.",
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [sequenceId]);

  const blocked = preview?.blocker === "sequence_active";
  const name = sequence?.title || "Untitled sequence";

  return (
    <DeleteConfirmationDialog
      open={sequence !== null}
      onOpenChange={onOpenChange}
      title={`Delete "${name}"?`}
      description="This permanently deletes the sequence, its emails and its trigger. It can't be undone."
      confirmLabel="Delete sequence"
      confirmDisabled={!preview || blocked}
      errorMessage={(error) =>
        error instanceof ApiError && error.message === "sequence_active"
          ? ACTIVE_MESSAGE
          : "Unable to delete this sequence. Please try again."
      }
      onConfirm={async () => {
        if (!sequenceId) return;
        await deleteSequence(sequenceId);
        await onDeleted();
      }}
    >
      {loadError ? (
        <p className="text-sm text-destructive" role="alert">
          {loadError}
        </p>
      ) : !preview ? (
        <Loading />
      ) : blocked ? (
        <p
          className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100"
          role="alert"
        >
          {ACTIVE_MESSAGE}
        </p>
      ) : (
        <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
          <li>
            {preview.enrolledCount > 0 ? (
              <>
                <span className="font-medium text-foreground">
                  {plural(preview.enrolledCount, "contact is", "contacts are")} enrolled
                </span>{" "}
                and will get no more of its emails. The contacts themselves are kept.
              </>
            ) : (
              "No contacts are enrolled."
            )}
          </li>
          <li>
            {preview.emailsSentCount > 0 ? (
              <>
                <span className="font-medium text-foreground">
                  Stats for{" "}
                  {plural(preview.emailsSentCount, "sent email", "sent emails")}
                </span>{" "}
                (deliveries, opens and clicks) are deleted and can't be recovered. To
                keep them, pause the sequence instead.
              </>
            ) : (
              "It hasn't sent any email, so no stats are lost."
            )}
          </li>
        </ul>
      )}
    </DeleteConfirmationDialog>
  );
}
