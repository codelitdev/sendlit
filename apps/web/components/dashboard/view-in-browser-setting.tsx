"use client";

import type { Sequence } from "@sendlit/email-blocks";
import { useState } from "react";
import { Label } from "@/components/ui/codelit/label";
import { Switch } from "@/components/ui/codelit/switch";
import { updateSequence } from "@/lib/api";
import { ApiError } from "@/lib/api-client";

/**
 * The broadcast's or sequence's "View in browser" switch. It saves as soon
 * as it's flipped, separately from the rest of the form, because it stays
 * changeable after sending: turning it off takes down the web versions
 * behind links already sent.
 */
export function ViewInBrowserSetting({
  sequence,
  onSaved,
}: {
  sequence: Sequence;
  onSaved: (sequence: Sequence) => void;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle(viewInBrowser: boolean) {
    setSaving(true);
    setError(null);
    try {
      onSaved(await updateSequence(sequence.sequenceId, { viewInBrowser }));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex items-start gap-3">
      <Switch
        id="view-in-browser"
        checked={sequence.viewInBrowser}
        onCheckedChange={toggle}
        disabled={saving}
      />
      <div className="space-y-1">
        <Label htmlFor="view-in-browser">View in browser</Label>
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
