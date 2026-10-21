"use client";

import { FlaskConical } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { SendErrorMessage } from "@/components/dashboard/send-error-message";
import { Button } from "@/components/ui/codelit/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/codelit/dialog";
import { Input } from "@/components/ui/codelit/input";
import { Label } from "@/components/ui/codelit/label";
import { sendSequenceEmailTest } from "@/lib/api";
import { ApiError } from "@/lib/api-client";

const MAX_RECIPIENTS = 5;

function parseRecipients(value: string) {
  return value
    .split(/[\s,;]+/)
    .map((email) => email.trim())
    .filter(Boolean);
}

async function currentUserEmail(): Promise<string> {
  const res = await fetch("/api/auth/get-session", { cache: "no-store" });
  if (!res.ok) return "";
  const session = (await res.json()) as { user?: { email?: string } } | null;
  return session?.user?.email ?? "";
}

/**
 * "Send test" button and dialog for one broadcast or sequence email. The test
 * is rendered like the real send with a `[Test]` subject. `beforeSend` lets an
 * editor save pending changes first so the test matches what's on screen.
 */
export function SendTestDialog({
  sequenceId,
  emailId,
  lastTestSentAt,
  beforeSend,
  onSent,
  disabled,
}: {
  sequenceId: string;
  emailId: string;
  lastTestSentAt?: string | null;
  beforeSend?: () => Promise<void>;
  onSent?: (lastTestSentAt: string | null) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [recipients, setRecipients] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || recipients) return;
    currentUserEmail()
      .then((email) => setRecipients((current) => current || email))
      .catch(() => undefined);
  }, [open, recipients]);

  async function send() {
    const to = parseRecipients(recipients);
    if (to.length === 0) {
      setError("Enter at least one email address");
      return;
    }
    if (to.length > MAX_RECIPIENTS) {
      setError(`Send a test to at most ${MAX_RECIPIENTS} addresses`);
      return;
    }
    setSending(true);
    setError(null);
    try {
      await beforeSend?.();
      const result = await sendSequenceEmailTest(sequenceId, emailId, to);
      onSent?.(result.lastTestSentAt);
      if (result.sent.length > 0) {
        toast.success(`Test sent to ${result.sent.join(", ")}`);
      }
      if (result.skipped.length > 0) {
        toast.warning(
          `Skipped ${result.skipped.map((s) => s.email).join(", ")}: on the suppression list`,
        );
      }
      if (result.sent.length > 0) setOpen(false);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message === "test_send_limit_reached"
            ? "Too many test emails in the last hour. Try again later."
            : err.message
          : "Failed to send the test",
      );
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)} disabled={disabled}>
        <FlaskConical className="size-4" />
        Send test
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Send a test email</DialogTitle>
            <DialogDescription>
              The test looks exactly like the real email, with &quot;[Test]&quot; added
              to the subject. Opens, clicks and the unsubscribe link in a test
              don&apos;t change anything.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="send-test-recipients">Send to</Label>
            <Input
              id="send-test-recipients"
              value={recipients}
              onChange={(e) => setRecipients(e.target.value)}
              placeholder="you@example.com"
            />
            <p className="text-sm text-muted-foreground">
              Up to {MAX_RECIPIENTS} addresses, separated by commas.
              {lastTestSentAt
                ? ` Last test sent ${new Date(lastTestSentAt).toLocaleString()}.`
                : " No test sent yet."}
            </p>
            {error && (
              <p className="text-sm text-destructive">
                <SendErrorMessage error={error} />
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={sending}>
              Cancel
            </Button>
            <Button onClick={send} disabled={sending}>
              <FlaskConical className="size-4" />
              {sending ? "Sending…" : "Send test"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
