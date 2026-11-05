"use client";

import type { SequenceSchedule } from "@sendlit/api-contract";
import type { Sequence, SequenceEmail } from "@sendlit/email-blocks";
import { CloudUpload, Pencil, Users } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Banner } from "@/components/dashboard/banner";
import { DialogSection as Section } from "@/components/dashboard/dialog-section";
import { SendErrorMessage } from "@/components/dashboard/send-error-message";
import { Badge } from "@/components/ui/codelit/badge";
import { Button } from "@/components/ui/codelit/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/codelit/dialog";
import { Label } from "@/components/ui/codelit/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  getSequenceSchedule,
  type PublishScope,
  publishSequenceChanges,
} from "@/lib/api";
import { ApiError } from "@/lib/api-client";
import { broadcastScheduledFor } from "@/lib/broadcast";

/** The emails of `sequence` with unpublished changes, in send order. */
export function emailsWithChanges(sequence: Sequence, emailIds?: string[]) {
  return sequence.emailsOrder
    .map((id) => sequence.emails.find((email) => email.emailId === id))
    .filter(
      (email): email is SequenceEmail =>
        Boolean(email?.draft) && (!emailIds || emailIds.includes(email!.emailId)),
    );
}

/** What a draft changes, in words. */
function changeSummary(email: SequenceEmail): string {
  if (!email.draft) return "";
  const subject = email.draft.subject !== email.subject;
  const content = JSON.stringify(email.draft.content) !== JSON.stringify(email.content);
  if (subject && content) return "Subject and content changed";
  return subject ? "Subject changed" : "Content changed";
}

/** "Unpublished changes": amber with words, for a sequence, step or broadcast. */
export function UnpublishedChangesBadge({ className }: { className?: string }) {
  return (
    <Badge variant="warning" dot className={className}>
      Unpublished changes
    </Badge>
  );
}

/**
 * Publishes the unpublished changes of a broadcast or sequence (all
 * of them, or `emailIds`). For a sequence it asks whether contacts already in
 * it get the new version too.
 */
export function PublishChangesDialog({
  sequence,
  emailIds,
  onOpenChange,
  onPublished,
}: {
  /** Open while set. */
  sequence: Sequence | null;
  emailIds?: string[];
  onOpenChange: (open: boolean) => void;
  onPublished: (sequence: Sequence) => void;
}) {
  const [scope, setScope] = useState<PublishScope>("in_flight");
  const [schedule, setSchedule] = useState<SequenceSchedule | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [scopeOpen, setScopeOpen] = useState(true);
  const pathname = usePathname();

  const isSequence = sequence?.type === "sequence";
  const changed = sequence ? emailsWithChanges(sequence, emailIds) : [];
  const changedKey = changed.map((email) => email.emailId).join(",");

  // biome-ignore lint/correctness/useExhaustiveDependencies: reset only when the dialog opens for another set of emails
  useEffect(() => {
    if (!sequence) return;
    setScope("in_flight");
    setError(null);
    setSchedule(null);
    setScopeOpen(true);
    // A short list starts open for review; a long one starts folded.
    setOpen(
      Object.fromEntries(changed.map((email) => [email.emailId, changed.length <= 2])),
    );
    if (isSequence) {
      getSequenceSchedule(sequence.sequenceId)
        .then(setSchedule)
        .catch(() => undefined);
    }
  }, [sequence?.sequenceId, changedKey]);

  if (!sequence) return null;

  // Contacts in the sequence who will still get a changed email: those
  // waiting for it or for an earlier one. The choice is about them.
  const lastChanged = Math.max(
    ...changed.map((email) => sequence.emailsOrder.indexOf(email.emailId)),
  );
  const affected =
    schedule?.emails
      .filter((entry) => sequence.emailsOrder.indexOf(entry.emailId) <= lastChanged)
      .reduce((sum, entry) => sum + entry.waiting, 0) ?? null;
  const scheduledFor =
    sequence.type === "broadcast" ? broadcastScheduledFor(sequence) : null;

  async function publish() {
    if (!sequence) return;
    setPublishing(true);
    setError(null);
    try {
      const updated = await publishSequenceChanges(sequence.sequenceId, {
        emailIds,
        scope: isSequence ? scope : undefined,
      });
      onPublished(updated);
      onOpenChange(false);
      toast.success(
        changed.length === 1
          ? "Changes published. New sends use the new version."
          : `Changes to ${changed.length} emails published. New sends use them.`,
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to publish the changes");
    } finally {
      setPublishing(false);
    }
  }

  const editHref = (email: SequenceEmail) =>
    isSequence
      ? `/editor/sequences/${sequence.sequenceId}/emails/${email.emailId}`
      : `/editor/broadcasts/${sequence.sequenceId}`;

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] flex-col p-0 sm:max-w-2xl">
        <DialogHeader className="gap-2 border-b px-6 pt-6 pb-5">
          <DialogTitle>Publish changes to {sequence.title || "Untitled"}</DialogTitle>
          <DialogDescription>
            {isSequence
              ? "Contacts keep getting the published version until you publish. After that, these emails go out as they look in the editor."
              : "The broadcast sends its published version until you publish. After that, it goes out as it looks in the editor."}
          </DialogDescription>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-2 text-sm">
            <span className="font-medium">
              {changed.length} email{changed.length === 1 ? "" : "s"} with unpublished
              changes
            </span>
            {isSequence && affected !== null && (
              <span className="text-muted-foreground">
                {affected.toLocaleString()} contact{affected === 1 ? "" : "s"} in the
                sequence still to get {changed.length === 1 ? "it" : "them"}
              </span>
            )}
          </div>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-6 py-5">
          {error && (
            <Banner>
              <SendErrorMessage error={error} />
            </Banner>
          )}
          {changed.length === 0 && (
            <p className="text-sm text-muted-foreground">
              There's nothing to publish: every email is up to date.
            </p>
          )}
          {changed.map((email) => (
            <Section
              key={email.emailId}
              open={open[email.emailId] ?? false}
              onOpenChange={(value) =>
                setOpen((current) => ({ ...current, [email.emailId]: value }))
              }
              icon={<span aria-hidden>!</span>}
              name={email.draft?.subject || "Untitled email"}
              summary={changeSummary(email)}
              badge={<Badge variant="warning">Unpublished</Badge>}
            >
              <p className="text-sm">
                Check the draft with Send test in the editor, then publish it.
              </p>
              {email.draft && email.draft.subject !== email.subject && (
                <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
                  <dt className="text-muted-foreground">Published subject</dt>
                  <dd className="break-words">{email.subject || "—"}</dd>
                  <dt className="text-muted-foreground">New subject</dt>
                  <dd className="break-words font-medium">
                    {email.draft.subject || "—"}
                  </dd>
                </dl>
              )}
              {/* Not on the editor page it would link to. */}
              {pathname !== editHref(email) && (
                <Button size="sm" variant="outline" asChild>
                  <Link href={editHref(email)}>
                    <Pencil className="size-4" />
                    Open in editor
                  </Link>
                </Button>
              )}
            </Section>
          ))}
          {isSequence && changed.length > 0 && (
            <Section
              open={scopeOpen}
              onOpenChange={setScopeOpen}
              iconClassName="bg-muted text-muted-foreground"
              icon={<Users className="size-4" />}
              name="Who gets the changes"
              summary="Contacts who enter from now on always get the new version."
              badge={
                <Badge variant="neutral">
                  {scope === "in_flight" ? "Everyone" : "New entrants only"}
                </Badge>
              }
            >
              <p className="text-sm">
                Choose whether contacts already in the sequence get the new version too.
              </p>
              <RadioGroup
                value={scope}
                onValueChange={(value) => setScope(value as PublishScope)}
                className="gap-3"
              >
                <ScopeOption
                  value="in_flight"
                  label="Contacts already in the sequence too"
                  description="They get the new version at their next step. Recommended for fixes."
                />
                <ScopeOption
                  value="new_entrants"
                  label="New entrants only"
                  description="Contacts already in the sequence keep the version they entered with."
                />
              </RadioGroup>
            </Section>
          )}
        </div>

        <DialogFooter className="mt-0 flex-wrap justify-between gap-3 border-t px-6 py-4">
          <p className="text-sm text-muted-foreground">
            {scheduledFor
              ? `Sends ${scheduledFor.toLocaleString()}. Earlier versions stay in the version history.`
              : "Earlier versions stay in each email's version history."}
          </p>
          <div className="flex gap-2.5">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Close
            </Button>
            <Button disabled={publishing || changed.length === 0} onClick={publish}>
              <CloudUpload className="size-4" />
              {publishing ? "Publishing…" : "Publish changes"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ScopeOption({
  value,
  label,
  description,
}: {
  value: PublishScope;
  label: string;
  description: string;
}) {
  const id = `publish-scope-${value}`;
  return (
    <div className="flex items-start gap-3">
      <RadioGroupItem value={value} id={id} className="mt-0.5" />
      <Label htmlFor={id} className="flex flex-col items-start gap-0.5 font-normal">
        <span className="font-medium">{label}</span>
        <span className="text-muted-foreground">{description}</span>
      </Label>
    </div>
  );
}
