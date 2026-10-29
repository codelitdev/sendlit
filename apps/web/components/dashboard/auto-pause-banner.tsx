"use client";

import type { SequenceReport } from "@sendlit/email-blocks";
import { Play } from "lucide-react";
import { Banner } from "@/components/dashboard/banner";
import { Button } from "@/components/ui/codelit/button";

const percent = (value: unknown) => `${(Number(value) * 100).toFixed(2)}%`;

/** Mirrors `renderErrorReason` in the API's automation/sending-health.ts. */
function renderErrorReason(code: string): string {
  if (code === "footer_render_context_required") {
    return "The workspace has no mailing address for the footer.";
  }
  if (code.startsWith("footer_") || code === "invalid_footer") {
    return "The footer with your mailing address couldn't be built.";
  }
  return `The email's content couldn't be built (${code}).`;
}

/** Why SendLit paused a running broadcast or sequence (#25), with a way to
 * resume once the team has dealt with it. */
export function AutoPauseBanner({
  report,
  onResume,
  resuming,
}: {
  report: SequenceReport;
  onResume: () => void;
  resuming?: boolean;
}) {
  const pause = report.autoPause;
  if (!pause) return null;
  const why =
    pause.reason === "bounce_rate"
      ? `${percent(pause.bounceRate)} of its emails bounced (the limit is 2%).`
      : pause.reason === "complaint_rate"
        ? `${percent(pause.complaintRate)} of recipients marked it as spam (the limit is 0.08%).`
        : pause.reason === "consecutive_failures"
          ? "Several emails in a row failed to send."
          : pause.reason === "render_error"
            ? renderErrorReason(pause.error ?? "")
            : `Your email provider refused to send: ${pause.error ?? "unknown error"}.`;
  const next =
    pause.reason === "render_error"
      ? "Check your mailing address in Settings and the email's content"
      : "Clean your list or fix your email provider";
  return (
    <Banner variant="warning" className="mb-4 flex items-center justify-between gap-3">
      <span>
        Paused automatically {new Date(pause.at).toLocaleString()}: {why} {next}, then
        resume. Emails that haven&apos;t gone out yet are still queued.
      </span>
      <Button size="sm" onClick={onResume} disabled={resuming}>
        <Play className="size-4" />
        Resume
      </Button>
    </Banner>
  );
}
