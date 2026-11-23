"use client";

import { Pencil, Trash2, TriangleAlert } from "lucide-react";
import { type ComponentType, type ReactNode, useEffect, useState } from "react";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "./components/ui/alert-dialog";
import { Badge } from "./components/ui/badge";
import { Button } from "./components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./components/ui/dialog";
import { Input } from "./components/ui/input";
import { Label } from "./components/ui/label";
import { Skeleton } from "./components/ui/skeleton";
import { cn } from "./lib/utils";
import {
  deleteNotice,
  plural,
  referenceCount,
  renameNotice,
  TAG_USAGE_LABELS,
} from "./tag-manager-text";
import type {
  DeleteTagResult,
  RenameTagResult,
  TagReferences,
  TagSummary,
} from "./tag-manager-types";

export type TagManagerSequence = TagReferences["sequences"][number];

export interface TagManagerLinkProps {
  href: string;
  className?: string;
  children: ReactNode;
}

export interface TagManagerProps {
  /** Every tag the contacts carry, with how many carry it. */
  listTags: () => Promise<TagSummary[]>;
  /** Segments, broadcasts, sequences and signup forms that name the tag. */
  getTagReferences: (tag: string) => Promise<TagReferences>;
  /** Renames the tag everywhere it's used; renaming to an existing tag merges them. */
  renameTag: (tag: string, name: string) => Promise<RenameTagResult>;
  /** Removes the tag from every contact; references are left as they are. */
  deleteTag: (tag: string) => Promise<DeleteTagResult>;
  /** Where a broadcast or sequence that uses the tag is edited. Without it, they aren't linked. */
  sequenceHref?: (sequence: TagManagerSequence) => string;
  /** The host's link, e.g. Next.js `Link`; a plain anchor by default. */
  linkComponent?: ComponentType<TagManagerLinkProps>;
  /** Shown while tags or references load; skeleton rows by default. */
  loadingIndicator?: ReactNode;
  /** Turns a failed call into a message. Defaults to the error's message. */
  errorMessage?: (error: unknown, fallback: string) => string;
  className?: string;
}

function defaultErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function PlainLink({ href, className, children }: TagManagerLinkProps) {
  return (
    <a href={href} className={className}>
      {children}
    </a>
  );
}

/**
 * Lists every tag on the team's contacts with how many carry it, and lets
 * people rename a tag everywhere it's used or delete it from every contact.
 * The SendLit dashboard and hosts such as CourseLit share it; each passes
 * functions that call its own API.
 */
export function TagManager({
  listTags,
  getTagReferences,
  renameTag,
  deleteTag,
  sequenceHref,
  linkComponent = PlainLink,
  loadingIndicator,
  errorMessage = defaultErrorMessage,
  className,
}: TagManagerProps) {
  const [tags, setTags] = useState<TagSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // The selected tag outlives `open`, so the dialogs keep their content
  // while they animate closed.
  const [renaming, setRenaming] = useState<TagSummary | null>(null);
  const [renameOpen, setRenameOpen] = useState(false);
  const [deleting, setDeleting] = useState<TagSummary | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);

  async function load() {
    try {
      setTags(await listTags());
      setError(null);
    } catch (err) {
      setError(errorMessage(err, "Failed to load tags"));
    }
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: load once on mount
  useEffect(() => {
    load();
  }, []);

  return (
    <div className={cn("space-y-4", className)}>
      {error && <ErrorText>{error}</ErrorText>}
      {notice && (
        <p className="text-sm text-muted-foreground" role="status">
          {notice}
        </p>
      )}

      <RenameTagDialog
        tag={renaming}
        open={renameOpen}
        onOpenChange={setRenameOpen}
        renameTag={renameTag}
        errorMessage={errorMessage}
        onRenamed={async (result) => {
          setNotice(renameNotice(result));
          await load();
        }}
      />
      <DeleteTagDialog
        tag={deleting}
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        getTagReferences={getTagReferences}
        deleteTag={deleteTag}
        sequenceHref={sequenceHref}
        linkComponent={linkComponent}
        loadingIndicator={loadingIndicator}
        errorMessage={errorMessage}
        onDeleted={async (result) => {
          setNotice(deleteNotice(result));
          await load();
        }}
      />

      <div className="overflow-hidden rounded-lg border">
        {tags === null ? (
          (loadingIndicator ?? <TagRowsSkeleton />)
        ) : tags.length === 0 ? (
          <p className="px-5 py-8 text-sm text-muted-foreground">
            No tags yet. Tags you add to contacts show up here.
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b text-left text-muted-foreground">
              <tr>
                <th className="px-4 py-2.5 font-medium">Tag</th>
                <th className="px-4 py-2.5 text-right font-medium">Contacts</th>
                <th className="px-4 py-2.5">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {tags.map((tag) => (
                <tr key={tag.tag}>
                  <td className="px-4 py-2">
                    <Badge variant="secondary" className="font-mono">
                      {tag.tag}
                    </Badge>
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">
                    {tag.contactCount.toLocaleString("en-US")}
                  </td>
                  <td className="px-4 py-2 text-right">
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Rename ${tag.tag}`}
                      onClick={() => {
                        setRenaming(tag);
                        setRenameOpen(true);
                      }}
                    >
                      <Pencil className="size-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Delete ${tag.tag}`}
                      onClick={() => {
                        setDeleting(tag);
                        setDeleteOpen(true);
                      }}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function ErrorText({ children }: { children: ReactNode }) {
  return (
    <p
      className="rounded-md border border-destructive/30 px-3 py-2 text-sm text-destructive"
      role="alert"
    >
      {children}
    </p>
  );
}

function TagRowsSkeleton() {
  return (
    <ul className="divide-y">
      {[0, 1, 2].map((row) => (
        <li key={row} className="flex items-center justify-between px-4 py-3">
          <Skeleton className="h-5 w-28" />
          <Skeleton className="h-4 w-10" />
        </li>
      ))}
    </ul>
  );
}

function RenameTagDialog({
  tag,
  open,
  onOpenChange,
  renameTag,
  errorMessage,
  onRenamed,
}: {
  tag: TagSummary | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  renameTag: TagManagerProps["renameTag"];
  errorMessage: NonNullable<TagManagerProps["errorMessage"]>;
  onRenamed: (result: RenameTagResult) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(tag?.tag ?? "");
    setError(null);
  }, [tag, open]);

  async function submit() {
    if (!tag) return;
    setSaving(true);
    setError(null);
    try {
      const result = await renameTag(tag.tag, name.trim());
      onOpenChange(false);
      await onRenamed(result);
    } catch (err) {
      setError(errorMessage(err, "Failed to rename the tag"));
    } finally {
      setSaving(false);
    }
  }

  const unchanged = !name.trim() || name.trim() === tag?.tag;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            Rename <span className="font-mono">{tag?.tag}</span>
          </DialogTitle>
          <DialogDescription>
            The new name replaces it on every contact and in the segments, filters,
            triggers, email actions and signup forms that use it. Renaming to a tag that
            already exists merges the two. Sent broadcasts keep the old name.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-1.5"
          onSubmit={(event) => {
            event.preventDefault();
            if (!unchanged) submit();
          }}
        >
          {error && <ErrorText>{error}</ErrorText>}
          <Label htmlFor="rename-tag-name">New name</Label>
          <Input
            id="rename-tag-name"
            className="font-mono"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={unchanged || saving}>
            <Pencil className="size-4" />
            {saving ? "Renaming…" : "Rename tag"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DeleteTagDialog({
  tag,
  open,
  onOpenChange,
  getTagReferences,
  deleteTag,
  sequenceHref,
  linkComponent: Link,
  loadingIndicator,
  errorMessage,
  onDeleted,
}: {
  tag: TagSummary | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  getTagReferences: TagManagerProps["getTagReferences"];
  deleteTag: TagManagerProps["deleteTag"];
  sequenceHref?: TagManagerProps["sequenceHref"];
  linkComponent: ComponentType<TagManagerLinkProps>;
  loadingIndicator?: ReactNode;
  errorMessage: NonNullable<TagManagerProps["errorMessage"]>;
  onDeleted: (result: DeleteTagResult) => Promise<void>;
}) {
  const [references, setReferences] = useState<TagReferences | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Hosts often pass inline functions; refetch only when the tag or open
  // state changes, not whenever the host re-renders.
  // biome-ignore lint/correctness/useExhaustiveDependencies: see above
  useEffect(() => {
    if (!open || !tag) return;
    setReferences(null);
    setError(null);
    let cancelled = false;
    getTagReferences(tag.tag)
      .then((result) => {
        if (!cancelled) setReferences(result);
      })
      .catch((err) => {
        if (!cancelled) setError(errorMessage(err, "Failed to check where it's used"));
      });
    return () => {
      cancelled = true;
    };
  }, [tag, open]);

  async function confirm() {
    if (!tag) return;
    setDeleting(true);
    setError(null);
    try {
      const result = await deleteTag(tag.tag);
      onOpenChange(false);
      await onDeleted(result);
    } catch (err) {
      setError(errorMessage(err, "Failed to delete the tag"));
    } finally {
      setDeleting(false);
    }
  }

  const count = references ? referenceCount(references) : 0;
  return (
    <AlertDialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && !deleting) onOpenChange(false);
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete the tag "{tag?.tag ?? ""}"?</AlertDialogTitle>
          <AlertDialogDescription>
            {references
              ? `It will be removed from ${plural(references.contactCount, "contact")}. The contacts themselves are kept. This can't be undone.`
              : "Checking which contacts and settings use it…"}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error ? (
          <ErrorText>{error}</ErrorText>
        ) : references === null ? (
          (loadingIndicator ?? <Skeleton className="h-16 w-full" />)
        ) : count === 0 ? (
          <p className="text-sm text-muted-foreground">
            No segments, broadcasts, sequences or signup forms use this tag.
          </p>
        ) : (
          <div className="space-y-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100">
            <p className="flex items-center gap-2 font-medium">
              <TriangleAlert className="size-4 shrink-0" />
              Still used in {plural(count, "place")}
            </p>
            <p>
              These keep the tag name: a filter on a deleted tag matches nobody, and a
              trigger, email action or signup form can add the tag again. Update them
              first if that's not what you want.
            </p>
            <ul className="max-h-48 list-disc space-y-1 overflow-y-auto pl-5">
              {references.segments.map((segment) => (
                <li key={segment.segmentId}>
                  Segment <strong>{segment.name}</strong>
                </li>
              ))}
              {references.sequences.map((sequence) => {
                const label = (
                  <>
                    {sequence.type === "broadcast" ? "Broadcast" : "Sequence"}{" "}
                    <strong>{sequence.title || "Untitled"}</strong>
                  </>
                );
                return (
                  <li key={sequence.sequenceId}>
                    {sequenceHref ? (
                      <Link
                        href={sequenceHref(sequence)}
                        className="underline-offset-2 hover:underline"
                      >
                        {label}
                      </Link>
                    ) : (
                      label
                    )}{" "}
                    ({sequence.status}):{" "}
                    {sequence.usages.map((usage) => TAG_USAGE_LABELS[usage]).join(", ")}
                  </li>
                );
              })}
              {references.signupForms.map((form) => (
                <li key={form.formId}>
                  Signup form <strong>{form.name}</strong>
                </li>
              ))}
            </ul>
          </div>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
          <Button
            variant="destructive"
            disabled={references === null || deleting}
            onClick={confirm}
          >
            <Trash2 className="size-4" />
            {deleting ? "Deleting…" : "Delete tag"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
