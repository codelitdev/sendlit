"use client";

import { ChevronDown } from "lucide-react";
import type { ReactNode } from "react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "./components/ui/collapsible";
import { Input } from "./components/ui/input";
import { Label } from "./components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./components/ui/select";
import {
  EventPropertyFilterEditor,
  type EventPropertyFilterEditorLabels,
} from "./event-property-filter-editor";
import { cn } from "./lib/utils";
import type {
  EventPropertyFilter,
  EventPropertyType,
  PropertyChangeFilter,
  TriggerType,
} from "./types";
import { ValueCombobox } from "./value-combobox";

export interface TriggerValueOption {
  value: string;
  label: string;
}

export interface TriggerValueInput {
  /** `combobox` lists `valueOptions[trigger]` and accepts a typed value. */
  type: "text" | "select" | "combobox";
  placeholder?: string;
  options?: TriggerValueOption[];
}

export interface TriggerOption {
  value: TriggerType | (string & {});
  label: string;
  needsData?: boolean;
  dataLabel?: string;
  valueInput?: TriggerValueInput;
}

const defaultTriggers: TriggerOption[] = [
  {
    value: "subscriber:added",
    label: "A new contact subscribes",
    needsData: false,
  },
  {
    value: "tag:added",
    label: "A tag is added to a contact",
    needsData: true,
    dataLabel: "Tag name",
    valueInput: { type: "text", placeholder: "e.g. vip" },
  },
  {
    value: "tag:removed",
    label: "A tag is removed from a contact",
    needsData: true,
    dataLabel: "Tag name",
    valueInput: { type: "text", placeholder: "e.g. vip" },
  },
  {
    value: "event:custom",
    label: "A custom event is received",
    needsData: true,
    dataLabel: "Event",
    valueInput: { type: "combobox", placeholder: "Choose or create an event" },
  },
  {
    value: "contact:property_changed",
    label: "A contact's custom field changes",
    needsData: true,
    dataLabel: "Custom field",
    valueInput: { type: "combobox", placeholder: "e.g. plan" },
  },
];

export interface TriggerPickerLabels {
  filterToggle: string;
  filterHint: string;
  changeFrom: string;
  changeTo: string;
  anyValue: string;
  createValue: (value: string) => string;
  search: string;
  noMatches: string;
  filterEditor?: Partial<EventPropertyFilterEditorLabels>;
}

export const defaultTriggerPickerLabels: TriggerPickerLabels = {
  filterToggle: "Only when the event's properties match…",
  filterHint: "Checked when the contact enters the sequence.",
  changeFrom: "From",
  changeTo: "To",
  anyValue: "Any value",
  createValue: (value) => `Create "${value}"`,
  search: "Search…",
  noMatches: "No matches.",
};

export interface TriggerPickerChange {
  triggerType: string;
  triggerData?: string | null;
  triggerFilter?: EventPropertyFilter | PropertyChangeFilter | null;
}

export interface TriggerPickerProps {
  triggerType?: string | null;
  triggerData?: string | null;
  triggerFilter?: EventPropertyFilter | PropertyChangeFilter | null;
  onChange: (value: TriggerPickerChange) => void;
  triggers?: TriggerOption[];
  /** Options for `combobox` value inputs, keyed by trigger, e.g. the
   * team's event names under `event:custom`. */
  valueOptions?: Partial<Record<string, string[]>>;
  /** Called for a typed combobox value that isn't an option yet (e.g. to
   * register a new event). Defaults to selecting it. */
  onCreateValue?: (trigger: string, value: string) => void;
  /** Known properties of the selected event, for the filter editor. */
  eventProperties?: { key: string; type: EventPropertyType }[];
  /** Rendered under the value input, e.g. "no events received yet". */
  valueFooter?: ReactNode;
  /** Shown above combobox options, e.g. while they load. */
  valueOptionsStatus?: ReactNode;
  label?: string;
  labels?: Partial<TriggerPickerLabels>;
  className?: string;
}

function scalarText(value: PropertyChangeFilter["from"]): string {
  return value === undefined || value === null ? "" : String(value);
}

/** Picks the event that enrolls contacts into a sequence. */
export function TriggerPicker({
  triggerType,
  triggerData,
  triggerFilter = null,
  onChange,
  triggers = defaultTriggers,
  valueOptions = {},
  onCreateValue,
  eventProperties,
  valueFooter,
  valueOptionsStatus,
  label = "Trigger",
  labels: labelOverrides,
  className,
}: TriggerPickerProps) {
  const labels = { ...defaultTriggerPickerLabels, ...labelOverrides };
  const current = triggers.find((t) => t.value === triggerType) ?? triggers[0];
  const emit = (patch: Partial<TriggerPickerChange>) =>
    onChange({ triggerType: current.value, triggerData, triggerFilter, ...patch });

  const eventFilter =
    current.value === "event:custom"
      ? (triggerFilter as EventPropertyFilter | null)
      : null;
  const changeFilter =
    current.value === "contact:property_changed"
      ? ((triggerFilter as PropertyChangeFilter | null) ?? {})
      : null;

  function setChangeSide(side: "from" | "to", raw: string) {
    const next: PropertyChangeFilter = { ...(changeFilter ?? {}) };
    if (raw === "") delete next[side];
    else next[side] = raw;
    emit({ triggerFilter: Object.keys(next).length ? next : null });
  }

  return (
    <div className={cn("space-y-3", className)}>
      <div className="space-y-1.5">
        <Label>{label}</Label>
        <Select
          value={current.value}
          onValueChange={(value) =>
            // A filter only makes sense for the trigger it was written for.
            onChange({ triggerType: value, triggerData, triggerFilter: null })
          }
        >
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {triggers.map((t) => (
              <SelectItem key={t.value} value={t.value}>
                {t.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {current.needsData && (
        <div className="space-y-1.5">
          <Label>{current.dataLabel ?? "Value"}</Label>
          {current.valueInput?.type === "select" ? (
            <Select
              value={triggerData ?? ""}
              onValueChange={(value) => emit({ triggerData: value })}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder={current.valueInput.placeholder} />
              </SelectTrigger>
              <SelectContent>
                {(current.valueInput.options ?? []).map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : current.valueInput?.type === "combobox" ? (
            <ValueCombobox
              aria-label={current.dataLabel}
              value={triggerData ?? ""}
              options={valueOptions[current.value] ?? []}
              onChange={(value) => emit({ triggerData: value })}
              onCreate={(value) => {
                emit({ triggerData: value });
                onCreateValue?.(current.value, value);
              }}
              placeholder={current.valueInput.placeholder}
              searchPlaceholder={labels.search}
              emptyLabel={labels.noMatches}
              createLabel={labels.createValue}
              status={valueOptionsStatus}
              monospace
            />
          ) : (
            <Input
              placeholder={current.valueInput?.placeholder}
              value={triggerData ?? ""}
              onChange={(e) => emit({ triggerData: e.target.value })}
            />
          )}
          {valueFooter}
        </div>
      )}

      {current.value === "event:custom" && (
        <Collapsible defaultOpen={!!eventFilter?.filters.length}>
          <CollapsibleTrigger className="group flex items-center gap-1 text-sm font-medium">
            <ChevronDown className="size-4 transition-transform group-data-[state=closed]:-rotate-90" />
            {labels.filterToggle}
          </CollapsibleTrigger>
          <CollapsibleContent className="space-y-2 pt-2">
            <p className="text-sm text-muted-foreground">{labels.filterHint}</p>
            <EventPropertyFilterEditor
              value={eventFilter}
              onChange={(filter) => emit({ triggerFilter: filter })}
              properties={eventProperties}
              labels={labels.filterEditor}
            />
          </CollapsibleContent>
        </Collapsible>
      )}

      {changeFilter && (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>{labels.changeFrom}</Label>
            <Input
              placeholder={labels.anyValue}
              value={scalarText(changeFilter.from)}
              onChange={(e) => setChangeSide("from", e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>{labels.changeTo}</Label>
            <Input
              placeholder={labels.anyValue}
              value={scalarText(changeFilter.to)}
              onChange={(e) => setChangeSide("to", e.target.value)}
            />
          </div>
        </div>
      )}
    </div>
  );
}
