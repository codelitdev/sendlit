"use client";

import type {
  SequenceDeliveriesPage,
  SequenceDeliveryOutcomeFilter,
} from "@sendlit/api-contract";
import { ShieldAlert } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Banner } from "@/components/dashboard/banner";
import { DeliveryOutcomeBadge } from "@/components/dashboard/delivery-outcome-badge";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { listSequenceDeliveries, SUPPRESSION_REASON_LABEL } from "@/lib/api";
import { ApiError } from "@/lib/api-client";

const PER_PAGE = 20;

const COPY: Record<
  SequenceDeliveryOutcomeFilter,
  { title: string; description: string; noun: string; empty: string }
> = {
  bounced: {
    title: "Recipients who bounced",
    description:
      "Their mail server refused the email. A hard bounce means the address doesn't exist or never accepts mail, so SendLit stops mailing it. A soft bounce is temporary, such as a full mailbox.",
    noun: "bounced",
    empty: "No email from here has bounced.",
  },
  complained: {
    title: "Recipients who marked it as spam",
    description:
      "They reported the email as spam in their inbox. SendLit stops mailing an address that complains, because mailbox providers penalise senders who keep mailing it.",
    noun: "marked it as spam",
    empty: "No one has marked an email from here as spam.",
  },
};

function formatDate(iso: string | null) {
  return iso
    ? new Date(iso).toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : "";
}

/** The recipients behind a broadcast's or sequence's bounce rate or spam
 * complaint rate, with the ESP's reason and whether they're suppressed. */
export function DeliveryRecipientsDialog({
  sequenceId,
  outcome,
  emailSubjects,
  onOpenChange,
}: {
  sequenceId: string;
  /** Which recipients to list; `null` closes the dialog. */
  outcome: SequenceDeliveryOutcomeFilter | null;
  /** Subject per `emailId`, shown under each recipient when a sequence has
   * more than one email. */
  emailSubjects?: Record<string, string>;
  onOpenChange: (open: boolean) => void;
}) {
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<SequenceDeliveriesPage | null>(null);
  const [error, setError] = useState<string | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: start over for each outcome
  useEffect(() => {
    setPage(1);
  }, [outcome]);

  useEffect(() => {
    if (!outcome) return;
    let cancelled = false;
    setResult(null);
    setError(null);
    listSequenceDeliveries(sequenceId, { outcome, page, itemsPerPage: PER_PAGE })
      .then((next) => !cancelled && setResult(next))
      .catch(
        (err) =>
          !cancelled &&
          setError(err instanceof ApiError ? err.message : "Couldn't load recipients"),
      );
    return () => {
      cancelled = true;
    };
  }, [sequenceId, outcome, page]);

  const copy = outcome ? COPY[outcome] : null;
  const showSubjects = emailSubjects && Object.keys(emailSubjects).length > 1;

  return (
    <Dialog open={outcome !== null} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] flex-col p-0 sm:max-w-3xl">
        <DialogHeader className="gap-2 border-b px-6 pt-6 pb-5">
          <DialogTitle>{copy?.title}</DialogTitle>
          <DialogDescription>{copy?.description}</DialogDescription>
          {result && result.total > 0 && (
            <p className="pt-1 text-sm font-medium">
              {result.total.toLocaleString()}{" "}
              {result.total === 1 ? "recipient" : "recipients"} {copy?.noun}
            </p>
          )}
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          {error && <Banner>{error}</Banner>}
          {!result && !error && <Loading />}
          {result && result.total === 0 && (
            <p className="text-sm text-muted-foreground">{copy?.empty}</p>
          )}
          {result && result.total > 0 && (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Recipient</TableHead>
                    <TableHead>What happened</TableHead>
                    <TableHead>Suppressed</TableHead>
                    <TableHead className="text-right">When</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {result.items.map((delivery) => {
                    const codes = [delivery.smtpCode, delivery.enhancedStatusCode]
                      .filter(Boolean)
                      .join(" ");
                    return (
                      <TableRow key={delivery.messageId} className="align-top">
                        <TableCell className="max-w-0 w-2/5">
                          <Link
                            href={`/contacts/${delivery.contactId}`}
                            className="block truncate hover:underline"
                          >
                            {delivery.email}
                          </Link>
                          {showSubjects && (
                            <span className="block truncate text-xs text-muted-foreground">
                              {emailSubjects?.[delivery.emailId] || "Untitled email"}
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="max-w-0 w-2/5 whitespace-normal">
                          <DeliveryOutcomeBadge
                            outcome={delivery.outcome}
                            bounceType={delivery.bounceType}
                          />
                          {(codes || delivery.reason) && (
                            <p className="mt-1 text-xs break-words text-muted-foreground">
                              {codes && <span className="font-mono">{codes}</span>}
                              {codes && delivery.reason && " · "}
                              {delivery.reason}
                            </p>
                          )}
                        </TableCell>
                        <TableCell className="whitespace-nowrap">
                          {delivery.suppression ? (
                            <Link
                              href="/suppressions"
                              className="text-sm hover:underline"
                              title="Open Suppressions"
                            >
                              Yes ·{" "}
                              {SUPPRESSION_REASON_LABEL[delivery.suppression.reason]}
                            </Link>
                          ) : (
                            <span className="text-sm text-muted-foreground">No</span>
                          )}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-right">
                          {formatDate(delivery.occurredAt)}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
              <ListPagination
                page={page}
                total={result.total}
                itemsPerPage={PER_PAGE}
                onPageChange={setPage}
              />
            </>
          )}
        </div>

        <DialogFooter className="mt-0 flex-nowrap items-center justify-between gap-6 border-t px-6 py-4">
          <p className="text-sm text-muted-foreground">
            Reasons come from your ESP and appear once it reports the bounce or
            complaint.
          </p>
          <div className="flex shrink-0 gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Close
            </Button>
            <Button asChild>
              <Link href="/suppressions">
                <ShieldAlert />
                Suppressions
              </Link>
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
