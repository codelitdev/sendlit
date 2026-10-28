"use client";

import { ChevronDown, ExternalLink, FlaskConical, Zap } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Banner } from "@/components/dashboard/banner";
import { Loading } from "@/components/dashboard/loading";
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
import { Textarea } from "@/components/ui/codelit/textarea";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { getEventDefinition, trackEvent } from "@/lib/api";
import { ApiError } from "@/lib/api-client";

/** Placeholder values for declared properties, so the JSON is ready to edit. */
const SAMPLE_BY_TYPE: Record<string, unknown> = {
  string: "",
  number: 0,
  boolean: false,
  date: new Date().toISOString(),
  object: {},
  array: [],
};

/** Reserved test domains run the sequence but never send (API
 * `isTestAddress`). */
export function isTestEmail(email: string) {
  const domain = email.trim().toLowerCase().split("@").pop() ?? "";
  const tld = domain.split(".").pop() ?? "";
  return (
    ["example.com", "example.net", "example.org", "test.com"].includes(domain) ||
    ["test", "example", "invalid", "localhost"].includes(tld)
  );
}

/**
 * Sends a real event (`POST /events`) for a contact, so a marketer can check
 * that a sequence starts without asking a developer. Test addresses run the
 * sequence without sending mail. See docs/custom_events.md#testing-events.
 */
export function SendTestEventDialog({
  name,
  open,
  onOpenChange,
  onSent,
}: {
  name: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSent?: () => void;
}) {
  const [email, setEmail] = useState("test+1@example.com");
  const [json, setJson] = useState("{}");
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<{ eventId: string; contactId: string } | null>(null);

  useEffect(() => {
    if (!open || !name) return;
    setError(null);
    setSent(null);
    setLoading(true);
    getEventDefinition(name)
      .then((definition) => {
        const sample =
          definition.lastProperties ??
          Object.fromEntries(
            definition.properties.map((p) => [p.key, SAMPLE_BY_TYPE[p.type] ?? ""]),
          );
        setJson(JSON.stringify(sample, null, 2));
      })
      .catch(() => setJson("{}"))
      .finally(() => setLoading(false));
  }, [open, name]);

  async function send() {
    if (!name) return;
    let properties: Record<string, unknown>;
    try {
      const parsed = JSON.parse(json || "{}");
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error();
      }
      properties = parsed;
    } catch {
      setError('Properties must be a JSON object, for example {"plan": "pro"}.');
      return;
    }
    setSending(true);
    setError(null);
    try {
      const result = await trackEvent({
        email: email.trim(),
        eventName: name,
        properties,
      });
      setSent(result);
      onSent?.();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't send the event.");
    } finally {
      setSending(false);
    }
  }

  const testAddress = isTestEmail(email);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] flex-col p-0 sm:max-w-2xl">
        <DialogHeader className="gap-2 border-b px-6 pt-6 pb-5">
          <DialogTitle>
            Send a test <span className="font-mono">{name}</span> event
          </DialogTitle>
          <DialogDescription>
            This sends a real event for the contact below. Every active sequence
            listening for it starts, just as when your app sends it.
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-5">
          {error && <Banner>{error}</Banner>}
          {sent && (
            <Banner variant="success">
              Sent <span className="font-mono">{sent.eventId}</span>.{" "}
              <Link
                href={`/contacts/${sent.contactId}`}
                className="inline-flex items-center gap-1 underline"
              >
                Open the contact
                <ExternalLink className="size-3.5" />
              </Link>
            </Banner>
          )}
          {loading ? (
            <Loading />
          ) : (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="test-event-email">Contact email</Label>
                <Input
                  id="test-event-email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
                <p className="text-sm text-muted-foreground">
                  {testAddress
                    ? "Test addresses run the sequence without sending mail. An unknown address is added as a contact."
                    : "Sequences will send real mail to this address. An unknown address is added as a contact."}
                </p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="test-event-properties">Properties</Label>
                <Textarea
                  id="test-event-properties"
                  className="min-h-40 font-mono text-sm"
                  value={json}
                  onChange={(e) => setJson(e.target.value)}
                />
              </div>
              <Collapsible>
                <CollapsibleTrigger className="group flex items-center gap-1 text-sm font-medium">
                  <ChevronDown className="size-4 transition-transform group-data-[state=closed]:-rotate-90" />
                  Which addresses don't get mail?
                </CollapsibleTrigger>
                <CollapsibleContent className="pt-2 text-sm text-muted-foreground">
                  <span className="font-mono">example.com</span>,{" "}
                  <span className="font-mono">example.net</span>,{" "}
                  <span className="font-mono">example.org</span>,{" "}
                  <span className="font-mono">test.com</span>, and anything ending in{" "}
                  <span className="font-mono">.test</span>,{" "}
                  <span className="font-mono">.example</span>,{" "}
                  <span className="font-mono">.invalid</span> or{" "}
                  <span className="font-mono">.localhost</span>. Their sequences run and
                  you can follow them on the contact, but nothing is sent or counted
                  toward your plan.
                </CollapsibleContent>
              </Collapsible>
            </>
          )}
        </div>

        <DialogFooter className="mt-0 flex-wrap justify-between gap-3 border-t px-6 py-4">
          <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <FlaskConical className="size-4" />
            Test events are stored like real ones.
          </p>
          <div className="flex gap-2.5">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Close
            </Button>
            <Button disabled={!name || sending || loading} onClick={() => void send()}>
              <Zap className="size-4" />
              {sending ? "Sending…" : "Send event"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
