"use client";

import { Input } from "@/components/ui/codelit/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/codelit/select";
import type { DeliverySourceSelection, SendingOption } from "@/lib/api";
import { sendingOptionLabel } from "@/lib/delivery-source";

/** `Select` cannot represent a null value. Null intentionally leaves source
 * selection to the team's default at activation time. */
const DEFAULT_VALUE = "__default__";
const ORGANIZATION_VALUE = "__organization__";
const TEAM_PREFIX = "team:";

function toValue(source: DeliverySourceSelection | null | undefined) {
  if (!source) return DEFAULT_VALUE;
  return source.type === "organization"
    ? ORGANIZATION_VALUE
    : `${TEAM_PREFIX}${source.espId ?? ""}`;
}

function valueForOption(option: SendingOption) {
  return option.type === "organization"
    ? ORGANIZATION_VALUE
    : `${TEAM_PREFIX}${option.espId}`;
}

/**
 * Selects an immutable delivery-source intent for a draft. Organization
 * options deliberately carry no ESP id: a team can use the shared sender but
 * never learns its credentials or organization-internal configuration id.
 */
export function DeliverySourcePicker({
  options,
  value,
  onChange,
  disabled,
  deleted,
}: {
  options: SendingOption[];
  value: DeliverySourceSelection | null | undefined;
  onChange: (source: DeliverySourceSelection | null) => void;
  disabled?: boolean;
  /** An immutable sent campaign whose original ESP has been removed. */
  deleted?: boolean;
}) {
  const availableOptions = options.filter((option) => option.available);
  const selectedTeamEspId = value?.type === "team" ? value.espId : undefined;
  const hasUnavailableExplicitSelection =
    value?.type === "organization"
      ? !availableOptions.some((option) => option.type === "organization")
      : Boolean(selectedTeamEspId) &&
        !availableOptions.some(
          (option) => option.type === "team" && option.espId === selectedTeamEspId,
        );

  const deletedSource = deleted || hasUnavailableExplicitSelection;
  if ((disabled && deletedSource) || availableOptions.length === 0) {
    return (
      <Input
        aria-label="Delivery source"
        value={deletedSource ? "Deleted" : "No active delivery source available"}
        disabled
        readOnly
      />
    );
  }
  const defaultOption = availableOptions.find((option) => option.isDefault);
  const hasDefault = Boolean(defaultOption);
  const soleOption = availableOptions.length === 1 ? availableOptions[0] : null;
  // A lone available source resolves automatically, so a separate "team
  // default" alias adds no choice and merely duplicates the same sender.
  const selectedValue = hasUnavailableExplicitSelection
    ? undefined
    : !value && soleOption
      ? valueForOption(soleOption)
      : toValue(value);

  return (
    <Select
      value={selectedValue}
      onValueChange={(next) => {
        if (next === DEFAULT_VALUE) {
          onChange(null);
        } else if (next === ORGANIZATION_VALUE) {
          onChange({ type: "organization" });
        } else if (next.startsWith(TEAM_PREFIX)) {
          onChange({
            type: "team",
            espId: next.slice(TEAM_PREFIX.length),
          });
        }
      }}
      disabled={disabled || availableOptions.length === 0}
    >
      <SelectTrigger className="w-full">
        <SelectValue placeholder="Select a delivery source" />
      </SelectTrigger>
      <SelectContent>
        {hasDefault && !soleOption && (
          <SelectItem value={DEFAULT_VALUE}>
            {defaultOption
              ? `Team default: ${sendingOptionLabel(defaultOption)}`
              : "Team default delivery source"}
          </SelectItem>
        )}
        {availableOptions.map((option) => (
          <SelectItem key={valueForOption(option)} value={valueForOption(option)}>
            {sendingOptionLabel(option)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
