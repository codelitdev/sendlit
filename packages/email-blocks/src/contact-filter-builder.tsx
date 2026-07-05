"use client";

import { useMemo, useState, type FormEvent } from "react";
import { ChartPie, Filter, Save, Search, Trash2, X } from "lucide-react";
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
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "./components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./components/ui/select";
import { cn } from "./lib/utils";
import type {
  ContactFilterCondition,
  ContactFilterName,
  ContactFilterWithAggregator,
} from "./types";

export interface ContactFilterOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface ContactFilterValueInput {
  type: "text" | "date" | "select" | "none";
  label?: string;
  placeholder?: string;
  options?: ContactFilterOption[];
  dateValueFormat?: "date" | "timestamp";
}

export interface ContactFilterDefinition {
  name: ContactFilterName;
  label: string;
  conditions: ContactFilterOption[];
  valueInput?: ContactFilterValueInput;
}

export interface ContactFilterSegment {
  id: string;
  name: string;
  filter: ContactFilterWithAggregator;
}

export interface ContactFilterBuilderProps {
  value: ContactFilterWithAggregator;
  onChange: (value: ContactFilterWithAggregator) => void;
  filterDefinitions?: ContactFilterDefinition[];
  segments?: ContactFilterSegment[];
  selectedSegmentId?: string;
  onSegmentSelect?: (segment: ContactFilterSegment) => void;
  onSaveSegment?: (
    name: string,
    value: ContactFilterWithAggregator,
  ) => void | Promise<void>;
  onDeleteSegment?: (segment: ContactFilterSegment) => void | Promise<void>;
  count?: number;
  countLabel?: string;
  className?: string;
  disabled?: boolean;
  defaultSegmentLabel?: string;
  segmentsHeading?: string;
  segmentsDescription?: string;
  saveSegmentDescription?: string;
  deleteSegmentTitle?: string;
  deleteSegmentDescription?: (segment: ContactFilterSegment) => string;
  filtersButtonLabel?: string;
  addFilterHeading?: string;
  applyLabel?: string;
  cancelLabel?: string;
  deleteLabel?: string;
  saveLabel?: string;
  clearFiltersLabel?: string;
  saveSegmentButtonLabel?: string;
  segmentNameLabel?: string;
  aggregatorAnyLabel?: string;
  aggregatorAllLabel?: string;
  aggregatorAriaLabel?: string;
  searchPlaceholder?: string;
  searchAriaLabel?: string;
  segmentTriggerSrLabel?: string;
}

const defaultSegment: ContactFilterSegment = {
  id: "",
  name: "Everyone",
  filter: { aggregator: "or", filters: [] },
};

const defaultFilterDefinitions: ContactFilterDefinition[] = [
  {
    name: "email",
    label: "Email",
    conditions: [
      { value: "is", label: "is exactly" },
      { value: "contains", label: "contains" },
      { value: "not_contains", label: "does not contain" },
    ],
    valueInput: {
      type: "text",
      label: "Email value",
      placeholder: "e.g. @gmail.com",
    },
  },
  {
    name: "tag",
    label: "Tag",
    conditions: [
      { value: "is", label: "has" },
      { value: "is_not", label: "does not have" },
    ],
    valueInput: {
      type: "text",
      label: "Tag value",
      placeholder: "e.g. customers",
    },
  },
  {
    name: "subscription",
    label: "Subscription",
    conditions: [{ value: "is", label: "is" }],
    valueInput: {
      type: "select",
      label: "Subscription status",
      options: [
        { value: "subscribed", label: "Subscribed" },
        { value: "unsubscribed", label: "Unsubscribed" },
      ],
    },
  },
  {
    name: "signedUp",
    label: "Signed up",
    conditions: [
      { value: "before", label: "before" },
      { value: "after", label: "after" },
      { value: "on", label: "on" },
    ],
    valueInput: {
      type: "date",
      label: "Signup date",
      dateValueFormat: "timestamp",
    },
  },
];

function emptyFilter(
  definition: ContactFilterDefinition,
): ContactFilterCondition {
  return {
    name: definition.name,
    condition: definition.conditions[0]?.value ?? "",
    value: definition.valueInput?.type === "none" ? "true" : "",
  };
}

function definitionFor(
  definitions: ContactFilterDefinition[],
  name: ContactFilterName,
): ContactFilterDefinition {
  return (
    definitions.find((definition) => definition.name === name) ?? {
      name,
      label: name,
      conditions: [{ value: "is", label: "is" }],
      valueInput: { type: "text", label: `${name} value` },
    }
  );
}

function filterTypeLabel(
  definitions: ContactFilterDefinition[],
  name: ContactFilterName,
): string {
  return definitionFor(definitions, name).label;
}

function conditionLabel(
  definitions: ContactFilterDefinition[],
  filter: ContactFilterCondition,
): string {
  const definition = definitionFor(definitions, filter.name);
  return (
    definition.conditions.find(
      (condition) => condition.value === filter.condition,
    )?.label ?? filter.condition
  );
}

function filterValueLabel(
  definitions: ContactFilterDefinition[],
  filter: ContactFilterCondition,
): string {
  if (filter.valueLabel) return filter.valueLabel;
  const definition = definitionFor(definitions, filter.name);
  const selectedOption = definition.valueInput?.options?.find(
    (option) => option.value === filter.value,
  );
  if (selectedOption) {
    return selectedOption.label;
  }
  if (definition.valueInput?.type === "date" && filter.value) {
    const date =
      definition.valueInput.dateValueFormat === "date"
        ? new Date(filter.value)
        : new Date(Number(filter.value));

    return date.toLocaleDateString(undefined, {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  }
  return filter.value;
}

function ValueInput({
  definition,
  filter,
  onChange,
  label,
}: {
  definition: ContactFilterDefinition;
  filter: ContactFilterCondition;
  onChange: (value: string, valueLabel?: string) => void;
  label: string;
}) {
  const input = definition.valueInput ?? { type: "text" as const };

  if (input.type === "none") {
    return null;
  }

  if (input.type === "select") {
    return (
      <Select
        value={filter.value}
        onValueChange={(value) =>
          onChange(
            value,
            input.options?.find((option) => option.value === value)?.label,
          )
        }
      >
        <SelectTrigger aria-label={label}>
          <SelectValue placeholder={input.placeholder} />
        </SelectTrigger>
        <SelectContent>
          {(input.options ?? []).map((option) => (
            <SelectItem
              key={option.value}
              value={option.value}
              disabled={option.disabled}
            >
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }

  if (input.type === "date") {
    const value =
      input.dateValueFormat === "date"
        ? filter.value
        : filter.value
          ? new Date(Number(filter.value)).toISOString().slice(0, 10)
          : "";

    return (
      <Input
        type="date"
        aria-label={label}
        value={value}
        onChange={(e) =>
          onChange(
            e.target.value
              ? input.dateValueFormat === "date"
                ? e.target.value
                : String(new Date(e.target.value).getTime())
              : "",
          )
        }
      />
    );
  }

  return (
    <Input
      aria-label={label}
      placeholder={input.placeholder}
      value={filter.value}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

/**
 * CourseLit-style segmentation control for contact filters: segment picker,
 * filter popover, email search, applied chips, match dropdown, clear, and
 * optional save-segment action.
 */
export function ContactFilterBuilder({
  value,
  onChange,
  filterDefinitions,
  segments,
  selectedSegmentId = "",
  onSegmentSelect,
  onSaveSegment,
  onDeleteSegment,
  count,
  countLabel = "Users",
  className,
  disabled = false,
  defaultSegmentLabel = "Everyone",
  segmentsHeading = "Segments",
  segmentsDescription = "Separate contacts into distinct groups.",
  saveSegmentDescription = "You can access the saved segments from the Segments dropdown",
  deleteSegmentTitle = "Delete Segment",
  deleteSegmentDescription = (segment) =>
    `Are you sure you want to delete the segment "${segment.name}"? This action cannot be undone.`,
  filtersButtonLabel = "Filters",
  addFilterHeading = "Add filter",
  applyLabel = "Apply",
  cancelLabel = "Cancel",
  deleteLabel = "Delete",
  saveLabel = "Save",
  clearFiltersLabel = "Clear filters",
  saveSegmentButtonLabel = "Save new segment",
  segmentNameLabel = "Segment name",
  aggregatorAnyLabel = "Any",
  aggregatorAllLabel = "All",
  aggregatorAriaLabel = "Match contacts by",
  searchPlaceholder = "Search by email",
  searchAriaLabel = "Search contacts by email",
  segmentTriggerSrLabel = "segment",
}: ContactFilterBuilderProps) {
  const filters = value?.filters ?? [];
  const aggregator = value?.aggregator ?? "or";
  const definitions = filterDefinitions ?? defaultFilterDefinitions;
  const defaultDefinition = definitions[0] ?? defaultFilterDefinitions[0];
  const [filterOpen, setFilterOpen] = useState(false);
  const [segmentOpen, setSegmentOpen] = useState(false);
  const [saveSegmentOpen, setSaveSegmentOpen] = useState(false);
  const [segmentName, setSegmentName] = useState("");
  const [savingSegment, setSavingSegment] = useState(false);
  const [segmentPendingDelete, setSegmentPendingDelete] =
    useState<ContactFilterSegment>();
  const [deletingSegment, setDeletingSegment] = useState(false);
  const [searchEmail, setSearchEmail] = useState("");
  const [activeFilterName, setActiveFilterName] = useState<ContactFilterName>();
  const activeDefinition = activeFilterName
    ? definitionFor(definitions, activeFilterName)
    : undefined;
  const [draftFilter, setDraftFilter] = useState<ContactFilterCondition>(() =>
    emptyFilter(defaultDefinition),
  );

  const resolvedDefaultSegment: ContactFilterSegment = {
    ...defaultSegment,
    name: defaultSegmentLabel,
  };
  const allSegments = useMemo(
    () => [resolvedDefaultSegment, ...(segments ?? [])],
    [segments, defaultSegmentLabel],
  );
  const selectedSegment =
    allSegments.find((segment) => segment.id === selectedSegmentId) ??
    resolvedDefaultSegment;

  function setFilters(nextFilters: ContactFilterCondition[]) {
    onChange({ aggregator, filters: nextFilters });
  }

  function updateAggregator(nextAggregator: "and" | "or") {
    onChange({ aggregator: nextAggregator, filters });
  }

  function addFilter(filter: ContactFilterCondition) {
    if (!filter.value) return;
    setFilters([...filters, filter]);
    setDraftFilter(emptyFilter(definitionFor(definitions, filter.name)));
    setActiveFilterName(undefined);
    setFilterOpen(false);
  }

  function addEmailSearchFilter() {
    const value = searchEmail.trim();
    if (!value) return;
    setFilters([
      ...filters,
      {
        name: "email",
        condition: "contains",
        value,
      },
    ]);
    setSearchEmail("");
  }

  function removeFilter(index: number) {
    setFilters(filters.filter((_, filterIndex) => filterIndex !== index));
  }

  function clearFilters() {
    onChange({ aggregator: "or", filters: [] });
  }

  function filterAccessibleLabel(filter: ContactFilterCondition): string {
    return `${filterTypeLabel(definitions, filter.name)} ${conditionLabel(definitions, filter)} ${filterValueLabel(definitions, filter)}`;
  }

  async function submitSaveSegment(event: FormEvent) {
    event.preventDefault();
    const trimmedName = segmentName.trim();
    if (!trimmedName || !onSaveSegment) return;
    try {
      setSavingSegment(true);
      await onSaveSegment(trimmedName, value);
      setSegmentName("");
      setSaveSegmentOpen(false);
    } finally {
      setSavingSegment(false);
    }
  }

  async function confirmDeleteSegment() {
    if (!segmentPendingDelete || !onDeleteSegment) return;
    try {
      setDeletingSegment(true);
      await onDeleteSegment(segmentPendingDelete);
      if (segmentPendingDelete.id === selectedSegmentId) {
        onChange(resolvedDefaultSegment.filter);
        onSegmentSelect?.(resolvedDefaultSegment);
      }
      setSegmentPendingDelete(undefined);
    } finally {
      setDeletingSegment(false);
    }
  }

  return (
    <div className={cn("space-y-3", className)}>
      <div className="flex flex-wrap items-center gap-2">
        <Popover open={segmentOpen} onOpenChange={setSegmentOpen}>
          <PopoverTrigger asChild>
            <Button type="button" variant="outline" className="gap-2">
              <ChartPie className="size-4" />
              {selectedSegment.name}
              <span className="sr-only">{segmentTriggerSrLabel}</span>
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-80 p-2">
            <div className="px-2 py-2">
              <p className="text-sm font-semibold">{segmentsHeading}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {segmentsDescription}
              </p>
            </div>
            <div className="mt-1 space-y-1">
              {allSegments.map((segment) => (
                <div
                  key={segment.id}
                  className={cn(
                    "group flex items-center justify-between gap-1 rounded-md hover:bg-accent hover:text-accent-foreground",
                    segment.id === selectedSegmentId &&
                      "bg-accent text-accent-foreground",
                  )}
                >
                  <button
                    type="button"
                    className="flex-1 truncate rounded-md px-2 py-2 text-left text-sm"
                    aria-current={
                      segment.id === selectedSegmentId ? "true" : undefined
                    }
                    onClick={() => {
                      onChange(segment.filter);
                      onSegmentSelect?.(segment);
                      setSegmentOpen(false);
                    }}
                  >
                    <span className="truncate">{segment.name}</span>
                  </button>
                  {segment.id && onDeleteSegment && !disabled && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="mr-1 size-8 shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
                      aria-label={`Delete segment: ${segment.name}`}
                      onClick={(event) => {
                        event.stopPropagation();
                        setSegmentPendingDelete(segment);
                      }}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  )}
                </div>
              ))}
            </div>
          </PopoverContent>
        </Popover>

        <Popover
          open={filterOpen}
          onOpenChange={(open) => {
            setFilterOpen(open);
            if (!open) {
              setActiveFilterName(undefined);
            }
          }}
        >
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="outline"
              className="gap-2"
              disabled={disabled}
            >
              <Filter className="size-4" />
              {filtersButtonLabel}
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-80">
            {!activeDefinition ? (
              <div className="space-y-1">
                <p
                  id="contact-filter-add-title"
                  className="px-2 pb-2 text-sm font-semibold"
                >
                  {addFilterHeading}
                </p>
                {definitions.map((definition) => (
                  <button
                    key={definition.name}
                    type="button"
                    className="block w-full rounded-md px-2 py-2 text-left text-sm hover:bg-accent hover:text-accent-foreground"
                    onClick={() => {
                      setActiveFilterName(definition.name);
                      setDraftFilter(emptyFilter(definition));
                    }}
                  >
                    {definition.label}
                  </button>
                ))}
              </div>
            ) : (
              <div className="space-y-4">
                <p
                  id="contact-filter-add-title"
                  className="text-sm font-semibold"
                >
                  {activeDefinition.label}
                </p>

                <Select
                  value={draftFilter.condition}
                  onValueChange={(condition) =>
                    setDraftFilter({ ...draftFilter, condition })
                  }
                >
                  <SelectTrigger
                    aria-label={`${activeDefinition.label} condition`}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {activeDefinition.conditions.map((condition) => (
                      <SelectItem key={condition.value} value={condition.value}>
                        {condition.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <ValueInput
                  definition={activeDefinition}
                  filter={draftFilter}
                  label={
                    activeDefinition.valueInput?.label ??
                    `${activeDefinition.label} value`
                  }
                  onChange={(filterValue, valueLabel) =>
                    setDraftFilter({
                      ...draftFilter,
                      value: filterValue,
                      valueLabel,
                    })
                  }
                />

                <div className="flex justify-between gap-2">
                  <Button
                    type="button"
                    disabled={!draftFilter.value}
                    onClick={() => addFilter(draftFilter)}
                  >
                    {applyLabel}
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => {
                      setActiveFilterName(undefined);
                      setFilterOpen(false);
                    }}
                  >
                    {cancelLabel}
                  </Button>
                </div>
              </div>
            )}
          </PopoverContent>
        </Popover>

        <form
          className="relative min-w-56 flex-1 sm:max-w-md"
          onSubmit={(event) => {
            event.preventDefault();
            addEmailSearchFilter();
          }}
        >
          <Input
            aria-label={searchAriaLabel}
            placeholder={searchPlaceholder}
            value={searchEmail}
            onChange={(event) => setSearchEmail(event.target.value)}
            onBlur={addEmailSearchFilter}
            className="pr-10"
            disabled={disabled}
          />
          <Button
            type="submit"
            variant="ghost"
            size="icon"
            className="absolute right-0 top-0 h-full"
            disabled={disabled || !searchEmail.trim()}
            aria-label={searchAriaLabel}
          >
            <Search className="size-4" />
          </Button>
        </form>

        {typeof count === "number" && (
          <p className="text-sm text-muted-foreground" aria-live="polite">
            {count} {countLabel}
          </p>
        )}
      </div>

      {filters.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={aggregator}
            disabled={disabled}
            onValueChange={(value) => updateAggregator(value as "and" | "or")}
          >
            <SelectTrigger className="h-10 w-24" aria-label={aggregatorAriaLabel}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="or">{aggregatorAnyLabel}</SelectItem>
              <SelectItem value="and">{aggregatorAllLabel}</SelectItem>
            </SelectContent>
          </Select>

          {filters.map((filter, index) => (
            <div
              key={`${filter.name}-${filter.condition}-${filter.value}-${index}`}
              className="inline-flex max-w-full items-center gap-2 rounded-full bg-muted px-3 py-2 text-sm"
            >
              <span className="truncate">
                <span className="font-medium">
                  {filterTypeLabel(definitions, filter.name)}:
                </span>{" "}
                <em className="font-semibold">
                  {conditionLabel(definitions, filter)}
                </em>{" "}
                {filterValueLabel(definitions, filter)}
              </span>
              {!disabled && (
                <button
                  type="button"
                  onClick={() => removeFilter(index)}
                  className="shrink-0 text-muted-foreground hover:text-foreground"
                  aria-label={`Remove filter: ${filterAccessibleLabel(filter)}`}
                >
                  <X className="size-4" />
                </button>
              )}
            </div>
          ))}

          {!disabled && (
            <Button type="button" variant="secondary" onClick={clearFilters}>
              {clearFiltersLabel}
            </Button>
          )}

          {!disabled && onSaveSegment && (
            <Popover
              open={saveSegmentOpen}
              onOpenChange={(open) => {
                setSaveSegmentOpen(open);
                if (!open) {
                  setSegmentName("");
                }
              }}
            >
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  className="gap-2"
                  aria-label={saveSegmentButtonLabel}
                >
                  <Save className="size-4" />
                  {saveSegmentButtonLabel}
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-72">
                <p className="text-sm text-muted-foreground">
                  {saveSegmentDescription}
                </p>
                <form
                  className="mt-3 flex flex-col gap-2"
                  onSubmit={submitSaveSegment}
                >
                  <Label
                    htmlFor="contact-filter-segment-name"
                    className="text-sm font-semibold"
                  >
                    {segmentNameLabel}
                  </Label>
                  <Input
                    id="contact-filter-segment-name"
                    value={segmentName}
                    onChange={(event) => setSegmentName(event.target.value)}
                    autoFocus
                  />
                  <div className="flex">
                    <Button
                      type="submit"
                      disabled={!segmentName.trim() || savingSegment}
                    >
                      {saveLabel}
                    </Button>
                  </div>
                </form>
              </PopoverContent>
            </Popover>
          )}
        </div>
      )}

      <Dialog
        open={!!segmentPendingDelete}
        onOpenChange={(open) => {
          if (!open) setSegmentPendingDelete(undefined);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{deleteSegmentTitle}</DialogTitle>
            <DialogDescription>
              {segmentPendingDelete
                ? deleteSegmentDescription(segmentPendingDelete)
                : null}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setSegmentPendingDelete(undefined)}
            >
              {cancelLabel}
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={deletingSegment}
              onClick={confirmDeleteSegment}
            >
              {deleteLabel}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
