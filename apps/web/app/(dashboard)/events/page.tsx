"use client";

import type { EventDefinition } from "@sendlit/email-blocks";
import { MoreHorizontal, Pencil, Plus, Trash2, Zap } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Banner } from "@/components/dashboard/banner";
import { useSetBreadcrumb } from "@/components/dashboard/breadcrumb-context";
import { DeleteConfirmationDialog } from "@/components/dashboard/delete-confirmation-dialog";
import {
  EVENTS_DOCS_URL,
  EventDefinitionDialog,
} from "@/components/dashboard/event-definition-dialog";
import { Loading } from "@/components/dashboard/loading";
import { PageHeader } from "@/components/dashboard/page-header";
import { ScrollablePage } from "@/components/dashboard/scrollable-page";
import { SendTestEventDialog } from "@/components/dashboard/send-test-event-dialog";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/codelit/badge";
import { Button } from "@/components/ui/codelit/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/codelit/dropdown-menu";
import { IconButton } from "@/components/ui/codelit/icon-button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { deleteEventDefinition, listEventDefinitions } from "@/lib/api";
import { ApiError } from "@/lib/api-client";
import { relativeTime } from "@/lib/time";

/**
 * The team's events (Loops' Events page): registered by hand, or on the
 * first event the app sends. See docs/custom_events.md#events-page.
 */
export default function EventsPage() {
  useSetBreadcrumb([{ label: "Events" }]);
  const [events, setEvents] = useState<EventDefinition[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ name: string | null } | null>(null);
  const [testing, setTesting] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setEvents(await listEventDefinitions());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't load events.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <ScrollablePage>
      <PageHeader
        title="Events"
        description="Events your app sends with events.track(). Sequences can start when one arrives, and its properties can be used in their emails."
        action={
          <Button onClick={() => setEditing({ name: null })}>
            <Plus className="size-4" />
            Create event
          </Button>
        }
      />
      {error && <Banner className="mb-4">{error}</Banner>}
      {!events && !error ? (
        <Loading className="min-h-64" />
      ) : events && events.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <p className="text-sm text-muted-foreground">
              No events yet. Create one here, or send one from your app and it shows up
              automatically.
            </p>
            <div className="flex gap-2">
              <Button onClick={() => setEditing({ name: null })}>
                <Plus className="size-4" />
                Create event
              </Button>
              <Button variant="outline" asChild>
                <Link href={EVENTS_DOCS_URL} target="_blank">
                  How to send events
                </Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        events && (
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Event</TableHead>
                    <TableHead>Properties</TableHead>
                    <TableHead>Last received</TableHead>
                    <TableHead>Used by</TableHead>
                    <TableHead className="w-12" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {events.map((event) => (
                    <TableRow key={event.name}>
                      <TableCell>
                        <button
                          type="button"
                          className="text-left"
                          onClick={() => setEditing({ name: event.name })}
                        >
                          <span className="font-mono font-medium">{event.name}</span>
                          {event.description && (
                            <span className="block text-sm text-muted-foreground">
                              {event.description}
                            </span>
                          )}
                        </button>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {event.properties.length}
                      </TableCell>
                      <TableCell>
                        {event.lastSeenAt ? (
                          <span
                            className="text-sm"
                            title={new Date(event.lastSeenAt).toLocaleString()}
                          >
                            {relativeTime(event.lastSeenAt)}
                          </span>
                        ) : (
                          <Badge variant="neutral">Never received</Badge>
                        )}
                        {event.origin === "manual" && (
                          <Badge variant="outline" className="ml-2">
                            Created by hand
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-sm">
                        {event.sequenceCount === 0
                          ? "No sequences"
                          : `${event.sequenceCount} sequence${event.sequenceCount === 1 ? "" : "s"}`}
                      </TableCell>
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <IconButton aria-label={`Actions for ${event.name}`}>
                              <MoreHorizontal className="size-4" />
                            </IconButton>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem
                              onSelect={() => setEditing({ name: event.name })}
                            >
                              <Pencil className="size-4" />
                              Edit
                            </DropdownMenuItem>
                            <DropdownMenuItem onSelect={() => setTesting(event.name)}>
                              <Zap className="size-4" />
                              Send test event
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              disabled={event.sequenceCount > 0}
                              title={
                                event.sequenceCount > 0
                                  ? "Sequences use this event. Change their trigger first."
                                  : undefined
                              }
                              onSelect={() => setDeleting(event.name)}
                            >
                              <Trash2 className="size-4" />
                              {event.sequenceCount > 0
                                ? "Delete (used by sequences)"
                                : "Delete"}
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )
      )}

      <EventDefinitionDialog
        name={editing?.name ?? null}
        open={editing !== null}
        onOpenChange={(open) => !open && setEditing(null)}
        onSaved={() => void load()}
      />
      <SendTestEventDialog
        name={testing}
        open={testing !== null}
        onOpenChange={(open) => !open && setTesting(null)}
        onSent={() => void load()}
      />
      <DeleteConfirmationDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={`Delete ${deleting ?? "event"}?`}
        description="It leaves your list of events. Events already received are kept, and the next one with this name adds it back."
        onConfirm={async () => {
          if (!deleting) return;
          try {
            await deleteEventDefinition(deleting);
            setDeleting(null);
            await load();
          } catch (err) {
            setError(
              err instanceof ApiError ? err.message : "Couldn't delete the event.",
            );
          }
        }}
      />
    </ScrollablePage>
  );
}
