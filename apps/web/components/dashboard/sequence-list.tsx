"use client";

import type { MailType, Sequence } from "@sendlit/email-blocks";
import {
  Archive,
  ArchiveRestore,
  MoreHorizontal,
  Pause,
  Play,
  Trash2,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ArchiveBroadcastDialog } from "@/components/dashboard/archive-broadcast-dialog";
import { Banner } from "@/components/dashboard/banner";
import { useSetBreadcrumb } from "@/components/dashboard/breadcrumb-context";
import { DeleteSequenceDialog } from "@/components/dashboard/delete-sequence-dialog";
import { ListPagination } from "@/components/dashboard/list-pagination";
import { Loading } from "@/components/dashboard/loading";
import { NewSequenceDialog } from "@/components/dashboard/new-sequence-dialog";
import { PageHeader } from "@/components/dashboard/page-header";
import { ScrollablePage } from "@/components/dashboard/scrollable-page";
import { SendErrorMessage } from "@/components/dashboard/send-error-message";
import { Badge } from "@/components/ui/codelit/badge";
import { Card, CardContent } from "@/components/ui/codelit/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/codelit/dropdown-menu";
import { IconButton } from "@/components/ui/codelit/icon-button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/codelit/select";
import {
  listSequences,
  pauseSequence,
  startSequence,
  unarchiveBroadcast,
} from "@/lib/api";
import { ApiError } from "@/lib/api-client";
import { broadcastDeleteActions, presentBroadcastStatus } from "@/lib/broadcast";
import { ITEMS_PER_PAGE } from "@/lib/pagination";

const STATUS_VARIANT: Record<Sequence["status"], "success" | "neutral" | "outline"> = {
  active: "success",
  draft: "neutral",
  paused: "outline",
  completed: "outline",
};

export function SequenceListPage({
  type,
  title,
  description,
  createLabel,
  basePath,
}: {
  type: MailType;
  title: string;
  description: string;
  createLabel: string;
  basePath: string;
}) {
  const router = useRouter();
  const [sequences, setSequences] = useState<Sequence[] | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [loadingPage, setLoadingPage] = useState(false);
  const [sequencePendingDelete, setSequencePendingDelete] = useState<Sequence | null>(
    null,
  );
  const [broadcastPendingArchive, setBroadcastPendingArchive] =
    useState<Sequence | null>(null);
  // Broadcasts only: archived ones are listed on their own (ADR 0008).
  const [archived, setArchived] = useState<"exclude" | "only">("exclude");

  useSetBreadcrumb([{ label: title }]);

  async function load(pageToLoad = 1) {
    setLoadingPage(true);
    try {
      const result = await listSequences(type, {
        offset: pageToLoad,
        itemsPerPage: ITEMS_PER_PAGE,
        ...(type === "broadcast" && { archived }),
      });
      setSequences(result.items);
      setTotal(result.total);
      setPage(pageToLoad);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load");
    } finally {
      setLoadingPage(false);
    }
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: load is recreated every render and reads type and archived; reload only when they change
  useEffect(() => {
    load();
  }, [type, archived]);

  /** Reloads the current page, or the previous one when this row was its last. */
  async function reloadAfterRemoving() {
    const lastOnPage = sequences?.length === 1 && page > 1;
    await load(lastOnPage ? page - 1 : page);
  }

  async function unarchive(sequence: Sequence) {
    try {
      await unarchiveBroadcast(sequence.sequenceId);
      await reloadAfterRemoving();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Action failed");
    }
  }

  async function toggle(sequence: Sequence) {
    try {
      if (sequence.status === "active") {
        await pauseSequence(sequence.sequenceId);
      } else {
        await startSequence(sequence.sequenceId);
      }
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Action failed");
    }
  }

  return (
    <ScrollablePage>
      <PageHeader
        title={title}
        description={description}
        action={
          <NewSequenceDialog
            type={type}
            label={createLabel}
            onCreated={(sequenceId) => router.push(`${basePath}/${sequenceId}`)}
          />
        }
      />

      <DeleteSequenceDialog
        sequence={sequencePendingDelete}
        type={type === "broadcast" ? "broadcast" : "sequence"}
        onOpenChange={(open) => {
          if (!open) setSequencePendingDelete(null);
        }}
        onDeleted={reloadAfterRemoving}
        onArchiveInstead={() => {
          setBroadcastPendingArchive(sequencePendingDelete);
          setSequencePendingDelete(null);
        }}
      />

      {type === "broadcast" && (
        <>
          <ArchiveBroadcastDialog
            broadcast={broadcastPendingArchive}
            onOpenChange={(open) => {
              if (!open) setBroadcastPendingArchive(null);
            }}
            onArchived={reloadAfterRemoving}
          />
          <div className="mb-4 flex justify-end">
            <Select
              value={archived}
              onValueChange={(value) => setArchived(value as "exclude" | "only")}
            >
              <SelectTrigger className="w-44" aria-label="Show broadcasts">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="exclude">All broadcasts</SelectItem>
                <SelectItem value="only">Archived</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </>
      )}

      {error && (
        <Banner className="mb-4">
          <SendErrorMessage error={error} />
        </Banner>
      )}

      {sequences === null ? (
        <Loading />
      ) : sequences.length === 0 ? (
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">
            {type === "broadcast" && archived === "only"
              ? "No archived broadcasts. Archive a sent broadcast to hide it from the list."
              : "Nothing here yet."}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="px-4 py-3 font-medium">Title</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Emails</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {sequences.map((sequence) => (
                  <tr
                    key={sequence.sequenceId}
                    className="cursor-pointer border-b last:border-0 hover:bg-accent/50"
                    onClick={() => router.push(`${basePath}/${sequence.sequenceId}`)}
                  >
                    <td className="px-4 py-3 font-medium">
                      {sequence.title || "Untitled"}
                    </td>
                    <td className="px-4 py-3">
                      {type === "broadcast" ? (
                        <span className="inline-flex items-center gap-1.5">
                          <Badge variant={presentBroadcastStatus(sequence).variant}>
                            {presentBroadcastStatus(sequence).label}
                          </Badge>
                          {sequence.archivedAt && (
                            <Badge variant="outline">archived</Badge>
                          )}
                        </span>
                      ) : (
                        <Badge variant={STATUS_VARIANT[sequence.status]}>
                          {sequence.status}
                        </Badge>
                      )}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {sequence.emails.length}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {/* Broadcasts are sent/scheduled from the editor —
                                                a quick-start here would send immediately since
                                                a draft broadcast's send time defaults to the
                                                past (see lib/broadcast.ts). */}
                      {type !== "broadcast" &&
                        (sequence.status === "active" ||
                          sequence.status === "draft" ||
                          sequence.status === "paused") && (
                          <IconButton
                            aria-label={
                              sequence.status === "active"
                                ? "Pause sequence"
                                : "Start sequence"
                            }
                            onClick={(e) => {
                              e.stopPropagation();
                              toggle(sequence);
                            }}
                          >
                            {sequence.status === "active" ? (
                              <Pause className="size-4" />
                            ) : (
                              <Play className="size-4" />
                            )}
                          </IconButton>
                        )}
                      {type === "broadcast" && (
                        <BroadcastRowMenu
                          sequence={sequence}
                          onDelete={() => setSequencePendingDelete(sequence)}
                          onArchive={() => setBroadcastPendingArchive(sequence)}
                          onUnarchive={() => void unarchive(sequence)}
                        />
                      )}
                      {type === "sequence" && (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <IconButton
                              aria-label={`Actions for ${sequence.title || "Untitled"}`}
                              onClick={(e) => e.stopPropagation()}
                            >
                              <MoreHorizontal className="size-4" />
                            </IconButton>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent
                            align="end"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <DropdownMenuItem
                              disabled={sequence.status === "active"}
                              title={
                                sequence.status === "active"
                                  ? "Pause the sequence before deleting it."
                                  : undefined
                              }
                              onSelect={() => setSequencePendingDelete(sequence)}
                            >
                              <Trash2 className="size-4" />
                              {sequence.status === "active"
                                ? "Delete (pause first)"
                                : "Delete"}
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      {sequences !== null && (
        <ListPagination
          page={page}
          total={total}
          itemsPerPage={ITEMS_PER_PAGE}
          disabled={loadingPage}
          onPageChange={(nextPage) => void load(nextPage)}
        />
      )}
    </ScrollablePage>
  );
}

/** Delete, archive or unarchive a broadcast, with the reason an action is
 * unavailable shown on the disabled item. */
function BroadcastRowMenu({
  sequence,
  onDelete,
  onArchive,
  onUnarchive,
}: {
  sequence: Sequence;
  onDelete: () => void;
  onArchive: () => void;
  onUnarchive: () => void;
}) {
  const actions = broadcastDeleteActions(sequence);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton
          aria-label={`Actions for ${sequence.title || "Untitled"}`}
          onClick={(e) => e.stopPropagation()}
        >
          <MoreHorizontal className="size-4" />
        </IconButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
        {sequence.archivedAt ? (
          <DropdownMenuItem onSelect={onUnarchive}>
            <ArchiveRestore className="size-4" />
            Unarchive
          </DropdownMenuItem>
        ) : actions.archive.allowed ? (
          <DropdownMenuItem onSelect={onArchive}>
            <Archive className="size-4" />
            Archive
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem
          disabled={!actions.delete.allowed}
          title={actions.delete.reason}
          onSelect={onDelete}
        >
          <Trash2 className="size-4" />
          {actions.delete.allowed ? "Delete" : "Delete (unavailable)"}
        </DropdownMenuItem>
        {actions.delete.reason && (
          <p className="max-w-56 px-2 py-1.5 text-xs text-muted-foreground">
            {actions.delete.reason}
          </p>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
