"use client";

import {
  type Sequence,
  ViewInBrowserSetting as ViewInBrowserSwitch,
} from "@sendlit/email-blocks";
import { updateSequence } from "@/lib/api";

/** Saves the shared "View in browser" switch through the dashboard API. */
export function ViewInBrowserSetting({
  sequence,
  onSaved,
}: {
  sequence: Sequence;
  onSaved: (sequence: Sequence) => void;
}) {
  return (
    <ViewInBrowserSwitch
      checked={sequence.viewInBrowser}
      onCheckedChange={async (viewInBrowser) => {
        onSaved(await updateSequence(sequence.sequenceId, { viewInBrowser }));
      }}
    />
  );
}
