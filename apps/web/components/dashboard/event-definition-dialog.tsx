"use client";

import type { EventDefinition, EventPropertyType } from "@sendlit/email-blocks";
import { Check, ChevronDown, Copy, Plus, Save, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Banner } from "@/components/dashboard/banner";
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
import { IconButton } from "@/components/ui/codelit/icon-button";
import { Input } from "@/components/ui/codelit/input";
import { Label } from "@/components/ui/codelit/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/codelit/select";
import { Textarea } from "@/components/ui/codelit/textarea";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  createEventDefinition,
  type EventDefinitionDetail,
  getEventDefinition,
  updateEventDefinition,
} from "@/lib/api";
import { ApiError } from "@/lib/api-client";
import { relativeTime } from "@/lib/time";

export const EVENTS_DOCS_URL = "https://docs.sendlit.app/developers/events";

const TYPES: EventPropertyType[] = [
  "string",
  "number",
  "boolean",
  "date",
  "object",
  "array",
];

type Row = { key: string; type: EventPropertyType; declared: boolean };

export function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <IconButton
      aria-label={label}
      onClick={() => {
        void navigator.clipboard.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
    >
      {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
    </IconButton>
  );
}

function trackSnippet(name: string, rows: Row[]) {
  const properties = rows.length
    ? `{ ${rows.map((row) => `${row.key}: …`).join(", ")} }`
    : "{}";
  return `await sendlit.events.track({
  email: user.email,
  eventName: ${JSON.stringify(name)},
  properties: ${properties},
});`;
}

/**
 * Registers an event before your app sends it, or edits one: description
 * and declared properties. Loops' Events page works the same way. `name`
 * null creates; a name edits. See docs/custom_events.md#events-page.
 */
export function EventDefinitionDialog({
  name,
  open,
  onOpenChange,
  onSaved,
}: {
  name: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: (definition: EventDefinition) => void;
}) {
  const editing = name !== null;
  const [definition, setDefinition] = useState<EventDefinitionDetail | null>(null);
  const [newName, setNewName] = useState("");
  const [description, setDescription] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setDefinition(null);
    if (!name) {
      setNewName("");
      setDescription("");
      setRows([]);
      return;
    }
    setLoading(true);
    getEventDefinition(name)
      .then((loaded) => {
        setDefinition(loaded);
        setDescription(loaded.description ?? "");
        setRows(loaded.properties);
      })
      .catch((err) =>
        setError(err instanceof ApiError ? err.message : "Couldn't load the event."),
      )
      .finally(() => setLoading(false));
  }, [open, name]);

  async function save() {
    setSaving(true);
    setError(null);
    const declared = rows
      .filter((row) => row.declared && row.key.trim())
      .map((row) => ({ key: row.key.trim(), type: row.type }));
    try {
      const saved = editing
        ? await updateEventDefinition(name, {
            description: description.trim() || null,
            properties: declared,
          })
        : await createEventDefinition({
            name: newName.trim(),
            description: description.trim() || undefined,
            properties: declared,
          });
      onSaved(saved);
      onOpenChange(false);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message === "event_definition_exists"
            ? "An event with this name already exists."
            : err.message === "event_name_limit_reached"
              ? "Your team has 500 events, the most it can have. Delete one you don't use."
              : err.message
          : "Couldn't save the event.",
      );
    } finally {
      setSaving(false);
    }
  }

  const title = editing ? name : newName.trim();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] flex-col p-0 sm:max-w-2xl">
        <DialogHeader className="gap-2 border-b px-6 pt-6 pb-5">
          <DialogTitle>
            {editing ? <span className="font-mono">{name}</span> : "Create an event"}
          </DialogTitle>
          <DialogDescription>
            Your app sends this event with{" "}
            <span className="font-mono">events.track()</span>, and sequences can start
            when it arrives. Declaring its properties shows them in the trigger builder
            and the email editor before the first event arrives.
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-6 py-5">
          {error && <Banner>{error}</Banner>}
          {loading ? (
            <Loading />
          ) : (
            <>
              {!editing && (
                <div className="space-y-1.5">
                  <Label htmlFor="event-name">Name</Label>
                  <Input
                    id="event-name"
                    className="font-mono"
                    placeholder="course purchased"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                  />
                  <p className="text-sm text-muted-foreground">
                    Names are case-sensitive and can't be changed later.
                  </p>
                </div>
              )}
              <div className="space-y-1.5">
                <Label htmlFor="event-description">Description</Label>
                <Textarea
                  id="event-description"
                  placeholder="Sent when a student buys a course."
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>Properties</Label>
                {rows.length === 0 && (
                  <p className="text-sm text-muted-foreground">
                    No properties yet. Add the ones your app sends, or they appear here
                    when the first event arrives.
                  </p>
                )}
                {rows.map((row, index) => (
                  <div
                    // biome-ignore lint/suspicious/noArrayIndexKey: rows have no stable id
                    key={index}
                    className="grid grid-cols-[1fr_10rem_auto] items-center gap-2"
                  >
                    <Input
                      aria-label="Property key"
                      className="font-mono"
                      value={row.key}
                      disabled={!row.declared}
                      onChange={(e) =>
                        setRows(
                          rows.map((r, i) =>
                            i === index ? { ...r, key: e.target.value } : r,
                          ),
                        )
                      }
                    />
                    <Select
                      value={row.type}
                      onValueChange={(type) =>
                        setRows(
                          rows.map((r, i) =>
                            i === index
                              ? {
                                  ...r,
                                  type: type as EventPropertyType,
                                  declared: true,
                                }
                              : r,
                          ),
                        )
                      }
                    >
                      <SelectTrigger aria-label="Property type">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {TYPES.map((type) => (
                          <SelectItem key={type} value={type}>
                            {type}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {row.declared ? (
                      <IconButton
                        aria-label="Remove property"
                        onClick={() => setRows(rows.filter((_, i) => i !== index))}
                      >
                        <X className="size-4" />
                      </IconButton>
                    ) : (
                      <span className="w-9 text-xs text-muted-foreground">seen</span>
                    )}
                  </div>
                ))}
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    setRows([...rows, { key: "", type: "string", declared: true }])
                  }
                >
                  <Plus className="size-4" />
                  Add property
                </Button>
              </div>
              {definition?.lastProperties && (
                <Collapsible>
                  <CollapsibleTrigger className="group flex items-center gap-1 text-sm font-medium">
                    <ChevronDown className="size-4 transition-transform group-data-[state=closed]:-rotate-90" />
                    Last payload received
                  </CollapsibleTrigger>
                  <CollapsibleContent className="pt-2">
                    <div className="flex items-start gap-2">
                      <pre className="min-w-0 flex-1 overflow-x-auto rounded-md bg-muted p-3 font-mono text-xs">
                        {JSON.stringify(definition.lastProperties, null, 2)}
                      </pre>
                      <CopyButton
                        label="Copy payload"
                        value={JSON.stringify(definition.lastProperties, null, 2)}
                      />
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              )}
              {title && (
                <Collapsible>
                  <CollapsibleTrigger className="group flex items-center gap-1 text-sm font-medium">
                    <ChevronDown className="size-4 transition-transform group-data-[state=closed]:-rotate-90" />
                    How does my app send it?
                  </CollapsibleTrigger>
                  <CollapsibleContent className="pt-2">
                    <div className="flex items-start gap-2">
                      <pre className="min-w-0 flex-1 overflow-x-auto rounded-md bg-muted p-3 font-mono text-xs">
                        {trackSnippet(title, rows)}
                      </pre>
                      <CopyButton
                        label="Copy snippet"
                        value={trackSnippet(title, rows)}
                      />
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              )}
            </>
          )}
        </div>

        <DialogFooter className="mt-0 flex-wrap justify-between gap-3 border-t px-6 py-4">
          <p className="text-sm text-muted-foreground">
            {definition?.lastSeenAt
              ? `Last received ${relativeTime(definition.lastSeenAt)}.`
              : "Not received yet."}
          </p>
          <div className="flex gap-2.5">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Close
            </Button>
            <Button
              disabled={saving || loading || (!editing && !newName.trim())}
              onClick={() => void save()}
            >
              <Save className="size-4" />
              {saving ? "Saving…" : editing ? "Save" : "Create event"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
