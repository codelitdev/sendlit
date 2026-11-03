"use client";

import type { WaitingContactsPage } from "@sendlit/api-contract";
import { Search } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Banner } from "@/components/dashboard/banner";
import { ListPagination } from "@/components/dashboard/list-pagination";
import { Loading } from "@/components/dashboard/loading";
import { Button } from "@/components/ui/codelit/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/codelit/dialog";
import { Input } from "@/components/ui/codelit/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { listWaitingContacts } from "@/lib/api";
import { ApiError } from "@/lib/api-client";
import { formatDuration, timeUntil } from "@/lib/time";

const PER_PAGE = 20;

/** The contacts whose next email in a sequence is this one, each with their
 * own due time. */
export function WaitingContactsDialog({
  sequenceId,
  email,
  onOpenChange,
}: {
  sequenceId: string;
  /** The email whose waiting contacts to list; `null` closes the dialog. */
  email: {
    emailId: string;
    subject: string;
    delayInMillis: number;
    /** Whether it's the sequence's first email, timed from entry. */
    first: boolean;
  } | null;
  onOpenChange: (open: boolean) => void;
}) {
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  // Cursors of the pages before this one; the first page has none.
  const [cursors, setCursors] = useState<string[]>([]);
  const [result, setResult] = useState<WaitingContactsPage | null>(null);
  const [waiting, setWaiting] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const emailId = email?.emailId;
  const after = cursors[cursors.length - 1];

  // biome-ignore lint/correctness/useExhaustiveDependencies: start over for each email
  useEffect(() => {
    setQuery("");
    setSearch("");
    setCursors([]);
    setWaiting(null);
  }, [emailId]);

  // Search once typing pauses, from the first page. Only a changed search
  // resets paging: opening the dialog must not undo an early Next.
  useEffect(() => {
    const next = query.trim();
    if (next === search) return;
    const timer = setTimeout(() => {
      setSearch(next);
      setCursors([]);
    }, 300);
    return () => clearTimeout(timer);
  }, [query, search]);

  useEffect(() => {
    if (!emailId) return;
    let cancelled = false;
    setResult(null);
    setError(null);
    listWaitingContacts(sequenceId, emailId, { after, limit: PER_PAGE, q: search })
      .then((next) => {
        if (cancelled) return;
        setResult(next);
        if (!search) setWaiting(next.total);
      })
      .catch(
        (err) =>
          !cancelled &&
          setError(
            err instanceof ApiError ? err.message : "Couldn't load waiting contacts",
          ),
      );
    return () => {
      cancelled = true;
    };
  }, [sequenceId, emailId, after, search]);

  const page = cursors.length + 1;
  function goToPage(next: number) {
    if (next === page + 1 && result?.nextCursor) {
      setCursors([...cursors, result.nextCursor]);
    } else if (next === page - 1) {
      setCursors(cursors.slice(0, -1));
    }
  }

  const now = Date.now();

  return (
    <Dialog open={email !== null} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] flex-col p-0 sm:max-w-2xl">
        <DialogHeader className="gap-2 border-b px-6 pt-6 pb-5">
          <DialogTitle>Waiting for “{email?.subject || "Untitled email"}”</DialogTitle>
          <DialogDescription>
            These contacts get this email next.{" "}
            {email && email.delayInMillis > 0
              ? `Each one gets it ${formatDuration(email.delayInMillis)} after ${email.first ? "they entered the sequence" : "their previous email"}, so their times differ.`
              : "It goes out as soon as they reach it."}
          </DialogDescription>
          {waiting !== null && waiting > 0 && (
            <p className="pt-1 text-sm">
              <span className="font-medium">{waiting.toLocaleString()} waiting</span>
              {!search && page === 1 && result?.items[0] && (
                <span className="text-muted-foreground">
                  {" "}
                  · next {timeUntil(result.items[0].nextSendAt, now)}
                </span>
              )}
            </p>
          )}
          {waiting !== null && waiting > PER_PAGE && (
            <div className="relative pt-2">
              <Search className="pointer-events-none absolute top-1/2 left-3 mt-1 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                type="search"
                aria-label="Search waiting contacts"
                placeholder="Search by email or name"
                className="pl-9"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
          )}
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          {error && <Banner>{error}</Banner>}
          {!result && !error && <Loading />}
          {result && result.total === 0 && (
            <p className="text-sm text-muted-foreground">
              {search
                ? `No waiting contact matches “${search}”.`
                : "No one is waiting for this email."}
            </p>
          )}
          {result && result.total > 0 && (
            <>
              {search && (
                <p className="mb-2 text-sm text-muted-foreground">
                  {result.total.toLocaleString()}{" "}
                  {result.total === 1 ? "contact matches" : "contacts match"} “{search}”
                </p>
              )}
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Contact</TableHead>
                    <TableHead className="text-right">Due</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {result.items.map((contact) => (
                    <TableRow key={contact.contactId}>
                      <TableCell className="max-w-0 w-full">
                        <Link
                          href={`/contacts/${contact.contactId}`}
                          className="block truncate hover:underline"
                        >
                          {contact.name || contact.email}
                        </Link>
                        {contact.name && (
                          <span className="block truncate text-xs text-muted-foreground">
                            {contact.email}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-right">
                        {new Date(contact.nextSendAt).toLocaleString(undefined, {
                          month: "short",
                          day: "numeric",
                          hour: "numeric",
                          minute: "2-digit",
                        })}
                        <span className="block text-xs text-muted-foreground">
                          {timeUntil(contact.nextSendAt, now)}
                        </span>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <ListPagination
                page={page}
                total={result.total}
                itemsPerPage={PER_PAGE}
                onPageChange={goToPage}
              />
            </>
          )}
        </div>

        <DialogFooter className="mt-0 flex-nowrap items-center justify-between gap-6 border-t px-6 py-4">
          <p className="text-sm text-muted-foreground">
            The earliest each contact can get it. Pausing the sequence or sending limits
            can make it later.
          </p>
          <Button
            variant="outline"
            className="shrink-0"
            onClick={() => onOpenChange(false)}
          >
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
