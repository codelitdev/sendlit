"use client";

import type { SequenceReport } from "@sendlit/email-blocks";
import { Play } from "lucide-react";
import { Banner } from "@/components/dashboard/banner";
import { Button } from "@/components/ui/codelit/button";

const percent = (value: unknown) => `${(Number(value) * 100).toFixed(2)}%`;

/** Mirrors `renderErrorReason` in the API's automation/sending-health.ts. */
function renderErrorReason(code: string): string {
  switch (code) {
    case "footer_render_context_required":
      return "The workspace has no mailing address for the footer.";
    case "footer_render_failed":
      return "The footer with your mailing address couldn't be built.";
    case "footer_required":
    case "footer_not_allowed":
    case "invalid_footer":
      return "The email's footer block is missing or invalid.";
    default:
      return `The email's content couldn't be built (${code}).`;
  }
}

/** Mirrors `sendingBlockedReason` in the API's automation/sending-health.ts. */
function sendingBlockedReason(
  code: string,
  threshold?: number,
  domain?: string,
): { why: string; next: string } {
  switch (code) {
    case "domain_verification_required":
      return {
        why: `Its From domain${domain ? ` ${domain}` : ""} isn't verified for your organization, which is required after your organization's first ${threshold ?? "few"} emails.`,
        next: "Verify the domain in Organizations → Sending domains",
      };
    case "feedback_connection_required":
      return {
        why: `Your email provider isn't reporting bounces and spam complaints back to SendLit, which is required after your organization's first ${threshold ?? "few"} emails.`,
        next: "Connect bounce and complaint feedback for the provider in Settings → Email service providers (ESP)",
      };
    case "verified_owner_email_required":
      return {
        why: "The organization's owner hasn't verified their email address.",
        next: "Verify the owner's email address",
      };
    default:
      return {
        why: `Sending is blocked for the organization (${code}).`,
        next: "Check your organization's settings",
      };
  }
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
            : pause.reason === "sending_blocked"
              ? sendingBlockedReason(pause.error ?? "", pause.threshold, pause.domain)
                  .why
              : `Your email provider refused to send: ${pause.error ?? "unknown error"}.`;
  const next =
    pause.reason === "render_error"
      ? "Check your mailing address in Settings and the email's content"
      : pause.reason === "sending_blocked"
        ? sendingBlockedReason(pause.error ?? "", pause.threshold, pause.domain).next
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
