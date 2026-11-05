"use client";

import { type Email, EmailPreview, type Sequence } from "@sendlit/email-blocks";
import { Check, History, RotateCcw } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Banner } from "@/components/dashboard/banner";
import { DialogSection } from "@/components/dashboard/dialog-section";
import {
  MARKETING_EMAIL_EDITOR_BLOCKS,
  marketingPreviewContext,
} from "@/components/dashboard/email-editor-screen";
import { Loading } from "@/components/dashboard/loading";
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
import {
  listSequenceEmailVersions,
  restoreSequenceEmailVersion,
  type SequenceEmailVersion,
} from "@/lib/api";
import { ApiError } from "@/lib/api-client";
import { relativeTime } from "@/lib/time";

/**
 * The versions an email of a broadcast or sequence was published with. Restore
 * loads one into the draft; publishing it rolls the email back.
 */
export function EmailVersionHistoryDialog({
  sequence,
  emailId,
  onOpenChange,
  onRestored,
}: {
  sequence: Sequence;
  /** Open while set. */
  emailId: string | null;
  onOpenChange: (open: boolean) => void;
  onRestored: (sequence: Sequence) => void;
}) {
  const [versions, setVersions] = useState<SequenceEmailVersion[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [restoring, setRestoring] = useState<string | null>(null);
  const [open, setOpen] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (!emailId) return;
    setVersions(null);
    setError(null);
    listSequenceEmailVersions(sequence.sequenceId, emailId)
      .then((items) => {
        setVersions(items);
        // The live version starts open; earlier ones fold.
        setOpen(Object.fromEntries(items.map((v) => [v.versionId, v.live])));
      })
      .catch((err) =>
        setError(err instanceof ApiError ? err.message : "Failed to load the history"),
      );
  }, [sequence.sequenceId, emailId]);

  const email = sequence.emails.find((e) => e.emailId === emailId);
  const earlier = versions?.filter((version) => !version.live).length ?? 0;

  async function restore(versionId: string) {
    if (!emailId) return;
    setRestoring(versionId);
    setError(null);
    try {
      const restored = await restoreSequenceEmailVersion(
        sequence.sequenceId,
        emailId,
        versionId,
      );
      onRestored(restored);
      onOpenChange(false);
      toast.success(
        restored.status === "active"
          ? "Version restored to the draft. Publish it to roll back."
          : "Version restored.",
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to restore the version");
    } finally {
      setRestoring(null);
    }
  }

  return (
    <Dialog open={emailId !== null} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] flex-col p-0 sm:max-w-3xl">
        <DialogHeader className="gap-2 border-b px-6 pt-6 pb-5">
          <DialogTitle>Version history of {email?.subject || "this email"}</DialogTitle>
          <DialogDescription>
            Every version you publish is kept. Restore one to load it into the draft,
            then publish it to roll back.
          </DialogDescription>
          {versions && (
            <div className="pt-2 text-sm">
              <span className="font-medium">
                {earlier} earlier version{earlier === 1 ? "" : "s"}
              </span>
              <span className="text-muted-foreground">
                {earlier === 0 ? " · publish a change to start the history" : ""}
              </span>
            </div>
          )}
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-6 py-5">
          {error && <Banner>{error}</Banner>}
          {!versions && !error && <Loading />}
          {versions?.map((version) => (
            <DialogSection
              key={version.versionId}
              open={open[version.versionId] ?? false}
              onOpenChange={(value) =>
                setOpen((current) => ({ ...current, [version.versionId]: value }))
              }
              icon={
                version.live ? (
                  <Check className="size-4" />
                ) : (
                  <History className="size-4" />
                )
              }
              iconClassName={
                version.live
                  ? "bg-[var(--success-soft)] text-[#1f6b35]"
                  : "bg-muted text-muted-foreground"
              }
              name={version.subject || "Untitled email"}
              summary={`Published ${relativeTime(version.publishedAt)}`}
              badge={
                version.live ? (
                  <Badge variant="success">Live</Badge>
                ) : (
                  <Badge variant="neutral">Earlier</Badge>
                )
              }
            >
              <p className="text-sm">
                {version.live
                  ? "Contacts get this version now. Restoring it throws away the draft."
                  : "Restore loads this version into the draft. Nothing changes for contacts until you publish."}
              </p>
              <EmailPreview
                content={version.content as Email}
                minHeight="320px"
                blocks={MARKETING_EMAIL_EDITOR_BLOCKS}
                renderContext={marketingPreviewContext({
                  viewInBrowser: sequence.viewInBrowser,
                })}
              />
              {(!version.live || email?.draft) && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={restoring !== null}
                  onClick={() => void restore(version.versionId)}
                >
                  <RotateCcw className="size-4" />
                  {restoring === version.versionId ? "Restoring…" : "Restore"}
                </Button>
              )}
            </DialogSection>
          ))}
        </div>

        <DialogFooter className="mt-0 flex-wrap justify-between gap-3 border-t px-6 py-4">
          <p className="text-sm text-muted-foreground">
            Keeps the last 20 published versions.
          </p>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
