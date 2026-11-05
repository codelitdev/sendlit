"use client";

import type { Sequence } from "@sendlit/email-blocks";
import { CloudUpload, History, Undo2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { DeleteConfirmationDialog } from "@/components/dashboard/delete-confirmation-dialog";
import { EmailVersionHistoryDialog } from "@/components/dashboard/email-version-history-dialog";
import {
  emailsWithChanges,
  PublishChangesDialog,
  UnpublishedChangesBadge,
} from "@/components/dashboard/publish-changes-dialog";
import { Button } from "@/components/ui/codelit/button";
import { discardSequenceChanges } from "@/lib/api";

/**
 * "Unpublished changes" with Discard and Publish for a started broadcast or
 * sequence, or for some of its emails (`emailIds`). Renders nothing when
 * they have no unpublished changes.
 */
export function UnpublishedChangesActions({
  sequence,
  emailIds,
  size,
  beforePublish,
  onChange,
}: {
  sequence: Sequence;
  emailIds?: string[];
  size?: "sm";
  /** Runs before the publish dialog opens, e.g. to save the editor. */
  beforePublish?: () => Promise<Sequence | undefined>;
  onChange: (sequence: Sequence) => void;
}) {
  const [publishing, setPublishing] = useState<Sequence | null>(null);
  const [discarding, setDiscarding] = useState(false);
  const changed = emailsWithChanges(sequence, emailIds);
  if (changed.length === 0 && !publishing) return null;

  return (
    <>
      <UnpublishedChangesBadge />
      <Button size={size} variant="outline" onClick={() => setDiscarding(true)}>
        <Undo2 className="size-4" />
        Discard changes
      </Button>
      <Button
        size={size}
        onClick={async () => setPublishing((await beforePublish?.()) ?? sequence)}
      >
        <CloudUpload className="size-4" />
        Publish changes
      </Button>
      <PublishChangesDialog
        sequence={publishing}
        emailIds={emailIds}
        onOpenChange={(open) => !open && setPublishing(null)}
        onPublished={onChange}
      />
      <DeleteConfirmationDialog
        open={discarding}
        onOpenChange={setDiscarding}
        title="Discard unpublished changes?"
        description={`The draft of ${
          changed.length === 1
            ? `"${changed[0].draft?.subject || "this email"}"`
            : `${changed.length} emails`
        } is deleted and the editor shows the published version again. Contacts aren't affected.`}
        confirmLabel="Discard changes"
        pendingLabel="Discarding…"
        onConfirm={async () => {
          onChange(await discardSequenceChanges(sequence.sequenceId, emailIds));
          setDiscarding(false);
          toast.success("Unpublished changes discarded.");
        }}
      />
    </>
  );
}

/** Opens an email's version history, once its broadcast or sequence has
 * started (before that, nothing has been published). */
export function VersionHistoryButton({
  sequence,
  emailId,
  onChange,
}: {
  sequence: Sequence;
  emailId: string;
  onChange: (sequence: Sequence) => void;
}) {
  const [open, setOpen] = useState(false);
  if (sequence.status === "draft") return null;
  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        <History className="size-4" />
        Version history
      </Button>
      <EmailVersionHistoryDialog
        sequence={sequence}
        emailId={open ? emailId : null}
        onOpenChange={setOpen}
        onRestored={onChange}
      />
    </>
  );
}
