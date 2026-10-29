"use client";

import { Check, FlaskConical, Info, MapPin, Send, X } from "lucide-react";
import { type KeyboardEvent, type ReactNode, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  MAILING_ADDRESS_REQUIRED_ERROR,
  SendErrorMessage,
} from "@/components/dashboard/send-error-message";
import { Button } from "@/components/ui/codelit/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/codelit/dialog";
import { Label } from "@/components/ui/codelit/label";
import { Textarea } from "@/components/ui/codelit/textarea";
import type { SendingOption } from "@/lib/api";
import {
  getGeneralSettings,
  sendSequenceEmailTest,
  updateGeneralSettings,
} from "@/lib/api";
import { ApiError } from "@/lib/api-client";
import { presentDeliverySourceError } from "@/lib/delivery-source";
import { cn } from "@/lib/utils";

export const MAX_TEST_RECIPIENTS = 5;

const TEST_LIMIT_MESSAGES: Record<string, string> = {
  test_send_limit_reached:
    "Your team has reached its test email limit. Earlier tests age out over the day, so try again later.",
  test_send_email_limit_reached:
    "This email has reached its daily test limit. Try again later.",
};

/** Splits typed or pasted text into addresses (commas, semicolons, spaces). */
export function parseRecipients(value: string) {
  return value
    .split(/[\s,;]+/)
    .map((email) => email.trim())
    .filter(Boolean);
}

/** Adds `incoming` to `current`, skipping duplicates (case-insensitive) and
 * stopping at `max` addresses. */
export function addRecipients(
  current: string[],
  incoming: string[],
  max = MAX_TEST_RECIPIENTS,
) {
  const seen = new Set(current.map((email) => email.toLowerCase()));
  const next = [...current];
  for (const email of incoming) {
    if (next.length >= max) break;
    if (seen.has(email.toLowerCase())) continue;
    seen.add(email.toLowerCase());
    next.push(email);
  }
  return next;
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
  sendingVia,
  subject,
  sequenceId,
  emailId,
  lastTestSentAt,
  beforeSend,
  onSent,
  disabled,
}: {
  sequenceId: string;
  emailId: string;
  /** The real email's subject; the test adds "[Test]" in front. */
  subject?: string;
  lastTestSentAt?: string | null;
  beforeSend?: () => Promise<void>;
  onSent?: (lastTestSentAt: string | null) => void;
  disabled?: boolean;
  /** The delivery source the test goes through, when known. */
  sendingVia?: SendingOption | null;
}) {
  const [open, setOpen] = useState(false);
  const [recipients, setRecipients] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Null until known; a failed lookup leaves it null and the API decides.
  const [addressMissing, setAddressMissing] = useState<boolean | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    currentUserEmail()
      .then((email) => {
        if (email) setRecipients((current) => (current.length ? current : [email]));
      })
      .catch(() => undefined);
    getGeneralSettings()
      .then((settings) => setAddressMissing(!settings.mailingAddress?.trim()))
      .catch(() => setAddressMissing(null));
  }, [open]);

  function commitDraft(value = draft) {
    const incoming = parseRecipients(value);
    if (incoming.length === 0) return recipients;
    const next = addRecipients(recipients, incoming);
    setRecipients(next);
    setDraft("");
    setError(null);
    return next;
  }

  function onDraftKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (["Enter", ",", ";", " ", "Tab"].includes(event.key) && draft.trim()) {
      event.preventDefault();
      commitDraft();
    } else if (event.key === "Backspace" && !draft && recipients.length) {
      setRecipients(recipients.slice(0, -1));
    }
  }

  async function send() {
    const to = commitDraft();
    if (to.length === 0) {
      setError("Add at least one email address");
      return;
    }
    setSending(true);
    setError(null);
    try {
      await beforeSend?.();
      const result = await sendSequenceEmailTest(sequenceId, emailId, to);
      onSent?.(result.lastTestSentAt);
      if (result.sent.length > 0) {
        toast.success(
          `Test sent to ${result.sent.join(", ")}${sendingVia ? ` via ${sendingVia.name}` : ""}`,
        );
      }
      if (result.sent.length > 0 && result.eventSample) {
        toast.info(
          result.eventSample === "last_event"
            ? "{{ event.* }} used the last event received."
            : "No event received yet, so {{ event.* }} is empty.",
        );
      }
      if (result.skipped.length > 0) {
        toast.warning(
          `Skipped ${result.skipped.map((s) => s.email).join(", ")}: on the suppression list`,
        );
      }
      if (result.sent.length > 0) setOpen(false);
    } catch (err) {
      const message =
        err instanceof ApiError
          ? (TEST_LIMIT_MESSAGES[err.message] ?? err.message)
          : "Failed to send the test";
      if (presentDeliverySourceError(message) === MAILING_ADDRESS_REQUIRED_ERROR) {
        setAddressMissing(true);
      } else {
        setError(message);
      }
    } finally {
      setSending(false);
    }
  }

  const full = recipients.length >= MAX_TEST_RECIPIENTS;
  const from = sendingVia?.fromEmail
    ? sendingVia.fromName
      ? `${sendingVia.fromName} <${sendingVia.fromEmail}>`
      : sendingVia.fromEmail
    : null;

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)} disabled={disabled}>
        <FlaskConical className="size-4" />
        Send test
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="flex max-h-[90vh] flex-col gap-0 p-0 sm:max-w-xl">
          <DialogHeader className="gap-1.5 px-6 pt-6 pb-2">
            <DialogTitle>Send a test email</DialogTitle>
            <DialogDescription>
              See it in your inbox before your audience does.
            </DialogDescription>
          </DialogHeader>

          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-6 py-4">
            <div className="space-y-2">
              <div className="flex items-baseline justify-between">
                <Label htmlFor="send-test-recipients">Send to</Label>
                <span
                  className={cn(
                    "text-xs text-muted-foreground",
                    full && "font-medium text-foreground",
                  )}
                >
                  {recipients.length} of {MAX_TEST_RECIPIENTS}
                </span>
              </div>
              <div className="flex min-h-11 w-full flex-wrap items-center gap-1.5 rounded-[var(--radius)] border border-input bg-card px-2 py-1.5 transition-[border-color,box-shadow] focus-within:border-ring focus-within:shadow-[0_0_0_3px_var(--primary-soft)]">
                {recipients.map((email) => (
                  <span
                    key={email}
                    className="inline-flex items-center gap-1 rounded-full bg-muted py-1 pr-1.5 pl-3 text-sm"
                  >
                    {email}
                    <button
                      type="button"
                      className="rounded-full p-0.5 text-muted-foreground hover:text-foreground"
                      aria-label={`Remove ${email}`}
                      onClick={() =>
                        setRecipients(recipients.filter((current) => current !== email))
                      }
                    >
                      <X className="size-3.5" />
                    </button>
                  </span>
                ))}
                <input
                  id="send-test-recipients"
                  hidden={full}
                  type="email"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={onDraftKeyDown}
                  onBlur={() => commitDraft()}
                  onPaste={(e) => {
                    e.preventDefault();
                    commitDraft(draft + e.clipboardData.getData("text"));
                  }}
                  placeholder={
                    recipients.length ? "Add another address" : "you@example.com"
                  }
                  className="h-8 min-w-40 flex-1 bg-transparent px-1 text-sm outline-none placeholder:text-muted-foreground"
                />
              </div>
              {full && (
                <p className="text-xs text-muted-foreground">
                  A test goes to at most {MAX_TEST_RECIPIENTS} addresses. Remove one to
                  add another.
                </p>
              )}
            </div>

            <dl className="divide-y overflow-hidden rounded-lg border bg-muted/40 text-sm">
              {from && (
                <SummaryRow label="From">
                  <span className="break-all">{from}</span>
                </SummaryRow>
              )}
              {sendingVia && (
                <SummaryRow label="Via">
                  <span className="font-medium">
                    {sendingVia.type === "organization"
                      ? `Shared: ${sendingVia.name}`
                      : sendingVia.name}
                  </span>
                  <span className="inline-flex items-center gap-1 text-[#1f6b35]">
                    <Check className="size-3.5" />
                    Same as the real email
                  </span>
                </SummaryRow>
              )}
              <SummaryRow label="Subject">
                <span className="rounded-md bg-[var(--success-soft)] px-2 py-0.5 text-xs font-medium text-[#1f6b35]">
                  [Test]
                </span>
                <span className="break-words">
                  {subject?.trim() || (
                    <span className="text-muted-foreground">No subject yet</span>
                  )}
                </span>
              </SummaryRow>
            </dl>

            {addressMissing && (
              <MailingAddressPrompt onSaved={() => setAddressMissing(false)} />
            )}

            {error && (
              <p className="text-sm text-destructive" role="alert">
                <SendErrorMessage error={error} />
              </p>
            )}

            <p className="flex gap-2 text-sm text-muted-foreground">
              <Info className="mt-0.5 size-4 shrink-0" />
              The test looks exactly like the real email. Opens, clicks and unsubscribes
              from it aren&apos;t counted.
            </p>
          </div>

          <DialogFooter className="mt-0 flex-wrap items-center justify-between gap-3 border-t px-6 py-4 sm:justify-between">
            <p className="text-sm text-muted-foreground">
              {addressMissing
                ? "Add your mailing address to send"
                : lastTestSentAt
                  ? `Last test sent ${new Date(lastTestSentAt).toLocaleString()}`
                  : "No test sent yet"}
            </p>
            <div className="flex gap-2.5">
              <Button
                variant="outline"
                onClick={() => setOpen(false)}
                disabled={sending}
              >
                Cancel
              </Button>
              <Button onClick={send} disabled={sending || Boolean(addressMissing)}>
                <Send className="size-4" />
                {sending ? "Sending…" : "Send test"}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function SummaryRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline gap-4 px-4 py-3">
      <dt className="w-16 shrink-0 text-muted-foreground">{label}</dt>
      <dd className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
        {children}
      </dd>
    </div>
  );
}

/** Amber prompt to add the team's mailing address without leaving the dialog. */
function MailingAddressPrompt({ onSaved }: { onSaved: () => void }) {
  const [editing, setEditing] = useState(false);
  const [address, setAddress] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (!address.trim()) {
      setError("Enter your mailing address");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await updateGeneralSettings({ mailingAddress: address });
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to save the address");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex gap-3 rounded-lg bg-[var(--warning-soft)] p-4">
      <MapPin className="mt-0.5 size-5 shrink-0 text-[var(--warning)]" />
      <div className="min-w-0 flex-1 space-y-3">
        <div className="space-y-1 text-sm">
          <p className="font-medium">Add your mailing address first</p>
          <p>
            Anti-spam laws require a postal address in every broadcast and sequence, so
            SendLit adds it to your footer. You only need to do this once.
          </p>
        </div>
        {editing ? (
          <div className="space-y-2">
            <Label htmlFor="send-test-mailing-address" className="sr-only">
              Mailing address
            </Label>
            <Textarea
              id="send-test-mailing-address"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="123 Main St, City, Country"
              rows={3}
              autoFocus
            />
            {error && <p className="text-sm text-destructive">{error}</p>}
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setEditing(false)}
                disabled={saving}
              >
                Cancel
              </Button>
              <Button size="sm" onClick={save} disabled={saving}>
                {saving ? "Saving…" : "Save address"}
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex justify-end">
            <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
              Add mailing address
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
