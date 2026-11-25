"use client";

import { Check, ChevronDown, Globe, RefreshCw } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { Banner } from "@/components/dashboard/banner";
import { CopyButton } from "@/components/dashboard/domain-authentication-dialog";
import { Loading } from "@/components/dashboard/loading";
import { Badge } from "@/components/ui/codelit/badge";
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
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  getTeamSendingDomain,
  removeTeamSendingDomain,
  setTeamSendingDomain,
  type TeamSendingDomain,
  type TeamSendingDomainRecord,
} from "@/lib/api";
import { ApiError } from "@/lib/api-client";
import { relativeTime } from "@/lib/time";
import { cn } from "@/lib/utils";

type Section = "From address" | "DKIM" | "DMARC";
type Tone = "pass" | "warn" | "fail";

const TONE: Record<
  Tone,
  { icon: string; bar: string; badge: "success" | "warning" | "destructive" }
> = {
  pass: {
    icon: "bg-[var(--success-soft)] text-[#1f6b35]",
    bar: "bg-[var(--success)]",
    badge: "success",
  },
  warn: {
    icon: "bg-[var(--warning-soft)] text-[var(--warning)]",
    bar: "bg-[var(--warning)]",
    badge: "warning",
  },
  fail: {
    icon: "bg-[var(--destructive-soft)] text-destructive",
    bar: "bg-destructive",
    badge: "destructive",
  },
};

const ERRORS: Record<string, string> = {
  esp_management_credentials_required:
    "This shared mailbox has no Amazon SES API key yet. Add one from Organizations → Delivery, then try again.",
  esp_management_credentials_invalid:
    "Amazon SES refused the mailbox's API key. Update it from Organizations → Delivery.",
  provider_domain_unsupported:
    "Teams can register their own domain only on an Amazon SES shared mailbox for now.",
  organization_delivery_disabled: "Grant this team a shared mailbox first.",
  domain_in_use: "Another team or the organization already uses this domain.",
  domain_invalid: "Enter an address at a domain you own.",
  domain_public_suffix: "Use your own domain, not a shared one like gmail.com.",
  from_email_invalid: "Enter a valid email address.",
  esp_provider_error: "Amazon SES didn't answer. Try again in a minute.",
};

function errorText(err: unknown): string {
  if (err instanceof ApiError) return ERRORS[err.message] ?? err.message;
  return "Something went wrong. Try again.";
}

/**
 * A team's own From domain on its shared mailbox (#220): register it, publish
 * the DKIM and DMARC records, and see when the team starts sending from it.
 */
export function TeamSendingDomainDialog({
  organizationId,
  team,
  onOpenChange,
  onChanged,
}: {
  organizationId: string;
  team: { teamId: string; name: string } | null;
  onOpenChange: (open: boolean) => void;
  onChanged?: () => void;
}) {
  const [domain, setDomain] = useState<TeamSendingDomain | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [fromEmail, setFromEmail] = useState("");
  const [busy, setBusy] = useState<"check" | "save" | "remove" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<Record<Section, boolean>>({
    "From address": true,
    DKIM: false,
    DMARC: false,
  });
  const [now, setNow] = useState(() => Date.now());

  function show(next: TeamSendingDomain | null) {
    setDomain(next);
    setNow(Date.now());
    setFromEmail(next?.fromEmail ?? "");
    setOpen({
      "From address": !next,
      DKIM: Boolean(next && next.dkim !== "verified"),
      DMARC: Boolean(next && next.dmarc !== "pass"),
    });
  }

  async function run(kind: "check" | "save" | "remove", action: () => Promise<void>) {
    setBusy(kind);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(null);
    }
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: load again only when another team is opened
  useEffect(() => {
    setDomain(null);
    setLoaded(false);
    setError(null);
    if (!team) return;
    void run("check", async () => {
      show(await getTeamSendingDomain(organizationId, team.teamId));
    }).finally(() => setLoaded(true));
  }, [team?.teamId]);

  const passed = domain
    ? [domain.dkim === "verified", domain.dmarc === "pass"].filter(Boolean).length
    : 0;
  const summary = !domain
    ? "This team sends from the shared mailbox's domain."
    : domain.status === "failing"
      ? `Stopped authenticating. Broadcasts pause ${domain.graceEndsAt ? relativeTime(domain.graceEndsAt, now) : "soon"} unless it's fixed.`
      : domain.inUse
        ? `Mail from this team goes out as ${domain.fromEmail}.`
        : "Add the records below. The team switches to its own domain once both pass.";

  const dkimRecords =
    domain?.records.filter((record) => record.purpose === "dkim") ?? [];
  const dmarcRecords =
    domain?.records.filter((record) => record.purpose === "dmarc") ?? [];

  return (
    <Dialog open={team !== null} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] flex-col p-0 sm:max-w-3xl">
        <DialogHeader className="gap-2 border-b px-6 pt-6 pb-5">
          <DialogTitle>
            {domain ? (
              <>
                Sending domain <span className="font-mono">{domain.domain}</span>
              </>
            ) : (
              <>Sending domain for {team?.name}</>
            )}
          </DialogTitle>
          <DialogDescription>
            Inboxes judge mail by the domain that signs it. With its own domain, this
            team builds its own sender reputation instead of sharing the mailbox's.
          </DialogDescription>
          {domain && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-2 text-sm">
              <div className="flex gap-1" aria-hidden>
                {[domain.dkim === "verified", domain.dmarc === "pass"].map((ok, i) => (
                  <span
                    // biome-ignore lint/suspicious/noArrayIndexKey: fixed two-step progress bar
                    key={i}
                    className={cn(
                      "h-1.5 w-14 rounded-full",
                      ok ? TONE.pass.bar : TONE.warn.bar,
                    )}
                  />
                ))}
              </div>
              <span className="font-medium">{passed} of 2 done</span>
              <span className="text-muted-foreground">{summary}</span>
            </div>
          )}
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-6 py-5">
          {error && <Banner>{error}</Banner>}
          {!loaded && !error && <Loading />}
          {loaded && (
            <>
              <DomainSection
                name="From address"
                summary={
                  domain
                    ? (domain.fromEmail ?? domain.domain)
                    : "The address this team's emails come from."
                }
                tone={
                  !domain
                    ? "warn"
                    : domain.status === "failing"
                      ? "fail"
                      : domain.inUse
                        ? "pass"
                        : "warn"
                }
                badge={
                  !domain
                    ? "Not set"
                    : domain.inUse
                      ? domain.status === "failing"
                        ? "Failing"
                        : "In use"
                      : "Waiting for DNS"
                }
                open={open["From address"]}
                onOpenChange={(value) =>
                  setOpen((current) => ({ ...current, "From address": value }))
                }
              >
                <p className="text-sm">
                  {domain
                    ? "Change the address to use another domain; the old one is removed from the mailbox."
                    : "Enter the address this team should send from. Its domain is registered with the shared mailbox."}
                </p>
                <div className="space-y-1.5">
                  <Label htmlFor="team-from-email">From address</Label>
                  <Input
                    id="team-from-email"
                    type="email"
                    value={fromEmail}
                    onChange={(event) => setFromEmail(event.target.value)}
                    placeholder="news@yourschool.org"
                    className="max-w-sm"
                  />
                </div>
                {domain && (
                  <Button
                    variant="outline"
                    disabled={busy !== null}
                    onClick={() =>
                      team &&
                      void run("remove", async () => {
                        await removeTeamSendingDomain(organizationId, team.teamId);
                        show(null);
                        onChanged?.();
                      })
                    }
                  >
                    {busy === "remove" ? "Removing…" : "Stop using this domain"}
                  </Button>
                )}
              </DomainSection>

              {domain && (
                <>
                  <DomainSection
                    name="DKIM"
                    summary="Signs every email so inboxes know it came from your domain."
                    tone={
                      domain.dkim === "verified"
                        ? "pass"
                        : domain.dkim === "failed"
                          ? "fail"
                          : "warn"
                    }
                    badge={
                      domain.dkim === "verified"
                        ? "Verified"
                        : domain.dkim === "failed"
                          ? "Failed"
                          : `${dkimRecords.length} records to add`
                    }
                    open={open.DKIM}
                    onOpenChange={(value) =>
                      setOpen((current) => ({ ...current, DKIM: value }))
                    }
                  >
                    <p className="text-sm">
                      Add these CNAME records at your DNS provider. Amazon SES checks
                      them on its own, usually within an hour.
                    </p>
                    <RecordsTable records={dkimRecords} domain={domain.domain} />
                  </DomainSection>
                  <DomainSection
                    name="DMARC"
                    summary="Tells inboxes what to do with mail that fails authentication."
                    tone={domain.dmarc === "pass" ? "pass" : "warn"}
                    badge={domain.dmarc === "pass" ? "Set up" : "1 record to add"}
                    open={open.DMARC}
                    onOpenChange={(value) =>
                      setOpen((current) => ({ ...current, DMARC: value }))
                    }
                  >
                    <p className="text-sm">
                      Add this TXT record unless your domain already has a DMARC record.
                      Start with p=none to monitor.
                    </p>
                    <RecordsTable records={dmarcRecords} domain={domain.domain} />
                  </DomainSection>
                </>
              )}
            </>
          )}
        </div>

        <DialogFooter className="mt-0 flex-wrap justify-between gap-3 border-t px-6 py-4">
          <p className="text-sm text-muted-foreground">
            {domain?.lastCheckedAt
              ? `Checked ${relativeTime(domain.lastCheckedAt, now)}. DNS changes can take a few hours to show up.`
              : "DNS changes can take a few hours to show up."}
          </p>
          <div className="flex gap-2.5">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Close
            </Button>
            {!domain || fromEmail.trim().toLowerCase() !== domain.fromEmail ? (
              <Button
                disabled={!team || busy !== null || !fromEmail.includes("@")}
                onClick={() =>
                  team &&
                  void run("save", async () => {
                    show(
                      await setTeamSendingDomain(
                        organizationId,
                        team.teamId,
                        fromEmail,
                      ),
                    );
                    onChanged?.();
                  })
                }
              >
                <Globe className="size-4" />
                {busy === "save" ? "Registering…" : "Register domain"}
              </Button>
            ) : (
              <Button
                disabled={!team || busy !== null}
                onClick={() =>
                  team &&
                  void run("check", async () => {
                    show(await getTeamSendingDomain(organizationId, team.teamId));
                    onChanged?.();
                  })
                }
              >
                <RefreshCw
                  className={cn("size-4", busy === "check" && "animate-spin")}
                />
                {busy === "check" ? "Checking…" : "Check again"}
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DomainSection({
  name,
  summary,
  tone,
  badge,
  open,
  onOpenChange,
  children,
}: {
  name: Section;
  summary: string;
  tone: Tone;
  badge: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
}) {
  return (
    <Collapsible
      open={open}
      onOpenChange={onOpenChange}
      className="rounded-lg border bg-card"
    >
      <CollapsibleTrigger className="flex w-full items-center gap-4 rounded-lg px-5 py-4 text-left outline-none focus-visible:shadow-[var(--shadow-focus)]">
        <span
          className={cn(
            "grid size-9 shrink-0 place-items-center rounded-full text-sm font-bold",
            TONE[tone].icon,
          )}
          aria-hidden
        >
          {tone === "pass" ? <Check className="size-4" /> : "!"}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium">{name}</span>
          <span className="block break-all text-sm text-muted-foreground">
            {summary}
          </span>
        </span>
        <Badge variant={TONE[tone].badge}>{badge}</Badge>
        <ChevronDown
          className={cn(
            "size-4 shrink-0 text-muted-foreground transition-transform",
            open && "rotate-180",
          )}
        />
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-4 px-5 pb-5 sm:pl-[4.75rem]">
        {children}
      </CollapsibleContent>
    </Collapsible>
  );
}

function RecordsTable({
  records,
  domain,
}: {
  records: TeamSendingDomainRecord[];
  domain: string;
}) {
  return (
    <>
      <div className="overflow-hidden rounded-lg border bg-muted/40">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="px-4">Type</TableHead>
              <TableHead className="px-4">Host</TableHead>
              <TableHead className="px-4">Value</TableHead>
              <TableHead className="px-4">Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {records.map((record) => (
              <TableRow key={record.name} className="align-top hover:bg-transparent">
                <TableCell className="whitespace-normal px-4 py-3">
                  <span className="rounded-md border bg-card px-2 py-1 font-mono text-xs">
                    {record.type}
                  </span>
                </TableCell>
                <TableCell className="whitespace-normal px-4 py-3">
                  <div className="flex items-start gap-1.5">
                    <span className="break-all font-mono text-xs leading-5">
                      {record.name}
                    </span>
                    <CopyButton
                      value={record.name}
                      label={`Copy ${record.purpose} host`}
                    />
                  </div>
                </TableCell>
                <TableCell className="whitespace-normal px-4 py-3">
                  <div className="flex items-start gap-1.5">
                    <span className="break-all font-mono text-xs leading-5">
                      {record.value}
                    </span>
                    <CopyButton
                      value={record.value}
                      label={`Copy ${record.purpose} value`}
                    />
                  </div>
                </TableCell>
                <TableCell className="whitespace-normal px-4 py-3">
                  <Badge variant={record.present ? "success" : "outline"}>
                    {record.present ? "Found" : "Not found"}
                  </Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <p className="text-xs text-muted-foreground">
        Some DNS providers add <span className="font-mono">{domain}</span> to the host
        for you. If yours does, enter only the part before it.
      </p>
    </>
  );
}
