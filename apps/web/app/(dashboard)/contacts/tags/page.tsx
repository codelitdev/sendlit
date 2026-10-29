"use client";

import type { TagReferences, TagSummary } from "@sendlit/api-contract";
import { TriangleAlert, Pencil, Trash2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Banner } from "@/components/dashboard/banner";
import { useSetBreadcrumb } from "@/components/dashboard/breadcrumb-context";
import { DeleteConfirmationDialog } from "@/components/dashboard/delete-confirmation-dialog";
import { Loading } from "@/components/dashboard/loading";
import { PageHeader } from "@/components/dashboard/page-header";
import { ScrollablePage } from "@/components/dashboard/scrollable-page";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/codelit/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/codelit/dialog";
import { IconButton } from "@/components/ui/codelit/icon-button";
import { Input } from "@/components/ui/codelit/input";
import { Label } from "@/components/ui/codelit/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { deleteTag, getTagReferences, listTags, renameTag } from "@/lib/api";
import { ApiError } from "@/lib/api-client";

const plural = (count: number, word: string) =>
  `${count.toLocaleString()} ${word}${count === 1 ? "" : "s"}`;

export default function TagsPage() {
  const [tags, setTags] = useState<TagSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<TagSummary | null>(null);
  const [deleting, setDeleting] = useState<TagSummary | null>(null);

  useSetBreadcrumb([{ label: "Contacts", href: "/contacts" }, { label: "Tags" }]);

  async function load() {
    try {
      setTags(await listTags());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load tags");
    }
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: load once on mount
  useEffect(() => {
    load();
  }, []);

  return (
    <ScrollablePage>
      <PageHeader
        title="Tags"
        description="Every tag your contacts carry. Rename a tag to fix it everywhere it's used, or delete one you no longer need."
      />

      {error && <Banner className="mb-4">{error}</Banner>}
      {notice && (
        <p className="mb-4 text-sm text-muted-foreground" role="status">
          {notice}
        </p>
      )}

      <RenameTagDialog
        tag={renaming}
        onOpenChange={(open) => {
          if (!open) setRenaming(null);
        }}
        onRenamed={async (message) => {
          setNotice(message);
          await load();
        }}
      />
      <DeleteTagDialog
        tag={deleting}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
        onDeleted={async (message) => {
          setNotice(message);
          await load();
        }}
      />

      <Card>
        <CardContent className="p-0">
          {tags === null ? (
            <Loading className="p-6" />
          ) : tags.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground">
              No tags yet. Tags you add to contacts show up here.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="px-4">Tag</TableHead>
                  <TableHead className="px-4 text-right">Contacts</TableHead>
                  <TableHead className="px-4" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {tags.map((tag) => (
                  <TableRow key={tag.tag}>
                    <TableCell className="px-4">
                      <Badge variant="secondary" className="font-mono">
                        {tag.tag}
                      </Badge>
                    </TableCell>
                    <TableCell className="px-4 text-right tabular-nums">
                      {tag.contactCount.toLocaleString()}
                    </TableCell>
                    <TableCell className="px-4 text-right">
                      <IconButton
                        aria-label={`Rename ${tag.tag}`}
                        onClick={() => setRenaming(tag)}
                      >
                        <Pencil className="size-4" />
                      </IconButton>
                      <IconButton
                        aria-label={`Delete ${tag.tag}`}
                        onClick={() => setDeleting(tag)}
                      >
                        <Trash2 className="size-4" />
                      </IconButton>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </ScrollablePage>
  );
}

function RenameTagDialog({
  tag,
  onOpenChange,
  onRenamed,
}: {
  tag: TagSummary | null;
  onOpenChange: (open: boolean) => void;
  onRenamed: (message: string) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setName(tag?.tag ?? "");
    setError(null);
  }, [tag]);

  async function submit() {
    if (!tag) return;
    setSaving(true);
    setError(null);
    try {
      const result = await renameTag(tag.tag, name.trim());
      onOpenChange(false);
      await onRenamed(
        `Renamed ${result.previousTag} to ${result.tag} on ${plural(result.contactsUpdated, "contact")}, ${plural(result.segmentsUpdated, "segment")}, ${plural(result.sequencesUpdated, "broadcast or sequence")} and ${plural(result.signupFormsUpdated, "signup form")}.`,
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to rename the tag");
    } finally {
      setSaving(false);
    }
  }

  const unchanged = !name.trim() || name.trim() === tag?.tag;
  return (
    <Dialog open={tag !== null} onOpenChange={onOpenChange}>
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
          {error && <Banner>{error}</Banner>}
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

const usageLabels: Record<
  TagReferences["sequences"][number]["usages"][number],
  string
> = {
  filter: "audience filter",
  exclude_filter: "exclusion filter",
  trigger: "trigger",
  email_action: "email tag action",
};

function DeleteTagDialog({
  tag,
  onOpenChange,
  onDeleted,
}: {
  tag: TagSummary | null;
  onOpenChange: (open: boolean) => void;
  onDeleted: (message: string) => Promise<void>;
}) {
  const [references, setReferences] = useState<TagReferences | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setReferences(null);
    setError(null);
    if (!tag) return;
    let cancelled = false;
    getTagReferences(tag.tag)
      .then((result) => {
        if (!cancelled) setReferences(result);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(
            err instanceof ApiError ? err.message : "Failed to check where it's used",
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [tag]);

  const referenceCount = references
    ? references.segments.length +
      references.sequences.length +
      references.signupForms.length
    : 0;

  return (
    <DeleteConfirmationDialog
      open={tag !== null}
      onOpenChange={onOpenChange}
      title={`Delete the tag "${tag?.tag ?? ""}"?`}
      description={
        references
          ? `It will be removed from ${plural(references.contactCount, "contact")}. The contacts themselves are kept. This can't be undone.`
          : "Checking which contacts and settings use it…"
      }
      confirmLabel="Delete tag"
      confirmDisabled={references === null}
      onConfirm={async () => {
        if (!tag) return;
        const result = await deleteTag(tag.tag);
        await onDeleted(
          `Deleted ${result.tag} from ${plural(result.contactsUpdated, "contact")}.`,
        );
      }}
    >
      {error ? (
        <Banner>{error}</Banner>
      ) : references === null ? (
        <Loading />
      ) : referenceCount === 0 ? (
        <p className="text-sm text-muted-foreground">
          No segments, broadcasts, sequences or signup forms use this tag.
        </p>
      ) : (
        <div className="space-y-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100">
          <p className="flex items-center gap-2 font-medium">
            <TriangleAlert className="size-4 shrink-0" />
            Still used in {plural(referenceCount, "place")}
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
            {references.sequences.map((sequence) => (
              <li key={sequence.sequenceId}>
                <Link
                  href={`/${sequence.type === "broadcast" ? "broadcasts" : "sequences"}/${sequence.sequenceId}`}
                  className="underline-offset-2 hover:underline"
                >
                  {sequence.type === "broadcast" ? "Broadcast" : "Sequence"}{" "}
                  <strong>{sequence.title || "Untitled"}</strong>
                </Link>{" "}
                ({sequence.status}):{" "}
                {sequence.usages.map((usage) => usageLabels[usage]).join(", ")}
              </li>
            ))}
            {references.signupForms.map((form) => (
              <li key={form.formId}>
                Signup form <strong>{form.name}</strong>
              </li>
            ))}
          </ul>
        </div>
      )}
    </DeleteConfirmationDialog>
  );
}
