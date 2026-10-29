import {
  eventNameSchema,
  eventPropertyFilterSchema,
  propertyChangeFilterSchema,
  reentryModes,
  sequenceTriggerTypes,
} from "@sendlit/api-contract";
import { EventType } from "../config/constants";

export type TriggerState = {
  type: string;
  triggerType: string | null;
  triggerData: string | null;
  triggerFilter: unknown;
  reentry: string;
  reentryPeriodDays: number | null;
};

/**
 * Validates a sequence's trigger as it will be stored: the current row with
 * the patch applied, since updates are partial. Returns the normalized
 * state, or throws an error whose message is the API error code.
 * See docs/custom_events.md#sequence-contract-changes.
 */
export function validateTriggerState(state: TriggerState): TriggerState {
  const next = { ...state };
  if (state.type === "broadcast") {
    if (next.triggerType && next.triggerType !== EventType.DATE_OCCURRED) {
      throw new Error("invalid_trigger_type");
    }
    if (next.triggerFilter != null) throw new Error("invalid_trigger_filter");
    return next;
  }

  if (
    next.triggerType &&
    !(sequenceTriggerTypes as readonly string[]).includes(next.triggerType)
  ) {
    throw new Error("invalid_trigger_type");
  }

  if (next.triggerType === EventType.CUSTOM_EVENT && next.triggerData) {
    const parsed = eventNameSchema.safeParse(next.triggerData);
    if (!parsed.success) throw new Error("invalid_trigger_data");
    next.triggerData = parsed.data;
  }

  if (next.triggerFilter != null) {
    const schema =
      next.triggerType === EventType.CUSTOM_EVENT
        ? eventPropertyFilterSchema
        : next.triggerType === EventType.CONTACT_PROPERTY_CHANGED
          ? propertyChangeFilterSchema
          : null;
    const parsed = schema?.safeParse(next.triggerFilter);
    if (!parsed?.success) throw new Error("invalid_trigger_filter");
    next.triggerFilter = parsed.data;
  }

  if (!(reentryModes as readonly string[]).includes(next.reentry)) {
    throw new Error("invalid_reentry");
  }
  if (next.reentry === "once_per_period") {
    const days = next.reentryPeriodDays;
    if (!days || days < 1 || days > 365) throw new Error("invalid_reentry");
  } else {
    next.reentryPeriodDays = null;
  }
  return next;
}

/** Triggers that need `triggerData` before a sequence can start. */
export const TRIGGERS_NEEDING_DATA: readonly string[] = [
  EventType.TAG_ADDED,
  EventType.TAG_REMOVED,
  EventType.CUSTOM_EVENT,
  EventType.CONTACT_PROPERTY_CHANGED,
];
