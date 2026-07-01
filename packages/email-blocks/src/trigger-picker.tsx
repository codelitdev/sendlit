"use client";

import { Label } from "./components/ui/label";
import { Input } from "./components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./components/ui/select";
import { cn } from "./lib/utils";
import type { TriggerType } from "./types";

const TRIGGERS: { value: TriggerType; label: string; needsData: boolean }[] = [
  {
    value: "subscriber:added",
    label: "A new contact subscribes",
    needsData: false,
  },
  { value: "tag:added", label: "A tag is added to a contact", needsData: true },
  {
    value: "tag:removed",
    label: "A tag is removed from a contact",
    needsData: true,
  },
];

export interface TriggerPickerProps {
  triggerType?: string | null;
  triggerData?: string | null;
  onChange: (value: {
    triggerType: string;
    triggerData?: string | null;
  }) => void;
  className?: string;
}

/** Picks the event that enrolls contacts into a sequence. */
export function TriggerPicker({
  triggerType,
  triggerData,
  onChange,
  className,
}: TriggerPickerProps) {
  const current = TRIGGERS.find((t) => t.value === triggerType) ?? TRIGGERS[0];

  return (
    <div className={cn("space-y-3", className)}>
      <div className="space-y-1.5">
        <Label>Trigger</Label>
        <Select
          value={current.value}
          onValueChange={(value) =>
            onChange({ triggerType: value, triggerData })
          }
        >
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {TRIGGERS.map((t) => (
              <SelectItem key={t.value} value={t.value}>
                {t.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {current.needsData && (
        <div className="space-y-1.5">
          <Label>Tag name</Label>
          <Input
            placeholder="e.g. vip"
            value={triggerData ?? ""}
            onChange={(e) =>
              onChange({
                triggerType: current.value,
                triggerData: e.target.value,
              })
            }
          />
        </div>
      )}
    </div>
  );
}
