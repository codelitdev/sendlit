"use client";

import type { Sequence } from "@sendlit/email-blocks";
import { CloudUpload, History, MoreHorizontal, Undo2 } from "lucide-react";
import { type ReactNode, useState } from "react";
import { toast } from "sonner";
import { Banner } from "@/components/dashboard/banner";
import { DeleteConfirmationDialog } from "@/components/dashboard/delete-confirmation-dialog";
import { EmailVersionHistoryDialog } from "@/components/dashboard/email-version-history-dialog";
import {
  emailsWithChanges,
  PublishChangesDialog,
} from "@/components/dashboard/publish-changes-dialog";
import { Button } from "@/components/ui/codelit/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/codelit/dropdown-menu";
import { IconButton } from "@/components/ui/codelit/icon-button";
import { discardSequenceChanges } from "@/lib/api";

interface DraftTarget {
  sequence: Sequence;
  /** Some of its emails; all of them when unset. */
  emailIds?: string[];
  onChange: (sequence: Sequence) => void;
}

/** The publish and discard dialogs, and functions that open them. */
function useDraftDialogs({
  sequence,
  emailIds,
  onChange,
  beforePublish,
}: DraftTarget & {
  /** Runs before the publish dialog opens, e.g. to save the editor. */
  beforePublish?: () => Promise<Sequence | undefined>;
}) {
  const [publishing, setPublishing] = useState<Sequence | null>(null);
  const [discarding, setDiscarding] = useState(false);
  const changed = emailsWithChanges(sequence, emailIds);

  const dialogs = (
    <>
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

  return {
    changed,
    /** A dialog is open, so the controls must stay mounted. */
    busy: publishing !== null || discarding,
    openPublish: async () => setPublishing((await beforePublish?.()) ?? sequence),
    openDiscard: () => setDiscarding(true),
    dialogs,
  };
}

/**
 * The amber "Unpublished changes" strip, with Discard and Publish, shown above
 * the content of a started broadcast or sequence while it has a draft.
 */
export function UnpublishedChangesStrip({
  message,
  className,
  ...target
}: DraftTarget & {
  /** What happens if nothing is published; a default fits most places. */
  message?: ReactNode;
  className?: string;
}) {
  const draft = useDraftDialogs(target);
  if (draft.changed.length === 0 && !draft.busy) return null;

  return (
    <Banner
      variant="warning"
      className={`flex flex-wrap items-center justify-between gap-3 ${className ?? ""}`}
    >
      <p className="min-w-0 flex-1">
        <span className="font-medium">Unpublished changes</span>
        {" · "}
        {message ??
          (target.sequence.type === "broadcast"
            ? "The broadcast sends the published version until you publish."
            : "Contacts get the published version until you publish.")}
      </p>
      <div className="flex gap-2">
        <Button size="sm" variant="ghost" onClick={draft.openDiscard}>
          <Undo2 className="size-4" />
          Discard
        </Button>
        <Button size="sm" onClick={draft.openPublish}>
          <CloudUpload className="size-4" />
          Publish changes
        </Button>
      </div>
      {draft.dialogs}
    </Banner>
  );
}

/**
 * Publish and Discard for several emails at once: the page header of a
 * sequence where more than one email has unpublished changes. One email's
 * changes are published from its own strip.
 */
export function PublishAllChangesActions(target: DraftTarget) {
  const draft = useDraftDialogs(target);
  if (draft.changed.length < 2 && !draft.busy) return null;

  return (
    <>
      <Button variant="outline" onClick={draft.openDiscard}>
        <Undo2 className="size-4" />
        Discard all
      </Button>
      <Button variant="outline" onClick={draft.openPublish}>
        <CloudUpload className="size-4" />
        Publish all changes
      </Button>
      {draft.dialogs}
    </>
  );
}

/**
 * Publish for the full-screen editor's toolbar, with Discard and Version
 * history in a "⋯" menu. Publish is secondary there: Save is the toolbar's
 * primary action.
 */
export function EditorDraftActions({
  emailId,
  beforePublish,
  ...target
}: Omit<DraftTarget, "emailIds"> & {
  emailId: string;
  beforePublish: () => Promise<Sequence | undefined>;
}) {
  const draft = useDraftDialogs({ ...target, emailIds: [emailId], beforePublish });
  const hasDraft = draft.changed.length > 0;

  return (
    <>
      {hasDraft && (
        <Button variant="outline" onClick={draft.openPublish}>
          <CloudUpload className="size-4" />
          Publish changes
        </Button>
      )}
      <EmailMoreMenu
        {...target}
        emailId={emailId}
        onDiscard={hasDraft ? draft.openDiscard : undefined}
      />
      {draft.dialogs}
    </>
  );
}

/**
 * The "⋯" menu of an email: its version history, once the broadcast or
 * sequence has started (before that nothing has been published), and
 * Discard when `onDiscard` is given. Renders nothing when it would be empty.
 */
export function EmailMoreMenu({
  sequence,
  emailId,
  onChange,
  onDiscard,
}: Omit<DraftTarget, "emailIds"> & {
  emailId: string;
  onDiscard?: () => void;
}) {
  const [historyOpen, setHistoryOpen] = useState(false);
  const hasHistory = sequence.status !== "draft";
  if (!hasHistory && !onDiscard) return null;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <IconButton variant="outline" aria-label="More email actions">
            <MoreHorizontal className="size-4" />
          </IconButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {hasHistory && (
            <DropdownMenuItem onSelect={() => setHistoryOpen(true)}>
              <History className="size-4" />
              Version history
            </DropdownMenuItem>
          )}
          {onDiscard && (
            <DropdownMenuItem onSelect={onDiscard}>
              <Undo2 className="size-4" />
              Discard changes
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {hasHistory && (
        <EmailVersionHistoryDialog
          sequence={sequence}
          emailId={historyOpen ? emailId : null}
          onOpenChange={setHistoryOpen}
          onRestored={onChange}
        />
      )}
    </>
  );
}
