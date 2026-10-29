"use client";

import { DeleteConfirmationDialog } from "@/components/dashboard/delete-confirmation-dialog";
import { archiveBroadcast } from "@/lib/api";
import { ApiError } from "@/lib/api-client";

const ERRORS: Record<string, string> = {
  broadcast_not_sent:
    "Only a sent broadcast can be archived. Delete a draft or scheduled broadcast instead.",
  sequence_active: "This broadcast is sending. Pause it before archiving it.",
};

/**
 * Confirms archiving a sent broadcast (ADR 0008): it leaves the list and the
 * public web archive, and keeps its report. Unarchiving restores it.
 */
export function ArchiveBroadcastDialog({
  broadcast,
  onOpenChange,
  onArchived,
}: {
  /** The broadcast to archive; the dialog is open while this is set. */
  broadcast: { sequenceId: string; title: string } | null;
  onOpenChange: (open: boolean) => void;
  onArchived: () => Promise<void> | void;
}) {
  const name = broadcast?.title || "Untitled broadcast";
  return (
    <DeleteConfirmationDialog
      open={broadcast !== null}
      onOpenChange={onOpenChange}
      title={`Archive "${name}"?`}
      description="It leaves the broadcasts list and your public web archive. You can unarchive it at any time."
      confirmLabel="Archive broadcast"
      confirmVariant="primary"
      pendingLabel="Archiving…"
      errorMessage={(error) =>
        error instanceof ApiError && error.message in ERRORS
          ? ERRORS[error.message]
          : "Unable to archive this broadcast. Please try again."
      }
      onConfirm={async () => {
        if (!broadcast) return;
        await archiveBroadcast(broadcast.sequenceId);
        await onArchived();
      }}
    >
      <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
        <li>Its report, delivery history and images are kept.</li>
        <li>
          &quot;View in browser&quot; links in the emails already sent keep working.
        </li>
        <li>
          To find it again, pick{" "}
          <span className="font-medium text-foreground">Archived</span> in the
          broadcasts list.
        </li>
      </ul>
    </DeleteConfirmationDialog>
  );
}
