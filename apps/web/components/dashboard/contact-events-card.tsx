"use client";

import type { ContactEvent } from "@sendlit/api-contract";
import { ChevronDown, Zap } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  CopyButton,
  EVENTS_DOCS_URL,
} from "@/components/dashboard/event-definition-dialog";
import { Loading } from "@/components/dashboard/loading";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Badge } from "@/components/ui/codelit/badge";
import { Button } from "@/components/ui/codelit/button";
import { getContactEvents } from "@/lib/api";
import { relativeTime } from "@/lib/time";

const PAGE_SIZE = 10;

/**
 * The custom events received for a contact, newest first, with the
 * sequences each one started. Loads on its own so a failure here doesn't
 * block the rest of the contact page.
 */
export function ContactEventsCard({ contactId }: { contactId: string }) {
  const [events, setEvents] = useState<ContactEvent[] | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loadingMore, setLoadingMore] = useState(false);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    setFailed(false);
    setEvents(null);
    try {
      const result = await getContactEvents(contactId, { page: 1, limit: PAGE_SIZE });
      setEvents(result.items);
      setTotal(result.total);
      setPage(1);
    } catch {
      setFailed(true);
    }
  }, [contactId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function loadMore() {
    setLoadingMore(true);
    try {
      const result = await getContactEvents(contactId, {
        page: page + 1,
        limit: PAGE_SIZE,
      });
      setEvents([...(events ?? []), ...result.items]);
      setTotal(result.total);
      setPage(page + 1);
    } catch {
      setFailed(true);
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Events</CardTitle>
      </CardHeader>
      <CardContent>
        {failed ? (
          <div className="flex items-center justify-between gap-3 text-sm">
            <p className="text-muted-foreground">
              Couldn't load this contact's events.
            </p>
            <Button size="sm" variant="outline" onClick={() => void load()}>
              Retry
            </Button>
          </div>
        ) : !events ? (
          <Loading />
        ) : events.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No events yet. They appear here when your app{" "}
            <Link href={EVENTS_DOCS_URL} target="_blank" className="underline">
              sends one
            </Link>{" "}
            for this contact.
          </p>
        ) : (
          <div className="space-y-2">
            <ul className="space-y-2">
              {events.map((event) => (
                <li key={event.eventId} className="rounded-lg border p-3 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <Zap className="size-4 shrink-0 text-muted-foreground" />
                    <span className="font-mono font-medium">{event.name}</span>
                    <span
                      className="text-xs text-muted-foreground"
                      title={`Happened ${new Date(event.occurredAt).toLocaleString()}, received ${new Date(event.receivedAt).toLocaleString()}`}
                    >
                      {relativeTime(event.occurredAt)}
                    </span>
                    {!event.triggers && (
                      <Badge variant="neutral">
                        {event.backfill
                          ? "Backfill"
                          : "Not triggered (older than 72 hours)"}
                      </Badge>
                    )}
                  </div>
                  {event.enrolledSequences.length > 0 && (
                    <p className="mt-1.5 text-xs text-muted-foreground">
                      Started{" "}
                      {event.enrolledSequences.map((sequence, index) => (
                        <span key={sequence.sequenceId}>
                          {index > 0 && ", "}
                          <Link
                            href={`/sequences/${sequence.sequenceId}`}
                            className="underline"
                          >
                            {sequence.title || "Untitled sequence"}
                          </Link>
                        </span>
                      ))}
                    </p>
                  )}
                  {Object.keys(event.properties).length > 0 && (
                    <Collapsible>
                      <CollapsibleTrigger className="group mt-1.5 flex items-center gap-1 text-xs font-medium">
                        <ChevronDown className="size-3.5 transition-transform group-data-[state=closed]:-rotate-90" />
                        Properties
                      </CollapsibleTrigger>
                      <CollapsibleContent className="pt-2">
                        <div className="flex items-start gap-2">
                          <pre className="min-w-0 flex-1 overflow-x-auto rounded-md bg-muted p-3 font-mono text-xs">
                            {JSON.stringify(event.properties, null, 2)}
                          </pre>
                          <CopyButton
                            label="Copy properties"
                            value={JSON.stringify(event.properties, null, 2)}
                          />
                        </div>
                      </CollapsibleContent>
                    </Collapsible>
                  )}
                </li>
              ))}
            </ul>
            {events.length < total &&
              (loadingMore ? (
                <Loading className="min-h-16" />
              ) : (
                <Button size="sm" variant="outline" onClick={() => void loadMore()}>
                  Load more
                </Button>
              ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
