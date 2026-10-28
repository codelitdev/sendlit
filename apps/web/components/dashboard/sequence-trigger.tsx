"use client";

import {
  type EventDefinition,
  type EventPropertyFilter,
  type PropertyChangeFilter,
  type ReentryMode,
  TriggerPicker,
} from "@sendlit/email-blocks";
import { ChevronDown, Zap } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Banner } from "@/components/dashboard/banner";
import { CopyButton } from "@/components/dashboard/event-definition-dialog";
import { Loading } from "@/components/dashboard/loading";
import { SendTestEventDialog } from "@/components/dashboard/send-test-event-dialog";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Button } from "@/components/ui/codelit/button";
import { Input } from "@/components/ui/codelit/input";
import { Label } from "@/components/ui/codelit/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/codelit/select";
import {
  createEventDefinition,
  type EventDefinitionDetail,
  getEventDefinition,
  listEventDefinitions,
} from "@/lib/api";

export interface SequenceTriggerValue {
  triggerType?: string | null;
  triggerData?: string | null;
  triggerFilter?: EventPropertyFilter | PropertyChangeFilter | null;
  reentry: ReentryMode;
  reentryPeriodDays?: number | null;
}

/**
 * The sequence's trigger and who can enter it. For a custom event it lists
 * the team's events, can register a new one ("Create …"), filters on its
 * properties, and offers a test event when none has been received yet.
 * See docs/custom_events.md#sequence-builder.
 */
export function SequenceTrigger({
  meta,
  onChange,
}: {
  meta: SequenceTriggerValue;
  onChange: (patch: Partial<SequenceTriggerValue>) => void;
}) {
  const [definitions, setDefinitions] = useState<EventDefinition[] | null>(null);
  const [definitionsFailed, setDefinitionsFailed] = useState(false);
  const [detail, setDetail] = useState<EventDefinitionDetail | null>(null);
  const [testing, setTesting] = useState(false);
  const isEvent = meta.triggerType === "event:custom";
  const eventName = isEvent ? meta.triggerData?.trim() || null : null;

  const loadDefinitions = useCallback(async () => {
    try {
      setDefinitions(await listEventDefinitions());
      setDefinitionsFailed(false);
    } catch {
      setDefinitionsFailed(true);
    }
  }, []);

  const loadDetail = useCallback(async (name: string | null) => {
    if (!name) {
      setDetail(null);
      return;
    }
    try {
      setDetail(await getEventDefinition(name));
    } catch {
      setDetail(null);
    }
  }, []);

  useEffect(() => {
    if (isEvent && !definitions && !definitionsFailed) void loadDefinitions();
  }, [isEvent, definitions, definitionsFailed, loadDefinitions]);

  useEffect(() => {
    void loadDetail(eventName);
  }, [eventName, loadDetail]);

  const neverReceived = !!eventName && !detail?.lastSeenAt;

  return (
    <div className="space-y-4">
      <TriggerPicker
        triggerType={meta.triggerType}
        triggerData={meta.triggerData}
        triggerFilter={meta.triggerFilter ?? null}
        onChange={({ triggerType, triggerData, triggerFilter }) =>
          onChange({ triggerType, triggerData, triggerFilter: triggerFilter ?? null })
        }
        valueOptions={{ "event:custom": definitions?.map((d) => d.name) ?? [] }}
        valueOptionsStatus={
          !isEvent ? undefined : definitionsFailed ? (
            <p className="px-3 py-2 text-sm text-muted-foreground">
              Couldn't load your events. You can still type a name.
            </p>
          ) : !definitions ? (
            <Loading className="min-h-16" />
          ) : undefined
        }
        onCreateValue={(trigger, value) => {
          // Registering it makes it show up for other sequences and on the
          // Events page before the first event arrives (as in Loops).
          if (trigger !== "event:custom") return;
          void createEventDefinition({ name: value })
            .catch(() => undefined)
            .then(() => loadDefinitions());
        }}
        eventProperties={detail?.properties}
        valueFooter={
          neverReceived ? (
            <Banner
              variant="warning"
              className="flex flex-wrap items-center justify-between gap-2"
            >
              <span>
                No <span className="font-mono">{eventName}</span> events received yet.
              </span>
              <Button size="sm" variant="outline" onClick={() => setTesting(true)}>
                <Zap className="size-4" />
                Send test event
              </Button>
            </Banner>
          ) : eventName ? (
            <div className="flex justify-end">
              <Button size="sm" variant="ghost" onClick={() => setTesting(true)}>
                <Zap className="size-4" />
                Send test event
              </Button>
            </div>
          ) : undefined
        }
      />

      {isEvent && detail?.lastProperties && (
        <Collapsible>
          <CollapsibleTrigger className="group flex items-center gap-1 text-sm font-medium">
            <ChevronDown className="size-4 transition-transform group-data-[state=closed]:-rotate-90" />
            Last payload received
          </CollapsibleTrigger>
          <CollapsibleContent className="pt-2">
            <div className="flex items-start gap-2">
              <pre className="min-w-0 flex-1 overflow-x-auto rounded-md bg-muted p-3 font-mono text-xs">
                {JSON.stringify(detail.lastProperties, null, 2)}
              </pre>
              <CopyButton
                label="Copy payload"
                value={JSON.stringify(detail.lastProperties, null, 2)}
              />
            </div>
          </CollapsibleContent>
        </Collapsible>
      )}

      <div className="space-y-1.5">
        <Label>Who can enter</Label>
        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={meta.reentry}
            onValueChange={(reentry) => onChange({ reentry: reentry as ReentryMode })}
          >
            <SelectTrigger className="w-full sm:w-72">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="every_time">Every time the trigger happens</SelectItem>
              <SelectItem value="once">Only once</SelectItem>
              <SelectItem value="once_per_period">Once every N days</SelectItem>
            </SelectContent>
          </Select>
          {meta.reentry === "once_per_period" && (
            <div className="flex items-center gap-2 text-sm">
              <Input
                aria-label="Days"
                type="number"
                min={1}
                max={365}
                className="w-24"
                value={meta.reentryPeriodDays ?? 7}
                onChange={(e) =>
                  onChange({ reentryPeriodDays: Number(e.target.value) || null })
                }
              />
              days
            </div>
          )}
        </div>
        <p className="text-sm text-muted-foreground">
          A contact who is already in this sequence is never added twice.
        </p>
      </div>

      <SendTestEventDialog
        name={eventName}
        open={testing}
        onOpenChange={setTesting}
        onSent={() => {
          void loadDetail(eventName);
          void loadDefinitions();
        }}
      />
    </div>
  );
}
