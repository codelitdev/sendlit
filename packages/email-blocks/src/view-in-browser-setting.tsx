"use client";

import { useId, useState } from "react";
import { Label } from "./components/ui/label";
import { Switch } from "./components/ui/switch";

export interface ViewInBrowserSettingProps {
  /** The broadcast's or sequence's `viewInBrowser` setting. */
  checked: boolean;
  /** Saves the new value; a rejection is shown under the switch. */
  onCheckedChange: (viewInBrowser: boolean) => Promise<void>;
  disabled?: boolean;
}

/**
 * The broadcast's or sequence's "View in browser" switch. It saves as soon
 * as it's flipped, separately from the rest of the form, because it stays
 * changeable after sending: turning it off takes down the web versions
 * behind links already sent.
 */
export function ViewInBrowserSetting({
  checked,
  onCheckedChange,
  disabled,
}: ViewInBrowserSettingProps) {
  const id = useId();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle(viewInBrowser: boolean) {
    setSaving(true);
    setError(null);
    try {
      await onCheckedChange(viewInBrowser);
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex items-start gap-3">
      <Switch
        id={id}
        checked={checked}
        onCheckedChange={toggle}
        disabled={disabled || saving}
      />
      <div className="space-y-1">
        <Label htmlFor={id}>View in browser</Label>
        <p className="text-sm text-muted-foreground">
          Links each email to a hosted copy of it. Turn off for emails that
          shouldn&apos;t be on the web, such as onboarding or trial emails; copies
          linked from emails already sent stop working too.
        </p>
        {error && <p className="text-sm text-destructive">{error}</p>}
      </div>
    </div>
  );
}
