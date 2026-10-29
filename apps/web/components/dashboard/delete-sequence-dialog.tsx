"use client";

import type { SequenceDeletionPreview } from "@sendlit/api-contract";
import { Archive } from "lucide-react";
import { useEffect, useState } from "react";
import { DeleteConfirmationDialog } from "@/components/dashboard/delete-confirmation-dialog";
import { Loading } from "@/components/dashboard/loading";
import { Button } from "@/components/ui/codelit/button";
import { deleteSequence, getSequenceDeletionPreview } from "@/lib/api";
import { ApiError } from "@/lib/api-client";

type Blocker = NonNullable<SequenceDeletionPreview["blocker"]>;

const BLOCKER_MESSAGES: Record<"sequence" | "broadcast", Record<Blocker, string>> = {
  sequence: {
    sequence_active:
      "This sequence is active. Pause it before deleting it, so no contact is dropped mid-flow.",
    broadcast_sent: "",
  },
  broadcast: {
    sequence_active: "This broadcast is sending. Pause it before deleting it.",
    broadcast_sent:
      "This broadcast has been sent, so it can't be deleted: its report would be lost. Archive it instead. It leaves the list and the web archive, and its report is kept.",
  },
};

function plural(count: number, one: string, many: string) {
  return `${count.toLocaleString()} ${count === 1 ? one : many}`;
}

/**
 * Confirms deleting a sequence or broadcast. For a sequence it shows how many
 * contacts are enrolled and how many emails it sent, because both go with it
 * (ADR 0007), and refuses while the sequence is active. A broadcast can only
 * be deleted before it starts sending; a sent one is archived instead
 * (ADR 0008), which `onArchiveInstead` offers.
 */
export function DeleteSequenceDialog({
  sequence,
  type = "sequence",
  onOpenChange,
  onDeleted,
  onArchiveInstead,
}: {
  /** The sequence to delete; the dialog is open while this is set. */
  sequence: { sequenceId: string; title: string } | null;
  type?: "sequence" | "broadcast";
  onOpenChange: (open: boolean) => void;
  onDeleted: () => Promise<void> | void;
  /** Offered when a sent broadcast can't be deleted. */
  onArchiveInstead?: () => void;
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
            err instanceof ApiError ? err.message : `Couldn't load this ${type}.`,
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [sequenceId, type]);

  const blocker = preview?.blocker ?? null;
  const messages = BLOCKER_MESSAGES[type];
  const name = sequence?.title || `Untitled ${type}`;

  return (
    <DeleteConfirmationDialog
      open={sequence !== null}
      onOpenChange={onOpenChange}
      title={`Delete "${name}"?`}
      description={
        type === "broadcast"
          ? "This permanently deletes the broadcast and its email. It can't be undone."
          : "This permanently deletes the sequence, its emails and its trigger. It can't be undone."
      }
      confirmLabel={`Delete ${type}`}
      confirmDisabled={!preview || blocker !== null}
      errorMessage={(error) =>
        error instanceof ApiError && error.message in messages
          ? messages[error.message as Blocker]
          : `Unable to delete this ${type}. Please try again.`
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
      ) : blocker ? (
        <div
          className="space-y-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100"
          role="alert"
        >
          <p>{messages[blocker]}</p>
          {blocker === "broadcast_sent" && onArchiveInstead && (
            <Button size="sm" variant="outline" onClick={onArchiveInstead}>
              <Archive className="size-4" />
              Archive instead
            </Button>
          )}
        </div>
      ) : type === "broadcast" ? (
        <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
          <li>
            {preview.status === "active"
              ? "Its scheduled send is cancelled. Nobody gets it."
              : "It hasn't been sent, so no report is lost."}
          </li>
          <li>Images only this broadcast uses are deleted from the media library.</li>
        </ul>
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
                keep them, leave the sequence paused instead; it sends nothing.
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
